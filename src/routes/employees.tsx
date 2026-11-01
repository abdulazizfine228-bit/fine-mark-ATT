import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Trash2, Eye, Download } from "lucide-react";
import { toast } from "sonner";
import JSZip from "jszip";

export const Route = createFileRoute("/employees")({
  head: () => ({ meta: [{ title: "Employees — Attendly" }] }),
  component: EmployeesPage,
});

type Employee = { id: string; full_name: string; employee_id: string | null; created_at: string; id_photo_path: string | null };

function EmployeesPage() {
  const { user, isAdmin, loading } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [empProjects, setEmpProjects] = useState<Record<string, Set<string>>>({});
  const [projects, setProjects] = useState<string[]>([]);
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [viewName, setViewName] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: emps }, { data: att }] = await Promise.all([
      supabase.from("employees").select("*").order("created_at", { ascending: false }),
      supabase.from("attendance").select("employee_id, project_name").not("employee_id", "is", null),
    ]);
    setEmployees(emps ?? []);
    const map: Record<string, Set<string>> = {};
    const projSet = new Set<string>();
    (att ?? []).forEach((a) => {
      if (!a.employee_id || !a.project_name) return;
      if (!map[a.employee_id]) map[a.employee_id] = new Set();
      map[a.employee_id].add(a.project_name);
      projSet.add(a.project_name);
    });
    setEmpProjects(map);
    setProjects(Array.from(projSet).sort());
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const filtered = useMemo(() => {
    return employees.filter((e) => {
      if (projectFilter !== "all") {
        const set = empProjects[e.id];
        if (!set || !set.has(projectFilter)) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        if (!e.full_name.toLowerCase().includes(q) && !(e.employee_id ?? "").toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [employees, empProjects, projectFilter, search]);

  const allSelected = filtered.length > 0 && filtered.every((e) => selected.has(e.id));
  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelected) filtered.forEach((e) => next.delete(e.id));
    else filtered.forEach((e) => next.add(e.id));
    setSelected(next);
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  if (!loading && !user) throw redirect({ to: "/login" });
  if (loading || !user) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!isAdmin) {
    return (
      <div className="min-h-screen">
        <AppHeader isAdmin={false} />
        <div className="mx-auto max-w-md px-4 py-20 text-center">
          <h1 className="font-display text-3xl font-semibold">Admins only</h1>
        </div>
      </div>
    );
  }

  const viewCard = async (e: Employee) => {
    if (!e.id_photo_path) { toast.error("No ID photo"); return; }
    const { data, error } = await supabase.storage.from("id-photos").createSignedUrl(e.id_photo_path, 300);
    if (error || !data) { toast.error(error?.message ?? "Failed"); return; }
    setViewUrl(data.signedUrl);
    setViewName(e.full_name);
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this employee and all their attendance records?")) return;
    const { error } = await supabase.from("employees").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Deleted"); load(); }
  };

  const exportSelected = async () => {
    const targets = filtered.filter((e) => selected.has(e.id) && e.id_photo_path);
    if (targets.length === 0) { toast.error("Select employees with ID photos"); return; }
    setBusy(true);
    try {
      if (targets.length === 1) {
        const e = targets[0];
        const { data, error } = await supabase.storage.from("id-photos").download(e.id_photo_path!);
        if (error || !data) throw error ?? new Error("Download failed");
        const ext = (e.id_photo_path!.split(".").pop() ?? "jpg").split("?")[0];
        const safe = `${(e.employee_id || e.id).replace(/[^\w-]/g, "_")}_${e.full_name.replace(/[^\w\u0600-\u06FF-]/g, "_")}.${ext}`;
        const url = URL.createObjectURL(data);
        const a = document.createElement("a");
        a.href = url; a.download = safe; a.click(); URL.revokeObjectURL(url);
      } else {
        const zip = new JSZip();
        for (const e of targets) {
          const { data, error } = await supabase.storage.from("id-photos").download(e.id_photo_path!);
          if (error || !data) continue;
          const ext = (e.id_photo_path!.split(".").pop() ?? "jpg").split("?")[0];
          const safe = `${(e.employee_id || e.id).replace(/[^\w-]/g, "_")}_${e.full_name.replace(/[^\w\u0600-\u06FF-]/g, "_")}.${ext}`;
          zip.file(safe, data);
        }
        const blob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const suffix = projectFilter === "all" ? "all" : projectFilter.replace(/[^\w-]/g, "_");
        a.href = url; a.download = `id-cards-${suffix}.zip`; a.click(); URL.revokeObjectURL(url);
      }
      toast.success("Export ready");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally { setBusy(false); }
  };

  const deleteAllInProject = async () => {
    if (projectFilter === "all") { toast.error("Pick a project first"); return; }
    if (!confirm(`Delete ALL ${filtered.length} employees in project "${projectFilter}"? This also removes their attendance.`)) return;
    setBusy(true);
    const ids = filtered.map((e) => e.id);
    const { error } = await supabase.from("employees").delete().in("id", ids);
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success(`Deleted ${ids.length} employees`); setSelected(new Set()); load(); }
  };

  return (
    <div className="min-h-screen">
      <AppHeader isAdmin />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="font-display text-4xl font-semibold">Employees</h1>
        <p className="mt-1 text-muted-foreground">{employees.length} employees registered.</p>

        <Card className="mt-6 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-2xl font-semibold">All employees</h2>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={projectFilter} onValueChange={(v) => { setProjectFilter(v); setSelected(new Set()); }}>
                <SelectTrigger className="w-[200px]"><SelectValue placeholder="Project" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All projects</SelectItem>
                  {projects.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input placeholder="Search by name or ID…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-[220px]" />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={exportSelected} disabled={busy || selected.size === 0}>
              <Download className="mr-2 h-4 w-4" />Export ID cards ({selected.size})
            </Button>
            {projectFilter !== "all" && (
              <Button size="sm" variant="destructive" onClick={deleteAllInProject} disabled={busy || filtered.length === 0}>
                <Trash2 className="mr-2 h-4 w-4" />Delete all in "{projectFilter}"
              </Button>
            )}
            <span className="ml-auto text-sm text-muted-foreground">{filtered.length} shown</span>
          </div>

          <div className="mt-4 max-h-[600px] overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No employees</p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-3 border-b border-border px-3 pb-2 text-xs uppercase text-muted-foreground">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                  <span className="flex-1">Name / ID</span>
                  <span>Actions</span>
                </div>
                {filtered.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                    <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggleOne(p.id)} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{p.full_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.employee_id || "—"}
                        {empProjects[p.id] && empProjects[p.id].size > 0 && (
                          <span className="ml-2">· {Array.from(empProjects[p.id]).join(", ")}</span>
                        )}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => viewCard(p)} disabled={!p.id_photo_path}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(p.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </main>

      <Dialog open={!!viewUrl} onOpenChange={(o) => { if (!o) setViewUrl(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{viewName}</DialogTitle></DialogHeader>
          {viewUrl && <img src={viewUrl} alt={viewName} className="w-full rounded-lg" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
