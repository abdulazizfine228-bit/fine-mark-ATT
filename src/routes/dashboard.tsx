import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Camera, Loader2, Check, LogOut } from "lucide-react";
import { toast } from "sonner";
import { format, startOfDay, endOfDay, parseISO } from "date-fns";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Attendly" }] }),
  component: Dashboard,
});

type Attendance = {
  id: string;
  extracted_name: string | null;
  extracted_id: string | null;
  captured_at: string;
  checked_out_at: string | null;
  total_minutes: number | null;
  project_name: string | null;
  place: string | null;
  job_title: string | null;
  photo_path: string;
  leave_note: string | null;
};

const JOB_TITLES = [
  "نجار", "حداد", "دهان", "كهربائي", "عامل", "فني سباكه", "فني تكييف",
  "معلم بلاط", "معلم مباني ولياسه", "مساعد مبلط", "مساعد بناء او مليس",
  "فني ستيكرات", "مشرف مساعد مشروع مؤقت", "رنر مشروع مؤقت",
  "الجرفك", "وعامل البناء",
] as const;

const TZ = "Asia/Riyadh";
const fmtDate = (d: string | Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" }).format(new Date(d));
const fmtTime = (d: string | Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(d));
const fmtDateTime = (d: string | Date) => `${fmtDate(d)}, ${fmtTime(d)}`;

const PRICES: Record<string, Record<string, number>> = {
  Jeddah: {
    "نجار": 230, "حداد": 230, "دهان": 230, "كهربائي": 230, "عامل": 130,
    "فني سباكه": 250, "فني تكييف": 250, "معلم بلاط": 250, "معلم مباني ولياسه": 250,
    "مساعد مبلط": 200, "مساعد بناء او مليس": 200, "فني ستيكرات": 230,
    "مشرف مساعد مشروع مؤقت": 250, "رنر مشروع مؤقت": 250,
  },
  Riyad: {
    "نجار": 250, "حداد": 250, "دهان": 250, "كهربائي": 250, "عامل": 160,
    "فني سباكه": 250, "فني تكييف": 250, "معلم بلاط": 250, "معلم مباني ولياسه": 250,
    "مساعد مبلط": 200, "مساعد بناء او مليس": 250, "فني ستيكرات": 250,
    "الجرفك": 250, "رنر مشروع مؤقت": 250, "وعامل البناء": 250,
  },
};

const getPrice = (place: string | null, job: string | null): number | null => {
  if (!place || !job) return null;
  const table = PRICES[place];
  if (!table) return null;
  return table[job] ?? null;
};

const fmtMins = (m: number | null) => {
  if (m == null) return "—";
  const h = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
};

const STANDARD_MINUTES = 9 * 60;

const getOvertimeMinutes = (m: number | null) => {
  if (m == null) return 0;
  return Math.max(0, Math.round(m - STANDARD_MINUTES));
};

const getOvertimePay = (place: string | null, job: string | null, m: number | null) => {
  const price = getPrice(place, job);
  const ot = getOvertimeMinutes(m);
  if (price == null || ot <= 0) return 0;
  return (price / 9) * (ot / 60);
};



const isDuplicateEmployeeError = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as { code?: string; message?: string };
  return maybeError.code === "23505" || (maybeError.message ?? "").toLowerCase().includes("duplicate key");
};


