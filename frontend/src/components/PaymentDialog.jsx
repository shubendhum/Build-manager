import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DatePicker } from "@/components/DatePicker";
import api, { formatApiErrorDetail } from "@/lib/api";
import { formatMoney } from "@/lib/projectUtils";

export const PaymentDialog = ({ open, onOpenChange, invoice, onSaved }) => {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && invoice) {
      setAmount(String(invoice.balance ?? ""));
      setDate(new Date().toISOString().slice(0, 10));
      setNote("");
    }
  }, [open, invoice]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/invoices/${invoice.id}/payments`, {
        amount: parseFloat(amount) || 0,
        date: date || null,
        note,
      });
      toast.success("Payment recorded");
      onOpenChange(false);
      onSaved?.();
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || "Could not record that payment.");
    } finally {
      setBusy(false);
    }
  };

  if (!invoice) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card border-slate-700" data-testid="payment-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg font-bold text-slate-100">Record a payment</DialogTitle>
          <DialogDescription className="text-slate-400 text-sm">
            {invoice.invoice_number} — balance {formatMoney(invoice.balance)}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">Amount *</Label>
            <Input data-testid="payment-form-amount" type="number" min="0.01" step="0.01" required
              className="bg-slate-800/50 border-slate-600" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">Date</Label>
            <DatePicker value={date} onChange={setDate} testId="payment-form-date" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-[0.15em] text-slate-400">Note</Label>
            <Input data-testid="payment-form-note" className="bg-slate-800/50 border-slate-600" value={note}
              onChange={(e) => setNote(e.target.value)} placeholder="e.g. EFT ref 4471" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" data-testid="payment-form-cancel" onClick={() => onOpenChange(false)}
              className="border-slate-600 text-slate-300 hover:text-slate-100 hover:bg-slate-800">Cancel</Button>
            <Button type="submit" data-testid="payment-form-save-button" disabled={busy}
              className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Record Payment"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
