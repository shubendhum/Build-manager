import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/DatePicker";
import api, { formatApiErrorDetail } from "@/lib/api";
import { ROADMAP_STAGES, formatMoney } from "@/lib/projectUtils";
import { QUOTE_STATUSES, autoGst } from "@/lib/tradeUtils";

const EMPTY = {
  work_package: "", trade_id: "", stage_key: "lockup", amount_ex_gst: "", gst_amount: "",
  quote_date: "", expiry_date: "", scope_description: "", exclusions: "", status: "pending",
};

const Field = ({ label, children, className = "" }) => (
  <div className={`space-y-1.5 ${className}`}>
    <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">{label}</Label>
    {children}
  </div>
);

export const QuoteFormDialog = ({ open, onOpenChange, projectId, quote, trades, onSaved }) => {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const isEdit = Boolean(quote);
  const fieldCls = "bg-slate-800/50 border-slate-600";

  useEffect(() => {
    if (open) {
      setForm(quote ? {
        ...EMPTY, ...quote,
        amount_ex_gst: String(quote.amount_ex_gst), gst_amount: String(quote.gst_amount),
        quote_date: quote.quote_date || "", expiry_date: quote.expiry_date || "",
      } : EMPTY);
    }
  }, [open, quote]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setVal = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const onExChange = (e) => {
    const ex = e.target.value;
    setForm((f) => ({ ...f, amount_ex_gst: ex, gst_amount: String(autoGst(ex)) }));
  };

  const total = (parseFloat(form.amount_ex_gst) || 0) + (parseFloat(form.gst_amount) || 0);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.trade_id) { toast.error("Select a trade for this quote."); return; }
    setBusy(true);
    try {
      const payload = {
        work_package: form.work_package,
        trade_id: form.trade_id,
        stage_key: form.stage_key,
        amount_ex_gst: parseFloat(form.amount_ex_gst) || 0,
        gst_amount: parseFloat(form.gst_amount) || 0,
        total_inc_gst: Math.round(total * 100) / 100,
        quote_date: form.quote_date || null,
        expiry_date: form.expiry_date || null,
        scope_description: form.scope_description,
        exclusions: form.exclusions,
        status: form.status,
      };
      isEdit ? await api.put(`/quotes/${quote.id}`, payload) : await api.post(`/projects/${projectId}/quotes`, payload);
      toast.success(isEdit ? "Quote updated" : "Quote added");
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || "Failed to save quote.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-card border-slate-700" data-testid="quote-form-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl font-bold text-slate-100">{isEdit ? "Edit Quote" : "Add Quote"}</DialogTitle>
          <DialogDescription className="text-slate-400 text-sm">Quotes are grouped by work package for comparison.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
          <Field label="Work package *" className="sm:col-span-2">
            <Input data-testid="quote-form-work-package" required className={fieldCls} value={form.work_package}
              onChange={set("work_package")} placeholder="e.g. Electrical rough-in + fit-off" />
          </Field>
          <Field label="Trade *">
            <Select value={form.trade_id} onValueChange={setVal("trade_id")}>
              <SelectTrigger data-testid="quote-form-trade" className={fieldCls}><SelectValue placeholder="Select trade" /></SelectTrigger>
              <SelectContent className="max-h-64">
                {trades.map((t) => <SelectItem key={t.id} value={t.id}>{t.business_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Stage">
            <Select value={form.stage_key} onValueChange={setVal("stage_key")}>
              <SelectTrigger data-testid="quote-form-stage" className={fieldCls}><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROADMAP_STAGES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Amount ex-GST *">
            <Input data-testid="quote-form-amount" type="number" min="0" step="0.01" required className={fieldCls}
              value={form.amount_ex_gst} onChange={onExChange} />
          </Field>
          <Field label="GST (auto 10%, editable)">
            <Input data-testid="quote-form-gst" type="number" min="0" step="0.01" className={fieldCls}
              value={form.gst_amount} onChange={set("gst_amount")} />
          </Field>
          <div className="sm:col-span-2 rounded-md border border-slate-700 bg-slate-800/40 px-4 py-2 text-sm text-slate-300">
            Total inc GST: <span className="font-heading font-bold text-amber-400" data-testid="quote-form-total">{formatMoney(total)}</span>
          </div>
          <Field label="Quote date">
            <DatePicker value={form.quote_date} onChange={setVal("quote_date")} testId="quote-form-date" />
          </Field>
          <Field label="Valid until">
            <DatePicker value={form.expiry_date} onChange={setVal("expiry_date")} testId="quote-form-expiry" />
          </Field>
          <Field label="Scope description" className="sm:col-span-2">
            <Textarea data-testid="quote-form-scope" className={`${fieldCls} min-h-[60px]`} value={form.scope_description} onChange={set("scope_description")} />
          </Field>
          <Field label="Exclusions" className="sm:col-span-2">
            <Textarea data-testid="quote-form-exclusions" className={`${fieldCls} min-h-[50px]`} value={form.exclusions} onChange={set("exclusions")} />
          </Field>
          {isEdit && (
            <Field label="Status">
              <Select value={form.status} onValueChange={setVal("status")}>
                <SelectTrigger data-testid="quote-form-status" className={fieldCls}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {QUOTE_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}
          <div className="sm:col-span-2 flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" data-testid="quote-form-cancel" onClick={() => onOpenChange(false)}
              className="border-slate-600 text-slate-300 hover:text-slate-100 hover:bg-slate-800">Cancel</Button>
            <Button type="submit" data-testid="quote-form-save-button" disabled={busy}
              className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : isEdit ? "Save" : "Add Quote"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
