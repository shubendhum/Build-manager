import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/DatePicker";
import api, { formatApiErrorDetail } from "@/lib/api";
import { TASK_STATUSES } from "@/lib/projectUtils";

const EMPTY = { title: "", description: "", status: "not-started", due_date: "", assigned_trade: "", trade_id: "none", is_mandatory_inspection: false };

export const TaskDialog = ({ open, onOpenChange, projectId, stageKey, task, onSaved }) => {
  const [form, setForm] = useState(EMPTY);
  const [trades, setTrades] = useState([]);
  const [busy, setBusy] = useState(false);
  const isEdit = Boolean(task);

  useEffect(() => {
    if (open) {
      setForm(task ? { ...EMPTY, ...task, due_date: task.due_date || "", trade_id: task.trade_id || "none" } : EMPTY);
      api.get("/trades").then(({ data }) => setTrades(data)).catch(() => {});
    }
  }, [open, task]);

  const fieldCls = "bg-slate-800/50 border-slate-600";

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        title: form.title,
        description: form.description,
        status: form.status,
        due_date: form.due_date || null,
        assigned_trade: form.assigned_trade,
        trade_id: form.trade_id === "none" ? null : form.trade_id,
        is_mandatory_inspection: form.is_mandatory_inspection,
      };
      if (isEdit) {
        await api.put(`/tasks/${task.id}`, payload);
      } else {
        await api.post(`/projects/${projectId}/tasks`, { ...payload, stage_key: stageKey });
      }
      toast.success(isEdit ? "Task updated" : "Task added");
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || "Could not save that task.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-card border-slate-700" data-testid="task-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg font-bold text-slate-100">{isEdit ? "Edit task" : "Add a task"}</DialogTitle>
          <DialogDescription className="text-slate-400 text-sm">
            {isEdit ? "Update task details." : "Add a custom task to this stage."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">Title *</Label>
            <Input data-testid="task-form-title" required className={fieldCls} value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">Description / compliance note</Label>
            <Textarea data-testid="task-form-description" className={`${fieldCls} min-h-[60px]`} value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                <SelectTrigger data-testid="task-form-status" className={fieldCls}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">Due date</Label>
              <DatePicker value={form.due_date} onChange={(v) => setForm((f) => ({ ...f, due_date: v }))} testId="task-form-due-date" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">Linked trade (from directory)</Label>
            <Select value={form.trade_id} onValueChange={(v) => setForm((f) => ({ ...f, trade_id: v }))}>
              <SelectTrigger data-testid="task-form-linked-trade" className={fieldCls}><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="none">No linked trade</SelectItem>
                {trades.map((t) => <SelectItem key={t.id} value={t.id}>{t.business_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">Assigned trade (free text)</Label>
            <Input data-testid="task-form-trade" className={fieldCls} value={form.assigned_trade} placeholder="e.g. ABC Concreting"
              onChange={(e) => setForm((f) => ({ ...f, assigned_trade: e.target.value }))} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox data-testid="task-form-inspection" checked={form.is_mandatory_inspection}
              onCheckedChange={(v) => setForm((f) => ({ ...f, is_mandatory_inspection: Boolean(v) }))} />
            <span className="text-sm text-slate-300">Mandatory RBS inspection</span>
          </label>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" data-testid="task-form-cancel" onClick={() => onOpenChange(false)}
              className="border-slate-600 text-slate-300 hover:text-slate-100 hover:bg-slate-800">Cancel</Button>
            <Button type="submit" data-testid="task-form-save-button" disabled={busy}
              className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : isEdit ? "Save" : "Add Task"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
