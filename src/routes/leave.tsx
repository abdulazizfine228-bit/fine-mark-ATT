import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, CalendarDays, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export const Route = createFileRoute("/leave")({
  head: () => ({ meta: [{ title: "Leave — Attendly" }] }),
  component: LeavePage,
});

type Employee = { id: string; full_name: string; employee_id: string | null };
type Leave = {
  id: string;
  employee_id: string | null;
  start_at: string;
  end_at: string;
  reason: string | null;
  status: string;
  total_hours: number | null;
};

function LeavePage() {
  const { user, isAdmin, loading } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmp, setSelectedEmp] = useState<string>("");
  const [onLeave, setOnLeave] = useState(false);
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [items, setItems] = useState<Leave[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const [{ data: emps }, { data: leaves }] = await Promise.all([
      supabase.from("employees").select("id, full_name, employee_id").order("full_name"),
      supabase.from("leave_requests").select("*").order("created_at", { ascending: false }).limit(200),
    ]);
    setEmployees(emps ?? []);
    setItems((leaves ?? []) as Leave[]);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  if (!loading && !user) throw redirect({ to: "/login" });
  if (loading || !user) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onLeave) { toast.error("Tick the leave checkbox to submit"); return; }
    if (!selectedEmp) { toast.error("Choose an employee"); return; }
    if (!end) { toast.error("Pick the end date"); return; }
    const startDate = new Date();
    if (new Date(end) <= startDate) { toast.error("End must be after now"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.from("leave_requests").insert({
        employee_id: selectedEmp,
        created_by: user.id,
        user_id: user.id, // legacy
        start_at: startDate.toISOString(),
        end_at: new Date(end).toISOString(),
        reason: reason.trim() || null,
      });
      if (error) throw error;
      toast.success("Leave request submitted");
      setEnd(""); setReason(""); setOnLeave(false); setSelectedEmp("");
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to submit");
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("leave_requests").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Removed"); load(); }
  };

  const empMap = new Map(employees.map((e) => [e.id, e]));
  const totalApprovedHours = items.filter((i) => i.status === "approved").reduce((s, i) => s + (Number(i.total_hours) || 0), 0);
  const totalPendingHours = items.filter((i) => i.status === "pending").reduce((s, i) => s + (Number(i.total_hours) || 0), 0);

  return (
    <div className="min-h-screen">
      <AppHeader isAdmin={isAdmin} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-4xl font-semibold">Leave requests</h1>
            <p className="mt-1 text-muted-foreground">Pick the employee, set dates, track total hours.</p>
          </div>
          <div className="hidden gap-3 sm:flex">
            <Card className="px-4 py-3">
              <div className="text-xs uppercase text-muted-foreground">Approved</div>
              <div className="font-display text-2xl font-semibold" style={{ color: "var(--accent)" }}>{totalApprovedHours.toFixed(1)}h</div>
            </Card>
            <Card className="px-4 py-3">
              <div className="text-xs uppercase text-muted-foreground">Pending</div>
              <div className="font-display text-2xl font-semibold">{totalPendingHours.toFixed(1)}h</div>
            </Card>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-6">
            <h2 className="font-display text-2xl font-semibold">New request</h2>
            <form onSubmit={submit} className="mt-4 space-y-4">
              <div>
                <Label>Employee</Label>
                <Select value={selectedEmp} onValueChange={setSelectedEmp}>
                  <SelectTrigger><SelectValue placeholder={employees.length ? "Choose employee" : "No employees yet"} /></SelectTrigger>
                  <SelectContent>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.full_name} {e.employee_id ? `· ${e.employee_id}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
                <Checkbox id="onleave" checked={onLeave} onCheckedChange={(v) => setOnLeave(!!v)} />
                <div>
                  <Label htmlFor="onleave" className="cursor-pointer">This employee is on leave</Label>
                  <p className="text-xs text-muted-foreground">Tick to enable submission. Total hours auto-calculated.</p>
                </div>
              </div>
              <div>
                <Label htmlFor="end">End</Label>
                <Input id="end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
                <p className="mt-1 text-xs text-muted-foreground">Start is set to now when the request is submitted.</p>
              </div>
              <div>
                <Label htmlFor="reason">Reason (optional)</Label>
                <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Personal day, medical, etc." />
              </div>
              <Button type="submit" disabled={busy || !onLeave} className="w-full">
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarDays className="mr-2 h-4 w-4" />}
                Submit request
              </Button>
            </form>
          </Card>

          <Card className="p-6">
            <h2 className="font-display text-2xl font-semibold">All requests</h2>
            <div className="mt-4 space-y-3 max-h-[600px] overflow-y-auto">
              {items.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No leave requests yet</p>
              ) : items.map((it) => {
                const emp = it.employee_id ? empMap.get(it.employee_id) : null;
                return (
                  <div key={it.id} className="rounded-lg border border-border p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-medium">{emp?.full_name ?? "—"}{emp?.employee_id ? ` · ${emp.employee_id}` : ""}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {format(new Date(it.start_at), "PP p")} → {format(new Date(it.end_at), "PP p")}
                        </div>
                        {it.reason && <div className="mt-1 text-xs italic text-muted-foreground">"{it.reason}"</div>}
                      </div>
                      <span
                        className="rounded-full px-2 py-0.5 text-xs font-medium"
                        style={{
                          background: it.status === "approved" ? "var(--accent)" : it.status === "rejected" ? "var(--destructive)" : "var(--secondary)",
                          color: it.status === "pending" ? "var(--secondary-foreground)" : "var(--primary-foreground)",
                        }}
                      >{it.status}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="text-sm">
                        Total: <span className="font-display font-semibold" style={{ color: "var(--gold)" }}>{Number(it.total_hours ?? 0).toFixed(1)}h</span>
                      </div>
                      {it.status === "pending" && (
                        <Button variant="ghost" size="sm" onClick={() => remove(it.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