function Dashboard() {
  const { user, isAdmin, isView, loading } = useAuth();
  const [records, setRecords] = useState<Attendance[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [myPlace, setMyPlace] = useState<string | null>(null);
  const [jobTitle, setJobTitle] = useState<string>("");
  const [extracted, setExtracted] = useState<{ name: string; id: string; isNew: boolean } | null>(null);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [projectFilter, setProjectFilter] = useState<string>("__all__");
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [leaveTarget, setLeaveTarget] = useState<Attendance | null>(null);
  const [leaveNote, setLeaveNote] = useState("");
  const [manualCapture, setManualCapture] = useState<{ path: string; name: string; id: string } | null>(null);
  const [leavingBusy, setLeavingBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const pickPhoto = () => {
    if (!jobTitle) { toast.error("Please select a job title first"); return; }
    fileInputRef.current?.click();
  };

  const loadRecords = useCallback(async () => {
    if (!user) return;
    const all: Attendance[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      let q = supabase
        .from("attendance")
        .select("*")
        .order("captured_at", { ascending: false })
        .range(from, from + pageSize - 1);
      if (isView) {
        if (myPlace && myPlace !== "All") q = q.eq("place", myPlace);
      } else if (!isAdmin) {
        q = q.eq("recorded_by", user.id);
      }
      const { data, error } = await q;
      if (error) break;
      const rows = (data ?? []) as Attendance[];
      all.push(...rows);
      if (rows.length < pageSize) break;
    }
    setRecords(all);
  }, [user, isAdmin, isView, myPlace]);


  const loadProfile = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from("profiles").select("project_name, place").eq("id", user.id).maybeSingle();
    setProject(data?.project_name ?? "");
    setMyPlace(data?.place ?? null);
  }, [user]);

  useEffect(() => { loadRecords(); loadProfile(); }, [loadRecords, loadProfile]);

  useEffect(() => {
    if (!isAdmin && !isView) return;
    supabase.from("projects").select("id, name").order("name").then(({ data }) => {
      setProjects(data ?? []);
    });
  }, [isAdmin, isView]);



  const saveAttendance = async (path: string, name: string, id: string) => {
    if (!user) throw new Error("Please log in again");
    let isNew = false;
    let existed = false;
    if (id) {
      const { data: existing } = await supabase
        .from("employees").select("id").eq("employee_id", id).maybeSingle();
      existed = !!existing;
    }
    // Finds the employee even if another user added them, otherwise creates it
    const { data: empId, error: empErr } = await (supabase.rpc as any)("get_or_create_employee", {
      _full_name: name || "Unknown", _employee_id: id || "", _photo_path: path,
    });
    if (empErr) throw empErr;
    const employeeId = empId as string;
    isNew = !existed;

    const { error: insErr } = await supabase.from("attendance").insert({
      employee_id: employeeId,
      recorded_by: user.id,
      extracted_name: name || null,
      extracted_id: id || null,
      photo_path: path,
      project_name: project || null,
      place: myPlace || null,
      job_title: jobTitle,
    });
    if (insErr) throw insErr;

    setExtracted({ name, id, isNew });
    toast.success(isNew ? `New employee ${name || id} added & checked in` : `${name || id || "Employee"} checked in`);
    await loadRecords();
  };

  const handleFile = async (file: File) => {
    if (!user) return;
    if (!jobTitle) { toast.error("Please select a job title first"); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error("Image too large (max 10MB)"); return; }
    setBusy(true);
    setExtracted(null);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      setPreview(base64);

      const path = `${user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("id-photos").upload(path, file);
      if (upErr) throw upErr;

      let name = "";
      let id = "";
      try {
        const { data: ai, error: aiErr } = await supabase.functions.invoke("extract-id", {
          body: { imageBase64: base64 },
        });
        if (aiErr) throw aiErr;
        if (ai?.error) throw new Error(ai.error);
        name = (ai?.name ?? "").trim();
        id = (ai?.id ?? "").trim();
      } catch {
        name = "";
        id = "";
      }

      if (!name && !id) {
        setManualCapture({ path, name: "", id: "" });
        toast.error("Could not read the ID. Enter the name or ID to save attendance.");
        return;
      }

      await saveAttendance(path, name, id);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to capture attendance");
    } finally {
      setBusy(false);
    }
  };

  const submitManualCapture = async () => {
    if (!manualCapture) return;
    const name = manualCapture.name.trim();
    const id = manualCapture.id.trim();
    if (!name && !id) { toast.error("Enter a name or ID"); return; }
    setBusy(true);
    try {
      await saveAttendance(manualCapture.path, name, id);
      setManualCapture(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save attendance");
    } finally {
      setBusy(false);
    }
  };

  const openLeave = (r: Attendance) => {
    setLeaveTarget(r);
    setLeaveNote("");
  };

  const submitLeave = async () => {
    if (!leaveTarget) return;
    setLeavingBusy(true);
    const { error } = await supabase
      .from("attendance")
      .update({ checked_out_at: new Date().toISOString(), leave_note: leaveNote.trim() || null })
      .eq("id", leaveTarget.id);
    setLeavingBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Checked out");
    setLeaveTarget(null);
    setLeaveNote("");
    await loadRecords();
  };

  const filteredRecords = useMemo(() => {
    const s = search.trim().toLowerCase();
    const from = dateFrom ? startOfDay(parseISO(dateFrom)) : null;
    const to = dateTo ? endOfDay(parseISO(dateTo)) : null;

    return records.filter((r) => {
      const cap = parseISO(r.captured_at);
      if (from && cap < from) return false;
      if (to && cap > to) return false;
      if ((isAdmin || isView) && projectFilter !== "__all__" && (r.project_name ?? "") !== projectFilter) return false;
      if (!s) return true;
      return (
        (r.extracted_name ?? "").toLowerCase().includes(s) ||
        (r.extracted_id ?? "").toLowerCase().includes(s) ||
        (r.project_name ?? "").toLowerCase().includes(s) ||
        (r.place ?? "").toLowerCase().includes(s) ||
        (r.job_title ?? "").toLowerCase().includes(s) ||
        format(cap, "yyyy-MM-dd").includes(s) ||
        format(cap, "PP").toLowerCase().includes(s)
      );
    });
  }, [records, search, dateFrom, dateTo, isAdmin, isView, projectFilter]);

  const peopleCount = useMemo(() => {
    const ids = new Set<string>();
    for (const r of filteredRecords) ids.add(r.extracted_id || r.extracted_name || r.id);
    return ids.size;
  }, [filteredRecords]);

  const totalPrice = useMemo(
    () => filteredRecords.reduce((sum, r) => sum + (getPrice(r.place, r.job_title) ?? 0), 0),
    [filteredRecords],
  );

  const totalOvertimeMinutes = useMemo(
    () => filteredRecords.reduce((sum, r) => sum + getOvertimeMinutes(r.total_minutes), 0),
    [filteredRecords],
  );

  const totalOvertimePay = useMemo(
    () => filteredRecords.reduce((sum, r) => sum + getOvertimePay(r.place, r.job_title, r.total_minutes), 0),
    [filteredRecords],
  );

  const projectTotals = useMemo(() => {
    const map = new Map<string, { project: string; people: Set<string>; records: number; price: number; otMins: number; otPay: number }>();
    for (const r of filteredRecords) {
      const key = r.project_name || "—";
      let entry = map.get(key);
      if (!entry) {
        entry = { project: key, people: new Set<string>(), records: 0, price: 0, otMins: 0, otPay: 0 };
        map.set(key, entry);
      }
      entry.people.add(r.extracted_id || r.extracted_name || r.id);
      entry.records += 1;
      entry.price += getPrice(r.place, r.job_title) ?? 0;
      entry.otMins += getOvertimeMinutes(r.total_minutes);
      entry.otPay += getOvertimePay(r.place, r.job_title, r.total_minutes);
    }
    return Array.from(map.values()).sort((a, b) => a.project.localeCompare(b.project));
  }, [filteredRecords]);


  if (!loading && !user) throw redirect({ to: "/login" });
  if (loading || !user) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="min-h-screen">
      <AppHeader isAdmin={isAdmin} isView={isView} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-8">
          <h1 className="font-display text-4xl font-semibold">Capture attendance</h1>
          <p className="mt-1 text-muted-foreground">
            {project ? <>Project: <span className="font-medium text-foreground">{project}</span></> : "No project assigned — ask your admin to set one."}
            {myPlace ? <> · Place: <span className="font-medium text-foreground">{myPlace}</span></> : null}
          </p>
        </div>

        {!isView && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-6">
            <div className="flex flex-col items-center">
              <div className="flex h-72 w-full items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-border bg-muted/30">
                {preview ? (
                  <img src={preview} alt="ID preview" className="h-full w-full object-contain" />
                ) : (
                  <div className="text-center text-muted-foreground">
                    <Camera className="mx-auto h-10 w-10 opacity-40" />
                    <p className="mt-2 text-sm">No photo yet</p>
                  </div>
                )}
              </div>

              <div className="mt-4 w-full">
                <Label>Job title <span className="text-destructive">*</span></Label>
                <select
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  required
                  dir="rtl"
                  className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="" disabled>اختر المسمى الوظيفي</option>
                  {JOB_TITLES.map((j) => {
                    const p = getPrice(myPlace, j);
                    return (
                      <option key={j} value={j}>
                        {j}{p != null ? ` — ${p} SAR` : ""}
                      </option>
                    );
                  })}
                </select>
                {jobTitle && getPrice(myPlace, jobTitle) != null && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Fixed price: <span className="font-medium text-foreground">{getPrice(myPlace, jobTitle)} SAR</span>
                  </p>
                )}
              </div>

              <div className="mt-4 flex w-full gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                    e.target.value = "";
                  }}
                />
                <Button onClick={pickPhoto} disabled={busy} className="flex-1" size="lg">
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
                  {busy ? "Processing..." : "Take ID photo"}
                </Button>
              </div>

            </div>
          </Card>

          <Card className="p-6">
            <h2 className="font-display text-2xl font-semibold">Extracted info</h2>
            {extracted ? (
              <div className="mt-4 space-y-3">
                <div><Label>Name</Label><Input value={extracted.name} readOnly /></div>
                <div><Label>ID</Label><Input value={extracted.id} readOnly /></div>
                <div><Label>Captured at</Label><Input value={fmtDateTime(now)} readOnly /></div>
                <div className="flex items-center gap-2 rounded-md bg-secondary p-3 text-sm text-secondary-foreground">
                  <Check className="h-4 w-4" style={{ color: "var(--gold)" }} />
                  {extracted.isNew ? "New employee added & attendance saved." : "Attendance saved."}
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                Snap an ID card and AI will read the name and ID number. Unknown IDs are auto-registered.
              </p>
            )}
          </Card>
        </div>
        )}

        <div className="mt-10">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="font-display text-2xl font-semibold">Recent attendance</h2>
              <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                {peopleCount} {peopleCount === 1 ? "person" : "people"}
                {project ? ` · ${project}` : ""}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-40"
              />
              <span className="text-sm text-muted-foreground">to</span>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-40"
              />
              {(isAdmin || isView) && (
                <select
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                  className="h-10 w-48 rounded-md border border-input bg-background px-3 text-sm"
                  aria-label="Filter by project"
                >
                  <option value="__all__">All projects</option>
                  {projects.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
              )}
              <Input placeholder="Search name, ID, project, date…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
            </div>
          </div>
          {isAdmin && projectTotals.length > 0 && (
            <Card className="mb-4 overflow-hidden">
              <div className="border-b border-border bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Totals by project
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/20 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2">Project</th>
                      <th className="px-4 py-2">Employees</th>
                      <th className="px-4 py-2">Records</th>
                      <th className="px-4 py-2">Total price (SAR)</th>
                      <th className="px-4 py-2">Overtime</th>
                      <th className="px-4 py-2">Overtime price (SAR)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectTotals.map((p) => (
                      <tr key={p.project} className="border-t border-border">
                        <td className="px-4 py-2 font-medium">{p.project}</td>
                        <td className="px-4 py-2">{p.people.size}</td>
                        <td className="px-4 py-2">{p.records}</td>
                        <td className="px-4 py-2 font-medium">{p.price} SAR</td>
                        <td className="px-4 py-2">{fmtMins(p.otMins)}</td>
                        <td className="px-4 py-2 font-medium">{p.otPay.toFixed(2)} SAR</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border bg-muted/30 font-semibold">
                      <td className="px-4 py-2">All projects</td>
                      <td className="px-4 py-2">{peopleCount}</td>
                      <td className="px-4 py-2">{filteredRecords.length}</td>
                      <td className="px-4 py-2">{totalPrice} SAR</td>
                      <td className="px-4 py-2">{fmtMins(totalOvertimeMinutes)}</td>
                      <td className="px-4 py-2">{totalOvertimePay.toFixed(2)} SAR</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          )}
          <Card className="overflow-hidden">

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">ID</th>
                    <th className="px-4 py-3">Job</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Project</th>
                    <th className="px-4 py-3">Place</th>
                    <th className="px-4 py-3">Time in</th>
                    <th className="px-4 py-3">Time out</th>
                    <th className="px-4 py-3">Total</th>
                    <th className="px-4 py-3">Price (SAR)</th>
                    <th className="px-4 py-3">Overtime</th>
                    <th className="px-4 py-3">Overtime price (SAR)</th>
                    <th className="px-4 py-3">Note</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.length === 0 ? (
                    <tr><td colSpan={14} className="px-4 py-8 text-center text-muted-foreground">No records</td></tr>
                  ) : filteredRecords.map((r) => {
                    const price = getPrice(r.place, r.job_title);
                    const otMins = getOvertimeMinutes(r.total_minutes);
                    const otPay = getOvertimePay(r.place, r.job_title, r.total_minutes);
                    return (
                    <tr key={r.id} className="border-t border-border">
                      <td className="px-4 py-3 font-medium">{r.extracted_name || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{r.extracted_id || "—"}</td>
                      <td className="px-4 py-3" dir="rtl">{r.job_title || "—"}</td>
                      <td className="px-4 py-3">{fmtDate(r.captured_at)}</td>
                      <td className="px-4 py-3">{r.project_name || "—"}</td>
                      <td className="px-4 py-3">{r.place || "—"}</td>
                      <td className="px-4 py-3">{fmtTime(r.captured_at)}</td>
                      <td className="px-4 py-3">{r.checked_out_at ? fmtTime(r.checked_out_at) : "—"}</td>
                      <td className="px-4 py-3">{fmtMins(r.total_minutes)}</td>
                      <td className="px-4 py-3 font-medium">{price != null ? price : "—"}</td>
                      <td className="px-4 py-3">{otMins > 0 ? fmtMins(otMins) : "—"}</td>
                      <td className="px-4 py-3 font-medium">{otPay > 0 ? otPay.toFixed(2) : "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground max-w-xs truncate" title={r.leave_note ?? ""}>{r.leave_note || "—"}</td>
                      <td className="px-4 py-3">
                        {!isView && !r.checked_out_at && (
                          <Button size="sm" variant="outline" onClick={() => openLeave(r)}>
                            <LogOut className="mr-1 h-3 w-3" /> Leave
                          </Button>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
                {filteredRecords.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-border bg-muted/30 font-medium">
                      <td className="px-4 py-3" colSpan={9}>Total</td>
                      <td className="px-4 py-3">{totalPrice} SAR</td>
                      <td className="px-4 py-3">{fmtMins(totalOvertimeMinutes)}</td>
                      <td className="px-4 py-3">{totalOvertimePay.toFixed(2)} SAR</td>
                      <td className="px-4 py-3" colSpan={2}></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Card>
        </div>
      </main>

      <Dialog open={!!manualCapture} onOpenChange={(o) => { if (!o) setManualCapture(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter ID details</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input
                value={manualCapture?.name ?? ""}
                onChange={(e) => setManualCapture((current) => current ? { ...current, name: e.target.value } : current)}
                placeholder="Employee name"
              />
            </div>
            <div>
              <Label>ID</Label>
              <Input
                value={manualCapture?.id ?? ""}
                onChange={(e) => setManualCapture((current) => current ? { ...current, id: e.target.value } : current)}
                placeholder="Employee ID"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualCapture(null)}>Cancel</Button>
            <Button onClick={submitManualCapture} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              Save attendance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!leaveTarget} onOpenChange={(o) => { if (!o) { setLeaveTarget(null); setLeaveNote(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave note</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {leaveTarget?.extracted_name || "Worker"} — add an optional note before checking out.
          </p>
          <Textarea
            value={leaveNote}
            onChange={(e) => setLeaveNote(e.target.value)}
            placeholder="Reason, hours, remarks…"
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setLeaveTarget(null); setLeaveNote(""); }}>Cancel</Button>
            <Button onClick={submitLeave} disabled={leavingBusy}>
              {leavingBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
              Confirm leave
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
