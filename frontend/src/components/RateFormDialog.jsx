import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import api, { formatApiErrorDetail } from "@/lib/api";
import { TRADE_TYPES } from "@/lib/tradeUtils";

const EMPTY = { work_item: "", trade_type: "other", unit: "", labour_low: "", labour_high: "", supply_install_low: "", supply_install_high: "", notes: "" };

const Field = ({ label, children, className = "" }) => (
  <div className={`space-y-1.5 ${className}`}>
    <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">{label}</Label>
    {children}
  </div>
);

export const RateFormDialog = ({ open, onOpenChange, rate, onSaved }) => {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const isEdit = Boolean(rate);
  const fieldCls = "bg-slate-800/50 border-slate-600";

  useEffect(() => {
    if (open) {
      setForm(rate ? {
        ...EMPTY, ...rate,
        labour_low: rate.labour_low ?? "", labour_high: rate.labour_high ?? "",
        supply_install_low: rate.supply_install_low ?? "", supply_install_high: rate.supply_install_high ?? "",
      } : EMPTY);
    }
  }, [open, rate]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const num = (v) => (v === "" || v === null ? null : parseFloat(v));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        work_item: form.work_item, trade_type: form.trade_type, unit: form.unit, notes: form.notes,
        labour_low: num(form.labour_low), labour_high: num(form.labour_high),
        supply_install_low: num(form.supply_install_low), supply_install_high: num(form.supply_install_high),
      };
      isEdit ? await api.put(`/rates/${rate.id}`, payload) : await api.post("/rates", payload);
      toast.success(isEdit ? "Rate item updated" : "Rate item added");
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || "Could not save that price.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-card border-slate-700" data-testid="rate-form-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg font-bold text-slate-100">{isEdit ? "Edit price" : "Add a price"}</DialogTitle>
          <DialogDescription className="text-slate-400 text-sm">Per-unit rates, AUD ex-GST.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-2 gap-4">
          <Field label="Work item *" className="col-span-2">
            <Input data-testid="rate-form-work-item" required className={fieldCls} value={form.work_item} onChange={set("work_item")} />
          </Field>
          <Field label="Trade">
            <Select value={form.trade_type} onValueChange={(v) => setForm((f) => ({ ...f, trade_type: v }))}>
              <SelectTrigger data-testid="rate-form-trade" className={fieldCls}><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-64">
                {TRADE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Unit">
            <Input data-testid="rate-form-unit" className={fieldCls} value={form.unit} onChange={set("unit")} placeholder="per m²" />
          </Field>
          <Field label="Labour low ($)">
            <Input data-testid="rate-form-labour-low" type="number" min="0" step="0.01" className={fieldCls} value={form.labour_low} onChange={set("labour_low")} />
          </Field>
          <Field label="Labour high ($)">
            <Input data-testid="rate-form-labour-high" type="number" min="0" step="0.01" className={fieldCls} value={form.labour_high} onChange={set("labour_high")} />
          </Field>
          <Field label="S&I low ($)">
            <Input data-testid="rate-form-si-low" type="number" min="0" step="0.01" className={fieldCls} value={form.supply_install_low} onChange={set("supply_install_low")} />
          </Field>
          <Field label="S&I high ($)">
            <Input data-testid="rate-form-si-high" type="number" min="0" step="0.01" className={fieldCls} value={form.supply_install_high} onChange={set("supply_install_high")} />
          </Field>
          <Field label="Notes" className="col-span-2">
            <Input data-testid="rate-form-notes" className={fieldCls} value={form.notes} onChange={set("notes")} />
          </Field>
          <div className="col-span-2 flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" data-testid="rate-form-cancel" onClick={() => onOpenChange(false)}
              className="border-slate-600 text-slate-300 hover:text-slate-100 hover:bg-slate-800">Cancel</Button>
            <Button type="submit" data-testid="rate-form-save-button" disabled={busy}
              className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : isEdit ? "Save" : "Add Item"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
