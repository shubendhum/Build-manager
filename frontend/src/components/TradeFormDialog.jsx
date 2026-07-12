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
import { TRADE_TYPES } from "@/lib/tradeUtils";

const EMPTY = {
  business_name: "", contact_person: "", trade_type: "other", phone: "", email: "", abn: "",
  licence_number: "", licence_expiry: "", insurer: "", insurance_policy_number: "", insurance_expiry: "",
  rate_notes: "", rating: "none", notes: "",
};

const Field = ({ label, children, className = "" }) => (
  <div className={`space-y-1.5 ${className}`}>
    <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">{label}</Label>
    {children}
  </div>
);

export const TradeFormDialog = ({ open, onOpenChange, trade, onSaved }) => {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const isEdit = Boolean(trade);
  const fieldCls = "bg-slate-800/50 border-slate-600";

  useEffect(() => {
    if (open) {
      setForm(trade ? {
        ...EMPTY, ...trade,
        licence_expiry: trade.licence_expiry || "", insurance_expiry: trade.insurance_expiry || "",
        rating: trade.rating ? String(trade.rating) : "none",
      } : EMPTY);
    }
  }, [open, trade]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setVal = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        ...form,
        licence_expiry: form.licence_expiry || null,
        insurance_expiry: form.insurance_expiry || null,
        rating: form.rating === "none" ? null : parseInt(form.rating, 10),
      };
      delete payload.id; delete payload.warnings; delete payload.created_at; delete payload.updated_at; delete payload.is_seed;
      const { data } = isEdit ? await api.put(`/trades/${trade.id}`, payload) : await api.post("/trades", payload);
      toast.success(isEdit ? "Trade updated" : "Trade added");
      onOpenChange(false);
      onSaved?.(data);
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || "Failed to save trade.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-card border-slate-700" data-testid="trade-form-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl font-bold text-slate-100">{isEdit ? "Edit Trade" : "Add Trade"}</DialogTitle>
          <DialogDescription className="text-slate-400 text-sm">Subcontractor details, licence and insurance.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
          <Field label="Business name *" className="sm:col-span-2">
            <Input data-testid="trade-form-business-name" required className={fieldCls} value={form.business_name} onChange={set("business_name")} />
          </Field>
          <Field label="Contact person">
            <Input data-testid="trade-form-contact" className={fieldCls} value={form.contact_person} onChange={set("contact_person")} />
          </Field>
          <Field label="Trade type">
            <Select value={form.trade_type} onValueChange={setVal("trade_type")}>
              <SelectTrigger data-testid="trade-form-type" className={fieldCls}><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-64">
                {TRADE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Phone">
            <Input data-testid="trade-form-phone" className={fieldCls} value={form.phone} onChange={set("phone")} />
          </Field>
          <Field label="Email">
            <Input data-testid="trade-form-email" type="email" className={fieldCls} value={form.email} onChange={set("email")} />
          </Field>
          <Field label="ABN">
            <Input data-testid="trade-form-abn" className={fieldCls} value={form.abn} onChange={set("abn")} />
          </Field>
          <Field label="Rating">
            <Select value={form.rating} onValueChange={setVal("rating")}>
              <SelectTrigger data-testid="trade-form-rating" className={fieldCls}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No rating</SelectItem>
                {[1, 2, 3, 4, 5].map((r) => <SelectItem key={r} value={String(r)}>{r} star{r > 1 ? "s" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Licence number">
            <Input data-testid="trade-form-licence" className={fieldCls} value={form.licence_number} onChange={set("licence_number")} placeholder="e.g. REC 28374" />
          </Field>
          <Field label="Licence expiry">
            <DatePicker value={form.licence_expiry} onChange={setVal("licence_expiry")} testId="trade-form-licence-expiry" />
          </Field>
          <Field label="Public liability insurer">
            <Input data-testid="trade-form-insurer" className={fieldCls} value={form.insurer} onChange={set("insurer")} />
          </Field>
          <Field label="Policy number">
            <Input data-testid="trade-form-policy" className={fieldCls} value={form.insurance_policy_number} onChange={set("insurance_policy_number")} />
          </Field>
          <Field label="Insurance expiry">
            <DatePicker value={form.insurance_expiry} onChange={setVal("insurance_expiry")} testId="trade-form-insurance-expiry" />
          </Field>
          <Field label="Rate notes">
            <Input data-testid="trade-form-rates" className={fieldCls} value={form.rate_notes} onChange={set("rate_notes")} placeholder="e.g. $95/hr + call-out" />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea data-testid="trade-form-notes" className={`${fieldCls} min-h-[60px]`} value={form.notes} onChange={set("notes")} />
          </Field>
          <div className="sm:col-span-2 flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" data-testid="trade-form-cancel" onClick={() => onOpenChange(false)}
              className="border-slate-600 text-slate-300 hover:text-slate-100 hover:bg-slate-800">Cancel</Button>
            <Button type="submit" data-testid="trade-form-save-button" disabled={busy}
              className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : isEdit ? "Save Changes" : "Add Trade"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
