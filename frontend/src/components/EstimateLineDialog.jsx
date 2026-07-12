import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import api, { formatApiErrorDetail } from "@/lib/api";
import { ROADMAP_STAGES, formatMoney } from "@/lib/projectUtils";

const EMPTY = { description: "", stage_key: "lockup", rate_item_id: "none", quantity: "1", unit: "", rate: "", gst_applicable: true };

const rateRange = (item) => {
  if (!item) return null;
  const low = item.supply_install_low ?? item.labour_low;
  const high = item.supply_install_high ?? item.labour_high;
  if (low == null && high == null) return null;
  const lo = low ?? high;
  const hi = high ?? low;
  return { low: lo, mid: Math.round((lo + hi) / 2), high: hi };
};

export const EstimateLineDialog = ({ open, onOpenChange, projectId, line, rates, onSaved }) => {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const isEdit = Boolean(line);
  const fieldCls = "bg-slate-800/50 border-slate-600";

  useEffect(() => {
    if (open) {
      setForm(line ? {
        ...EMPTY, ...line, rate_item_id: line.rate_item_id || "none",
        quantity: String(line.quantity), rate: String(line.rate),
      } : EMPTY);
    }
  }, [open, line]);

  const selectedItem = rates.find((r) => r.id === form.rate_item_id);
  const range = rateRange(selectedItem);
  const total = (parseFloat(form.quantity) || 0) * (parseFloat(form.rate) || 0);

  const onPickRateItem = (v) => {
    const item = rates.find((r) => r.id === v);
    setForm((f) => ({
      ...f,
      rate_item_id: v,
      unit: item ? item.unit : f.unit,
      description: f.description || (item ? item.work_item : ""),
      rate: item && rateRange(item) ? String(rateRange(item).mid) : f.rate,
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        description: form.description,
        stage_key: form.stage_key,
        rate_item_id: form.rate_item_id === "none" ? null : form.rate_item_id,
        quantity: parseFloat(form.quantity) || 0,
        unit: form.unit,
        rate: parseFloat(form.rate) || 0,
        gst_applicable: form.gst_applicable,
      };
      isEdit ? await api.put(`/estimate-lines/${line.id}`, payload) : await api.post(`/projects/${projectId}/estimate/lines`, payload);
      toast.success(isEdit ? "Line updated" : "Line added");
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || "Failed to save line.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-card border-slate-700" data-testid="estimate-line-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg font-bold text-slate-100">{isEdit ? "Edit Estimate Line" : "Add Estimate Line"}</DialogTitle>
          <DialogDescription className="text-slate-400 text-sm">Pick a rate guide item to pre-fill, or enter a fully manual line.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">Rate guide item (optional)</Label>
            <Select value={form.rate_item_id} onValueChange={onPickRateItem}>
              <SelectTrigger data-testid="line-form-rate-item" className={fieldCls}><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="none">Manual line (no rate item)</SelectItem>
                {rates.map((r) => <SelectItem key={r.id} value={r.id}>{r.work_item} ({r.unit})</SelectItem>)}
              </SelectContent>
            </Select>
            {range && (
              <div className="flex gap-2 pt-1">
                {["low", "mid", "high"].map((k) => (
                  <button key={k} type="button" data-testid={`line-form-rate-${k}`}
                    onClick={() => setForm((f) => ({ ...f, rate: String(range[k]) }))}
                    className={`px-2.5 py-1 rounded-full border text-xs transition-colors duration-200 ${
                      String(range[k]) === form.rate
                        ? "border-amber-500 bg-amber-500/15 text-amber-300"
                        : "border-slate-600 text-slate-400 hover:border-amber-500/50 hover:text-amber-300"}`}>
                    {k.charAt(0).toUpperCase() + k.slice(1)} ${Number(range[k]).toLocaleString("en-AU")}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">Description *</Label>
            <Input data-testid="line-form-description" required className={fieldCls} value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">Stage</Label>
              <Select value={form.stage_key} onValueChange={(v) => setForm((f) => ({ ...f, stage_key: v }))}>
                <SelectTrigger data-testid="line-form-stage" className={fieldCls}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROADMAP_STAGES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">Unit</Label>
              <Input data-testid="line-form-unit" className={fieldCls} value={form.unit}
                onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} placeholder="m²" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">Quantity *</Label>
              <Input data-testid="line-form-quantity" type="number" min="0" step="0.01" required className={fieldCls}
                value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">Rate ($ ex-GST) *</Label>
              <Input data-testid="line-form-rate" type="number" min="0" step="0.01" required className={fieldCls}
                value={form.rate} onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border border-slate-700 bg-slate-800/40 px-4 py-2.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox data-testid="line-form-gst" checked={form.gst_applicable}
                onCheckedChange={(v) => setForm((f) => ({ ...f, gst_applicable: Boolean(v) }))} />
              <span className="text-sm text-slate-300">GST applies</span>
            </label>
            <span className="text-sm text-slate-300">
              Line total: <strong className="font-heading text-amber-400" data-testid="line-form-total">{formatMoney(total)}</strong>
            </span>
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="outline" data-testid="line-form-cancel" onClick={() => onOpenChange(false)}
              className="border-slate-600 text-slate-300 hover:text-slate-100 hover:bg-slate-800">Cancel</Button>
            <Button type="submit" data-testid="line-form-save-button" disabled={busy}
              className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : isEdit ? "Save" : "Add Line"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
