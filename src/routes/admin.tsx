import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, UserPlus, Download, Trash2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import ExcelJS from "exceljs";
import logoUrl from "@/assets/finemark-logo.jpeg";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — Attendly" }] }),
  component: AdminPage,
});

type Employee = { id: string; full_name: string; employee_id: string | null };
type AppUser = { id: string; full_name: string; email: string | null; employee_id: string | null; project_name: string | null; place: string | null; role: "admin" | "user" | "view" };
type Project = { id: string; name: string };

const PLACES = ["Jeddah", "Riyad", "All"] as const;

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

async function getFunctionErrorMessage(err: unknown, fallback = "Failed") {
  const context = (err as { context?: Response })?.context;
  if (context instanceof Response) {
    try {
      const payload = await context.clone().json();
      if (payload?.error) return String(payload.error);
      if (payload?.message) return String(payload.message);
    } catch {
      const text = await context.clone().text().catch(() => "");
      if (text) return text;
    }
  }
  return err instanceof Error ? err.message : fallback;
}

function AdminPage() {
  const { user, isAdmin, loading } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [newProject, setNewProject] = useState("");
  const [projBusy, setProjBusy] = useState(false);
  const [uEmail, setUEmail] = useState("");
  const [uPass, setUPass] = useState("");
  const [uPassVisible, setUPassVisible] = useState(false);
  const [uName, setUName] = useState("");
  const [uEid, setUEid] = useState("");
  const [uProject, setUProject] = useState("");
  const [uPlace, setUPlace] = useState<string>("Jeddah");
  const [uRole, setURole] = useState<"admin" | "user" | "view">("user");
  const [uBusy, setUBusy] = useState(false);
  const [exportStart, setExportStart] = useState("");
  const [exportEnd, setExportEnd] = useState("");
  const [exportProject, setExportProject] = useState<string>("__all__");
  const [exportAll, setExportAll] = useState(true);
  const [selectedExportEmps, setSelectedExportEmps] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [empProjects, setEmpProjects] = useState<Record<string, Set<string>>>({});


  const load = useCallback(async () => {
    const fetchAllEmployees = async () => {
      const PAGE = 1000;
      const out: Employee[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data } = await supabase
          .from("employees")
          .select("id, full_name, employee_id")
          .order("created_at", { ascending: false })
          .range(from, from + PAGE - 1);
        out.push(...((data ?? []) as Employee[]));
        if (!data || data.length < PAGE) break;
      }
      return { data: out };
    };
    const [{ data: e }, { data: p }, { data: rs }, { data: pr }] = await Promise.all([
      fetchAllEmployees(),
      supabase.from("profiles").select("id, full_name, email, employee_id, project_name, place").order("created_at", { ascending: false }),
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("projects").select("id, name").order("name"),
    ]);
    setEmployees(e ?? []);

    setProjects((pr ?? []) as Project[]);

    // Map employees -> projects they have attendance in (for the export filter)
    const PAGE = 1000;
    const map: Record<string, Set<string>> = {};
    for (let from = 0; ; from += PAGE) {
      const { data } = await supabase
        .from("attendance")
        .select("employee_id, project_name")
        .not("employee_id", "is", null)
        .range(from, from + PAGE - 1);
      (data ?? []).forEach((a) => {
        if (!a.employee_id || !a.project_name) return;
        if (!map[a.employee_id]) map[a.employee_id] = new Set();
        map[a.employee_id].add(a.project_name);
      });
      if (!data || data.length < PAGE) break;
    }
    setEmpProjects(map);
    const roleMap = new Map((rs ?? []).map((r: { user_id: string; role: string }) => [r.user_id, r.role]));

    setUsers(((p ?? []) as Omit<AppUser, "role">[]).map((u) => ({ ...u, role: (roleMap.get(u.id) as AppUser["role"]) ?? "user" })));
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  if (!loading && !user) throw redirect({ to: "/login" });
  if (loading || !user) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!isAdmin) {
    return (
      <div className="min-h-screen">
        <AppHeader isAdmin={false} />
        <div className="mx-auto max-w-md px-4 py-20 text-center">
          <h1 className="font-display text-3xl font-semibold">Admins only</h1>
          <p className="mt-2 text-muted-foreground">You don't have permission to view this page.</p>
        </div>
      </div>
    );
  }

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uEmail.trim() || !uPass.trim()) return;
    setUBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-create-user", {
        body: {
          email: uEmail.trim(), password: uPass, full_name: uName.trim(),
          employee_id: uEid.trim() || null, project_name: uProject || null,
          place: uPlace, role: uRole,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`User ${uEmail} created`);
      setUEmail(""); setUPass(""); setUName(""); setUEid(""); setUProject(""); setUPlace("Jeddah"); setURole("user");
      load();
    } catch (err: unknown) {
      toast.error(await getFunctionErrorMessage(err));
    } finally { setUBusy(false); }
  };

  const addProject = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newProject.trim();
    if (!name) return;
    setProjBusy(true);
    try {
      const { error } = await supabase.from("projects").insert({ name, created_by: user.id });
      if (error) throw error;
      toast.success(`Project "${name}" added`);
      setNewProject("");
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to add project");
    } finally { setProjBusy(false); }
  };

  const deleteProject = async (id: string, name: string) => {
    if (!confirm(`Delete project "${name}"?`)) return;
    try {
      const { error } = await supabase.from("projects").delete().eq("id", id);
      if (error) throw error;
      toast.success("Project deleted");
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  const exportEmployees = employees.filter((e) =>
    exportProject === "__all__" ? true : (empProjects[e.id]?.has(exportProject) ?? false),
  );

  const toggleExportEmp = (id: string) => {
    setSelectedExportEmps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };


  const csvEscape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const exportData = async () => {
    if (!exportStart || !exportEnd) { toast.error("Pick start and end dates"); return; }
    const startDate = new Date(exportStart);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(exportEnd);
    endDate.setHours(23, 59, 59, 999);
    const startISO = startDate.toISOString();
    const endISO = endDate.toISOString();
    if (endDate <= startDate) { toast.error("End must be after start"); return; }
    const empIds = exportAll ? exportEmployees.map((e) => e.id) : Array.from(selectedExportEmps);
    if (empIds.length === 0) { toast.error("Select at least one employee"); return; }
    setExporting(true);
    try {
      // Fetch every matching row in pages (the API caps a single request at 1000 rows)
      const PAGE = 1000;
      type AttRow = Tables<"attendance">;
      const att: AttRow[] = [];
      // When exporting everyone, don't send a huge id filter (long URLs get truncated/rejected).
      // Otherwise fetch in id-chunks so the URL stays short and no employee is dropped.
      const CHUNK = 100;
      const idChunks: (string[] | null)[] = exportAll
        ? [null]
        : Array.from({ length: Math.ceil(empIds.length / CHUNK) }, (_, i) =>
            empIds.slice(i * CHUNK, i * CHUNK + CHUNK),
          );

      for (const chunk of idChunks) {
        for (let from = 0; ; from += PAGE) {
          let q = supabase.from("attendance").select("*")
            .gte("captured_at", startISO).lte("captured_at", endISO);
          if (chunk) q = q.in("employee_id", chunk);
          if (exportProject !== "__all__") q = q.eq("project_name", exportProject);
          const { data, error } = await q.order("captured_at").range(from, from + PAGE - 1);
          if (error) throw error;
          att.push(...((data ?? []) as AttRow[]));
          if (!data || data.length < PAGE) break;
        }
      }
      att.sort((a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime());


      const eMap = new Map(employees.map((e) => [e.id, e]));
      const uMap = new Map(users.map((u) => [u.id, u]));
      const fmtMins = (m: number | null | undefined) => {
        if (m == null) return "";
        const h = Math.floor(m / 60); const mm = Math.round(m % 60);
        return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
      };

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Attendance", { views: [{ state: "frozen", ySplit: 4 }] });
      const headers = ["Added By", "Name", "ID", "Job", "Project", "Place", "Date", "Time", "Time Out", "Total Time", "Price (SAR)", "Overtime", "Overtime Price (SAR)", "Note"];
      const widths = [18, 28, 14, 12, 26, 10, 12, 10, 10, 12, 12, 12, 18, 30];
      ws.columns = widths.map((w) => ({ width: w }));

      // Rows 1-3 reserved for header band
      ws.mergeCells("A1:A3");
      ws.mergeCells("B1:F3");
      ws.mergeCells("G1:I3");
      ws.mergeCells("J1:N3");


      // Logo
      try {
        const logoBuf = await (await fetch(logoUrl)).arrayBuffer();
        const imgId = wb.addImage({ buffer: logoBuf, extension: "jpeg" });
        ws.addImage(imgId, { tl: { col: 0.15, row: 0.15 }, ext: { width: 130, height: 45 } });
      } catch { /* ignore */ }

      const projectLabel = exportProject !== "__all__"
        ? exportProject
        : Array.from(new Set((att ?? []).map((a) => a.project_name).filter(Boolean))).join(" / ") || "All projects";
      const titleCell = ws.getCell("B1");
      titleCell.value = `( ${projectLabel} )`;
      titleCell.alignment = { horizontal: "center", vertical: "middle" };
      titleCell.font = { bold: true, size: 12 };
      titleCell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };

      const dateCell = ws.getCell("J1");
      dateCell.value = `تاريخ البداية  ${format(new Date(exportStart), "dd/MM/yyyy")}\nتاريخ النهاية  ${format(new Date(exportEnd), "dd/MM/yyyy")}`;
      dateCell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      dateCell.font = { bold: true, size: 10 };
      dateCell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };

      ws.getRow(1).height = 22;
      ws.getRow(2).height = 22;
      ws.getRow(3).height = 22;

      // Header row (row 4)
      const headerRow = ws.getRow(4);
      headers.forEach((h, i) => {
        const c = headerRow.getCell(i + 1);
        c.value = h;
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } };
        c.font = { bold: true, color: { argb: "FFFFFFFF" } };
        c.alignment = { horizontal: "center", vertical: "middle" };
        c.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
      });
      headerRow.height = 22;

      let totalPrice = 0;
      let totalOtPrice = 0;
      (att ?? []).forEach((a) => {
        const e = a.employee_id ? eMap.get(a.employee_id) : null;
        const recorder = a.recorded_by ? uMap.get(a.recorded_by) : null;
        const price = getPrice(a.place, (a as { job_title?: string | null }).job_title ?? null);
        if (price != null) totalPrice += price;
        const mins = a.total_minutes as number | null;
        const otMins = mins != null && mins > 540 ? mins - 540 : 0;
        const otPrice = price != null && otMins > 0 ? Math.round((price / 9) * (otMins / 60) * 100) / 100 : 0;
        totalOtPrice += otPrice;
        const row = ws.addRow([
          recorder?.full_name ?? recorder?.email ?? "",
          e?.full_name ?? a.extracted_name ?? "",
          e?.employee_id ?? a.extracted_id ?? "",
          (a as { job_title?: string | null }).job_title ?? "",
          a.project_name ?? "",
          a.place ?? "",
          format(new Date(a.captured_at), "dd/MM/yyyy"),
          format(new Date(a.captured_at), "HH:mm:ss"),
          a.checked_out_at ? format(new Date(a.checked_out_at), "HH:mm:ss") : "",
          fmtMins(mins),
          price != null ? price : "",
          otMins > 0 ? fmtMins(otMins) : "",
          otPrice > 0 ? otPrice : "",
          (a as { leave_note?: string | null }).leave_note ?? "",
        ]);

        row.eachCell({ includeEmpty: true }, (cell) => {
          cell.alignment = { horizontal: "center", vertical: "middle" };
          cell.border = { top: { style: "thin", color: { argb: "FFD0D0D0" } }, bottom: { style: "thin", color: { argb: "FFD0D0D0" } }, left: { style: "thin", color: { argb: "FFD0D0D0" } }, right: { style: "thin", color: { argb: "FFD0D0D0" } } };
        });
      });

      if ((att ?? []).length > 0) {
        const totalRow = ws.addRow(["", "", "", "", "", "", "", "", "", "Total", totalPrice, "", Math.round(totalOtPrice * 100) / 100, ""]);
        [10, 11, 12, 13].forEach((col) => {

          const c = totalRow.getCell(col);
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } };
          c.font = { bold: true, color: { argb: "FFFFFFFF" } };
          c.alignment = { horizontal: "center", vertical: "middle" };
          c.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
        });
      }


      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `finemark-attendance-${format(new Date(exportStart), "yyyyMMdd")}-${format(new Date(exportEnd), "yyyyMMdd")}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${(att?.length ?? 0)} attendance records`);
    } catch (err: unknown) {
      toast.error(await getFunctionErrorMessage(err, "Export failed"));
    } finally { setExporting(false); }
  };

  return (
    <div className="min-h-screen">
      <AppHeader isAdmin />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="font-display text-4xl font-semibold">Admin</h1>
        <p className="mt-1 text-muted-foreground">Manage app users and export data.</p>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card className="p-6">
            <h2 className="font-display text-2xl font-semibold">Add user</h2>
            <p className="mt-1 text-sm text-muted-foreground">Create a login for an admin, regular user, or viewer.</p>
            <form onSubmit={createUser} className="mt-4 space-y-3">
              <div><Label>Full name</Label><Input value={uName} onChange={(e) => setUName(e.target.value)} /></div>
              <div><Label>Email</Label><Input type="email" value={uEmail} onChange={(e) => setUEmail(e.target.value)} required /></div>
              <div>
                <Label>Password</Label>
                <div className="relative">
                  <Input type={uPassVisible ? "text" : "password"} value={uPass} onChange={(e) => setUPass(e.target.value)} required minLength={6} className="pr-10" />
                  <button type="button" onClick={() => setUPassVisible((v) => !v)} aria-label={uPassVisible ? "Hide password" : "Show password"} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {uPassVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div><Label>Employee ID (optional)</Label><Input value={uEid} onChange={(e) => setUEid(e.target.value)} /></div>
              <div>
                <Label>Project (optional)</Label>
                <select value={uProject} onChange={(e) => setUProject(e.target.value)} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">— None —</option>
                  <option value="All">All</option>
                  {projects.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Place</Label>
                  <select value={uPlace} onChange={(e) => setUPlace(e.target.value)} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                    {PLACES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Role</Label>
                  <select value={uRole} onChange={(e) => setURole(e.target.value as typeof uRole)} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                    <option value="view">View</option>
                  </select>
                </div>
              </div>
              <Button type="submit" disabled={uBusy} className="w-full">
                {uBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
                Create user
              </Button>
            </form>
          </Card>

          <Card className="p-6">
            <h2 className="font-display text-2xl font-semibold">App users ({users.length})</h2>
            <div className="mt-4 max-h-[600px] space-y-3 overflow-y-auto">
              {users.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No users</p>
              ) : users.map((u) => (
                <UserEditor key={u.id} user={u} currentUserId={user.id} projects={projects} onChanged={load} />
              ))}
            </div>
          </Card>
        </div>

        <Card className="mt-6 p-6">
          <h2 className="font-display text-2xl font-semibold">Projects</h2>
          <p className="mt-1 text-sm text-muted-foreground">Add project names available to assign to users.</p>
          <form onSubmit={addProject} className="mt-4 flex gap-2">
            <Input value={newProject} onChange={(e) => setNewProject(e.target.value)} placeholder="New project name" />
            <Button type="submit" disabled={projBusy}>
              {projBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
            </Button>
          </form>
          <div className="mt-4 flex flex-wrap gap-2">
            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">No projects yet</p>
            ) : projects.map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm">
                <span>{p.name}</span>
                <button type="button" onClick={() => deleteProject(p.id, p.name)} className="text-destructive hover:opacity-70">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </Card>

        <Card className="mt-6 p-6">
          <h2 className="font-display text-2xl font-semibold">Export data</h2>
          <p className="mt-1 text-sm text-muted-foreground">Download a CSV of attendance for a date range.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div><Label>Start date</Label><Input type="date" value={exportStart} onChange={(e) => setExportStart(e.target.value)} /></div>
            <div><Label>End date</Label><Input type="date" value={exportEnd} onChange={(e) => setExportEnd(e.target.value)} /></div>
          </div>
          <div className="mt-3">
            <Label>Project</Label>
            <select value={exportProject} onChange={(e) => { setExportProject(e.target.value); setSelectedExportEmps(new Set()); }} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="__all__">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Checkbox id="exportAll" checked={exportAll} onCheckedChange={(v) => setExportAll(!!v)} />
            <Label htmlFor="exportAll" className="cursor-pointer">All employees ({exportEmployees.length})</Label>
          </div>
          {!exportAll && (
            <div className="mt-3 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-3">
              {exportEmployees.map((e) => (
                <div key={e.id} className="flex items-center gap-2">
                  <Checkbox id={`exp-${e.id}`} checked={selectedExportEmps.has(e.id)} onCheckedChange={() => toggleExportEmp(e.id)} />
                  <Label htmlFor={`exp-${e.id}`} className="cursor-pointer text-sm font-normal">
                    {e.full_name}{e.employee_id ? ` · ${e.employee_id}` : ""}
                  </Label>
                </div>
              ))}
            </div>
          )}
          <Button onClick={exportData} disabled={exporting} className="mt-4">
            {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Export CSV
          </Button>
        </Card>
      </main>
    </div>
  );
}

function UserEditor({ user, currentUserId, projects, onChanged }: { user: AppUser; currentUserId: string; projects: Project[]; onChanged: () => void }) {
  const [project, setProject] = useState(user.project_name ?? "");
  const [place, setPlace] = useState(user.place ?? "Jeddah");
  const [role, setRole] = useState<AppUser["role"]>(user.role);
  const [password, setPassword] = useState("");
  const [passVisible, setPassVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { user_id: user.id };
      if (project !== (user.project_name ?? "")) body.project_name = project;
      if (place !== (user.place ?? "")) body.place = place;
      if (role !== user.role) body.role = role;
      if (password.trim()) body.password = password;
      if (Object.keys(body).length === 1) { toast.info("Nothing to update"); return; }
      const { data, error } = await supabase.functions.invoke("admin-update-user", { body });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("User updated");
      setPassword("");
      onChanged();
    } catch (err: unknown) {
      toast.error(await getFunctionErrorMessage(err));
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!confirm(`Delete ${user.full_name || user.email}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-delete-user", { body: { user_id: user.id } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("User deleted");
      onChanged();
    } catch (err: unknown) {
      toast.error(await getFunctionErrorMessage(err));
    } finally { setDeleting(false); }
  };

  const isSelf = user.id === currentUserId;

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium">{user.full_name}</div>
          <div className="text-xs text-muted-foreground">{user.email}{user.employee_id ? ` · ${user.employee_id}` : ""}</div>
        </div>
        {!isSelf && (
          <Button size="sm" variant="ghost" onClick={remove} disabled={deleting} className="text-destructive hover:text-destructive">
            {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          </Button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <select value={project} onChange={(e) => setProject(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-sm">
          <option value="">— No project —</option>
          <option value="All">All</option>
          {projects.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
        </select>
        <select value={place} onChange={(e) => setPlace(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-sm">
          {PLACES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={role} onChange={(e) => setRole(e.target.value as AppUser["role"])} className="h-8 rounded-md border border-input bg-background px-2 text-sm">
          <option value="user">User</option>
          <option value="admin">Admin</option>
          <option value="view">View</option>
        </select>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input type={passVisible ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password (optional)" className="h-8 pr-9 text-sm" />
          <button type="button" onClick={() => setPassVisible((v) => !v)} aria-label={passVisible ? "Hide password" : "Show password"} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            {passVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
        </Button>
      </div>
    </div>
  );
}
