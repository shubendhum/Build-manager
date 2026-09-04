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
import { formatMoney } from "@/lib/projectUtils";
import { autoGst } from "@/lib/tradeUtils";

const EMPTY = {
  invoice_number: "", trade_id: "none", quote_id: "none", description: "",
  amount_ex_gst: "", gst_amount: "", invoice_date: "", due_date: "",
};

const Field = ({ label, children, className = "" }) => (
  <div className={`space-y-1.5 ${className}`}>
    <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">{label}</Label>
    {children}
  </div>
);

export const InvoiceFormDialog = ({ open, onOpenChange, projectId, invoice, trades, acceptedQuotes, onSaved }) => {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const isEdit = Boolean(invoice);
  const fieldCls = "bg-slate-800/50 border-slate-600";

  useEffect(() => {
    if (open) {
      setForm(invoice ? {
        ...EMPTY, ...invoice,
        trade_id: invoice.trade_id || "none", quote_id: invoice.quote_id || "none",
        amount_ex_gst: String(invoice.amount_ex_gst), gst_amount: String(invoice.gst_amount),
        invoice_date: invoice.invoice_date || "", due_date: invoice.due_date || "",
      } : EMPTY);
    }
  }, [open, invoice]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setVal = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const onExChange = (e) => {
    const ex = e.target.value;
    setForm((f) => ({ ...f, amount_ex_gst: ex, gst_amount: String(autoGst(ex)) }));
  };

  const total = (parseFloat(form.amount_ex_gst) || 0) + (parseFloat(form.gst_amount) || 0);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        invoice_number: form.invoice_number,
        trade_id: form.trade_id === "none" ? null : form.trade_id,
        quote_id: form.quote_id === "none" ? null : form.quote_id,
        description: form.description,
        amount_ex_gst: parseFloat(form.amount_ex_gst) || 0,
        gst_amount: parseFloat(form.gst_amount) || 0,
        total_inc_gst: Math.round(total * 100) / 100,
        invoice_date: form.invoice_date || null,
        due_date: form.due_date || null,
      };
      const { data } = isEdit
        ? await api.put(`/invoices/${invoice.id}`, payload)
        : await api.post(`/projects/${projectId}/invoices`, payload);
      toast.success(isEdit ? "Invoice updated" : "Invoice added");
      if (data.warning) toast.warning(data.warning, { duration: 8000 });
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || "Could not save that invoice.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-card border-slate-700" data-testid="invoice-form-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl font-bold text-slate-100">{isEdit ? "Edit invoice" : "Add invoice"}</DialogTitle>
          <DialogDescription className="text-slate-400 text-sm">Payable from a trade — optionally linked to an accepted quote.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
          <Field label="Invoice number *">
            <Input data-testid="invoice-form-number" required className={fieldCls} value={form.invoice_number} onChange={set("invoice_number")} placeholder="INV-1042" />
          </Field>
          <Field label="Trade">
            <Select value={form.trade_id} onValueChange={setVal("trade_id")}>
              <SelectTrigger data-testid="invoice-form-trade" className={fieldCls}><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="none">No trade</SelectItem>
                {trades.map((t) => <SelectItem key={t.id} value={t.id}>{t.business_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Linked accepted quote" className="sm:col-span-2">
            <Select value={form.quote_id} onValueChange={setVal("quote_id")}>
              <SelectTrigger data-testid="invoice-form-quote" className={fieldCls}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not linked to a quote</SelectItem>
                {acceptedQuotes.map((q) => (
                  <SelectItem key={q.id} value={q.id}>{q.work_package} — {q.trade_name} ({formatMoney(q.total_inc_gst)})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <Textarea data-testid="invoice-form-description" className={`${fieldCls} min-h-[50px]`} value={form.description} onChange={set("description")} />
          </Field>
          <Field label="Amount ex-GST *">
            <Input data-testid="invoice-form-amount" type="number" min="0" step="0.01" required className={fieldCls}
              value={form.amount_ex_gst} onChange={onExChange} />
          </Field>
          <Field label="GST (auto 10%, editable)">
            <Input data-testid="invoice-form-gst" type="number" min="0" step="0.01" className={fieldCls}
              value={form.gst_amount} onChange={set("gst_amount")} />
          </Field>
          <div className="sm:col-span-2 rounded-md border border-slate-700 bg-slate-800/40 px-4 py-2 text-sm text-slate-300">
            Total inc GST: <span className="font-heading font-bold text-amber-400" data-testid="invoice-form-total">{formatMoney(total)}</span>
          </div>
          <Field label="Invoice date">
            <DatePicker value={form.invoice_date} onChange={setVal("invoice_date")} testId="invoice-form-date" />
          </Field>
          <Field label="Due date">
            <DatePicker value={form.due_date} onChange={setVal("due_date")} testId="invoice-form-due-date" />
          </Field>
          <div className="sm:col-span-2 flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" data-testid="invoice-form-cancel" onClick={() => onOpenChange(false)}
              className="border-slate-600 text-slate-300 hover:text-slate-100 hover:bg-slate-800">Cancel</Button>
            <Button type="submit" data-testid="invoice-form-save-button" disabled={busy}
              className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : isEdit ? "Save" : "Add invoice"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
