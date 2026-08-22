import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Loader2, GitBranch, CheckCircle2, XCircle, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { DatePicker } from "@/components/DatePicker";
import api, { formatApiErrorDetail } from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/projectUtils";

export const VARIATION_STATUS_STYLES = {
  proposed: "bg-sky-500/15 text-sky-400 border-sky-500/40",
  approved: "bg-emerald-600/20 text-emerald-400 border-emerald-600/40",
  rejected: "bg-red-500/15 text-red-400 border-red-500/40",
  billed: "bg-violet-500/15 text-violet-400 border-violet-500/40",
};

const EMPTY = { title: "", description: "", cost_delta: "", date: "" };

const Field = ({ label, children, className = "" }) => (
  <div className={`space-y-1.5 ${className}`}>
    <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">{label}</Label>
    {children}
  </div>
);

const VariationFormDialog = ({ open, onOpenChange, projectId, variation, onSaved }) => {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const isEdit = Boolean(variation);
  const fieldCls = "bg-slate-800/50 border-slate-600";

  useEffect(() => {
    if (open) {
      setForm(variation
        ? { title: variation.title, description: variation.description || "", cost_delta: String(variation.cost_delta), date: variation.date || "" }
        : EMPTY);
    }
  }, [open, variation]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        title: form.title,
        description: form.description,
        cost_delta: parseFloat(form.cost_delta) || 0,
        date: form.date || null,
      };
      isEdit
        ? await api.put(`/variations/${variation.id}`, payload)
        : await api.post(`/projects/${projectId}/variations`, payload);
      toast.success(isEdit ? "Variation updated" : "Variation added to the register");
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || "Failed to save variation.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-card border-slate-700" data-testid="variation-form-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl font-bold text-slate-100">
            {isEdit ? `Edit ${variation.number}` : "New Variation"}
          </DialogTitle>
          <DialogDescription className="text-slate-400 text-sm">
            Variation orders are numbered automatically. Approved variations adjust the contract value in the Budget tab.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4 mt-2">
          <Field label="Title *">
            <Input data-testid="variation-form-title" required className={fieldCls} value={form.title}
              onChange={set("title")} placeholder="e.g. Upgrade to 900mm freestanding oven" />
          </Field>
          <Field label="Description">
            <Textarea data-testid="variation-form-description" className={`${fieldCls} min-h-[80px]`}
              value={form.description} onChange={set("description")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cost delta (AUD, inc GST)">
              <Input data-testid="variation-form-cost" type="number" step="0.01" className={fieldCls}
                value={form.cost_delta} onChange={set("cost_delta")} placeholder="Negative for credits" />
            </Field>
            <Field label="Date">
              <DatePicker value={form.date} onChange={(v) => setForm((f) => ({ ...f, date: v }))}
                testId="variation-form-date" placeholder="Defaults to today" />
            </Field>
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="outline" data-testid="variation-form-cancel" onClick={() => onOpenChange(false)}
              className="border-slate-600 text-slate-300 hover:text-slate-100 hover:bg-slate-800">
              Cancel
            </Button>
            <Button type="submit" data-testid="variation-form-save" disabled={busy}
              className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : isEdit ? "Save Changes" : "Add Variation"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const TRANSITIONS = {
  proposed: [
    { to: "approved", label: "Approve", icon: CheckCircle2, cls: "text-emerald-400 hover:text-emerald-300" },
    { to: "rejected", label: "Reject", icon: XCircle, cls: "text-red-400 hover:text-red-300" },
  ],
  approved: [
    { to: "billed", label: "Mark billed", icon: ReceiptText, cls: "text-violet-400 hover:text-violet-300" },
    { to: "rejected", label: "Reject", icon: XCircle, cls: "text-red-400 hover:text-red-300" },
  ],
  rejected: [
    { to: "proposed", label: "Re-propose", icon: GitBranch, cls: "text-sky-400 hover:text-sky-300" },
  ],
  billed: [],
};

export const VariationsTab = ({ projectId, onChanged }) => {
  const [variations, setVariations] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const fetchData = useCallback(async () => {
    const { data } = await api.get(`/projects/${projectId}/variations`);
    setVariations(data);
  }, [projectId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const setStatus = async (v, status) => {
    try {
      await api.put(`/variations/${v.id}`, { status });
      toast.success(`${v.number} marked ${status}`);
      fetchData();
      onChanged?.();
    } catch (e) {
      toast.error("Failed to update variation status.");
    }
  };

  const remove = async (v) => {
    try {
      await api.delete(`/variations/${v.id}`);
      toast.success(`${v.number} deleted`);
      fetchData();
      onChanged?.();
    } catch (e) {
      toast.error("Failed to delete variation.");
    }
  };

  if (!variations) return <p className="text-sm text-slate-400">Loading variations…</p>;

  const approvedTotal = variations
    .filter((v) => v.status === "approved" || v.status === "billed")
    .reduce((s, v) => s + (v.cost_delta || 0), 0);

  return (
    <div data-testid="variations-tab">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-2">
          <GitBranch className="h-5 w-5 text-amber-400" aria-hidden="true" />
          <h3 className="font-heading text-lg font-bold uppercase tracking-wider text-slate-100">Variations Register</h3>
          {variations.length > 0 && (
            <span className="text-xs text-slate-500" data-testid="variations-approved-total">
              Approved impact:{" "}
              <span className={approvedTotal < 0 ? "text-red-400" : "text-emerald-400"}>
                {approvedTotal >= 0 ? "+" : "−"}{formatMoney(Math.abs(approvedTotal))}
              </span>
            </span>
          )}
        </div>
        <Button data-testid="add-variation-button" onClick={() => { setEditing(null); setFormOpen(true); }}
          className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
          <Plus className="h-4 w-4" aria-hidden="true" /> New Variation
        </Button>
      </div>

      {variations.length === 0 ? (
        <div className="rounded-md border border-slate-700 bg-slate-800/30 p-10 text-center" data-testid="variations-empty">
          <GitBranch className="h-8 w-8 text-slate-600 mx-auto mb-3" aria-hidden="true" />
          <p className="text-sm text-slate-400 mb-1">No variations recorded.</p>
          <p className="text-xs text-slate-500 mb-4">Track client-requested changes here — approved variations automatically adjust the contract value.</p>
          <Button data-testid="variations-empty-add" onClick={() => { setEditing(null); setFormOpen(true); }}
            className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
            <Plus className="h-4 w-4" aria-hidden="true" /> New Variation
          </Button>
        </div>
      ) : (
        <div className="rounded-md border border-slate-700 bg-card overflow-x-auto">
          <table className="w-full text-sm" data-testid="variations-table">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/40 text-[10px] uppercase tracking-[0.2em] text-slate-500">
                <th className="text-left px-4 py-2.5 font-medium">No.</th>
                <th className="text-left px-4 py-2.5 font-medium">Variation</th>
                <th className="text-left px-4 py-2.5 font-medium">Date</th>
                <th className="text-right px-4 py-2.5 font-medium">Cost Delta</th>
                <th className="text-left px-4 py-2.5 font-medium">Status</th>
                <th className="text-right px-4 py-2.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {variations.map((v) => (
                <tr key={v.id} data-testid={`variation-row-${v.id}`}>
                  <td className="px-4 py-2.5 font-heading font-bold text-amber-400 whitespace-nowrap">{v.number}</td>
                  <td className="px-4 py-2.5">
                    <p className="text-slate-200 font-medium">{v.title}</p>
                    {v.description && <p className="text-xs text-slate-500 line-clamp-2">{v.description}</p>}
                  </td>
                  <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">{formatDate(v.date)}</td>
                  <td className={`px-4 py-2.5 text-right font-medium whitespace-nowrap ${v.cost_delta < 0 ? "text-red-400" : "text-emerald-400"}`}>
                    {v.cost_delta >= 0 ? "+" : "−"}{formatMoney(Math.abs(v.cost_delta))}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge variant="outline" className={`uppercase tracking-wider text-[10px] ${VARIATION_STATUS_STYLES[v.status]}`}
                      data-testid={`variation-status-${v.id}`}>
                      {v.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      {(TRANSITIONS[v.status] || []).map((t) => (
                        <button key={t.to} data-testid={`variation-${t.to}-${v.id}`} title={t.label}
                          onClick={() => setStatus(v, t.to)}
                          className={`p-1.5 rounded-md transition-colors duration-200 ${t.cls}`}>
                          <t.icon className="h-4 w-4" aria-hidden="true" />
                        </button>
                      ))}
                      <button data-testid={`variation-edit-${v.id}`} onClick={() => { setEditing(v); setFormOpen(true); }}
                        className="p-1.5 rounded-md text-slate-500 hover:text-amber-400 transition-colors duration-200">
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button data-testid={`variation-delete-${v.id}`}
                            className="p-1.5 rounded-md text-slate-500 hover:text-red-400 transition-colors duration-200" title="Delete" aria-label="Delete">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="bg-card border-slate-700">
                          <AlertDialogHeader>
                            <AlertDialogTitle className="text-slate-100">Delete {v.number}?</AlertDialogTitle>
                            <AlertDialogDescription className="text-slate-400">
                              This removes the variation from the register. If it was approved, the adjusted contract value will change.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="bg-slate-800 border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-slate-100">Cancel</AlertDialogCancel>
                            <AlertDialogAction data-testid={`variation-delete-confirm-${v.id}`} onClick={() => remove(v)}
                              className="bg-red-600 text-white hover:bg-red-500">Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <VariationFormDialog open={formOpen} onOpenChange={setFormOpen} projectId={projectId} variation={editing}
        onSaved={() => { fetchData(); onChanged?.(); }} />
    </div>
  );
};
