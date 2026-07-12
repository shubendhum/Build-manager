import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Banknote, X, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InvoiceFormDialog } from "@/components/InvoiceFormDialog";
import { PaymentDialog } from "@/components/PaymentDialog";
import { ClaimsSection } from "@/components/ClaimsSection";
import api from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/projectUtils";
import { INVOICE_STATUS_STYLES } from "@/lib/tradeUtils";

const SummaryCard = ({ label, value, accent, testId }) => (
  <div className="rounded-md border border-slate-700 bg-card p-4" data-testid={testId}>
    <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-1">{label}</p>
    <p className={`font-heading text-xl font-bold ${accent || "text-slate-100"}`}>{value}</p>
  </div>
);

const InvoiceRow = ({ invoice, onEdit, onDelete, onPay, onDeletePayment }) => (
  <article className={`rounded-md border bg-card p-5 ${invoice.is_overdue ? "border-red-500/50" : "border-slate-700"}`}
    data-testid={`invoice-row-${invoice.id}`}>
    <div className="flex flex-wrap items-start gap-4">
      <div className="flex-1 min-w-[220px]">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-heading font-bold text-slate-100">{invoice.invoice_number}</p>
          <Badge variant="outline" className={`uppercase tracking-wider text-[10px] ${INVOICE_STATUS_STYLES[invoice.status]}`}
            data-testid={`invoice-status-${invoice.id}`}>
            {invoice.status}
          </Badge>
          {invoice.is_overdue && (
            <Badge variant="outline" className="bg-red-500/15 text-red-400 border-red-500/50 uppercase tracking-wider text-[10px] gap-1"
              data-testid={`invoice-overdue-${invoice.id}`}>
              <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Overdue
            </Badge>
          )}
        </div>
        <p className="text-xs text-slate-400 mt-1">{invoice.trade_name || "No trade"}{invoice.description && ` — ${invoice.description}`}</p>
        <p className="text-xs text-slate-500 mt-1">
          {invoice.invoice_date && `Issued ${formatDate(invoice.invoice_date)}`}
          {invoice.due_date && ` · Due ${formatDate(invoice.due_date)}`}
        </p>
        {invoice.payments.length > 0 && (
          <div className="mt-2 space-y-1">
            {invoice.payments.map((p) => (
              <p key={p.id} className="text-xs text-emerald-400/90 flex items-center gap-2" data-testid={`payment-${p.id}`}>
                <Banknote className="h-3 w-3" aria-hidden="true" />
                {formatMoney(p.amount)} on {formatDate(p.date)}{p.note && ` (${p.note})`}
                <button data-testid={`payment-delete-${p.id}`} onClick={() => onDeletePayment(invoice, p)}
                  className="text-slate-600 hover:text-red-400 transition-colors duration-200">
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </p>
            ))}
          </div>
        )}
      </div>
      <div className="text-right">
        <p className="font-heading text-lg font-bold text-slate-100">{formatMoney(invoice.total_inc_gst)}</p>
        <p className="text-xs text-slate-500">ex {formatMoney(invoice.amount_ex_gst)} + GST {formatMoney(invoice.gst_amount)}</p>
        <p className={`text-sm font-heading font-semibold mt-1 ${invoice.balance > 0 ? "text-amber-400" : "text-emerald-400"}`}
          data-testid={`invoice-balance-${invoice.id}`}>
          Balance {formatMoney(invoice.balance)}
        </p>
      </div>
      <div className="flex flex-col items-end gap-2">
        {invoice.balance > 0 && (
          <Button size="sm" data-testid={`invoice-pay-${invoice.id}`} onClick={() => onPay(invoice)}
            className="bg-amber-500 text-slate-950 hover:bg-amber-400 text-xs h-8 font-semibold">
            Record Payment
          </Button>
        )}
        <div className="flex gap-1">
          <button data-testid={`invoice-edit-${invoice.id}`} onClick={() => onEdit(invoice)}
            className="p-1.5 rounded-md text-slate-500 hover:text-amber-400 transition-colors duration-200">
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </button>
          <button data-testid={`invoice-delete-${invoice.id}`} onClick={() => onDelete(invoice)}
            className="p-1.5 rounded-md text-slate-500 hover:text-red-400 transition-colors duration-200">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  </article>
);

export const InvoicesTab = ({ projectId, contractValue }) => {
  const [data, setData] = useState(null);
  const [trades, setTrades] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [payInvoice, setPayInvoice] = useState(null);

  const fetchData = useCallback(async () => {
    const [inv, t, q] = await Promise.all([
      api.get(`/projects/${projectId}/invoices`),
      api.get("/trades"),
      api.get(`/projects/${projectId}/quotes`),
    ]);
    setData(inv.data);
    setTrades(t.data);
    setQuotes(q.data);
  }, [projectId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const remove = async (invoice) => {
    try {
      await api.delete(`/invoices/${invoice.id}`);
      toast.success("Invoice deleted");
      fetchData();
    } catch (e) {
      toast.error("Failed to delete invoice.");
    }
  };

  const deletePayment = async (invoice, payment) => {
    try {
      await api.delete(`/invoices/${invoice.id}/payments/${payment.id}`);
      toast.success("Payment removed");
      fetchData();
    } catch (e) {
      toast.error("Failed to remove payment.");
    }
  };

  if (!data) return <p className="text-sm text-slate-400">Loading invoices…</p>;

  const { invoices, summary } = data;
  const acceptedQuotes = quotes.filter((q) => q.status === "accepted");

  return (
    <div data-testid="invoices-tab">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <SummaryCard label="Total Invoiced" value={formatMoney(summary.total_invoiced)} testId="invoices-summary-total" />
        <SummaryCard label="Paid" value={formatMoney(summary.total_paid)} accent="text-emerald-400" testId="invoices-summary-paid" />
        <SummaryCard label="Outstanding" value={formatMoney(summary.outstanding)} accent="text-amber-400" testId="invoices-summary-outstanding" />
        <SummaryCard label="Overdue" value={summary.overdue_count} accent={summary.overdue_count ? "text-red-400" : "text-slate-100"} testId="invoices-summary-overdue" />
      </div>

      <div className="flex justify-end mb-4">
        <Button data-testid="add-invoice-button" onClick={() => { setEditing(null); setFormOpen(true); }}
          className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
          <Plus className="h-4 w-4" aria-hidden="true" /> Add Invoice
        </Button>
      </div>

      {invoices.length === 0 && <p className="text-sm text-slate-500 mb-6" data-testid="invoices-empty">No invoices recorded yet.</p>}

      <div className="space-y-4">
        {invoices.map((inv) => (
          <InvoiceRow key={inv.id} invoice={inv} onDelete={remove} onDeletePayment={deletePayment}
            onEdit={(i) => { setEditing(i); setFormOpen(true); }} onPay={setPayInvoice} />
        ))}
      </div>

      <ClaimsSection projectId={projectId} contractValue={contractValue} />

      <InvoiceFormDialog open={formOpen} onOpenChange={setFormOpen} projectId={projectId} invoice={editing}
        trades={trades} acceptedQuotes={acceptedQuotes} onSaved={fetchData} />
      <PaymentDialog open={Boolean(payInvoice)} onOpenChange={(o) => !o && setPayInvoice(null)} invoice={payInvoice} onSaved={fetchData} />
    </div>
  );
};
