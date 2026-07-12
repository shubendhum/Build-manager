import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, CheckCircle2, Paperclip, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { QuoteFormDialog } from "@/components/QuoteFormDialog";
import api, { formatApiErrorDetail } from "@/lib/api";
import { formatMoney, formatDate, roadmapStageLabel } from "@/lib/projectUtils";
import { QUOTE_STATUS_STYLES } from "@/lib/tradeUtils";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

const QuoteCard = ({ quote, onAccept, onEdit, onDelete, onUploaded }) => {
  const fileRef = useRef(null);

  const upload = async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      await api.post(`/quotes/${quote.id}/attachment`, fd);
      toast.success("Attachment uploaded");
      onUploaded();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Failed to upload attachment.");
    }
  };

  return (
    <article className={`rounded-md border bg-card p-5 ${quote.status === "accepted" ? "border-emerald-600/60" : "border-slate-700"}`}
      data-testid={`quote-card-${quote.id}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="font-heading font-bold text-slate-100">{quote.trade_name || "Unknown trade"}</p>
          <p className="text-xs text-slate-500">{roadmapStageLabel(quote.stage_key)} stage</p>
        </div>
        <Badge variant="outline" className={`shrink-0 uppercase tracking-wider text-[10px] ${QUOTE_STATUS_STYLES[quote.status]}`}
          data-testid={`quote-status-${quote.id}`}>
          {quote.status}
        </Badge>
      </div>

      <div className="rounded-md bg-slate-800/40 border border-slate-700/70 px-3 py-2 mb-3 text-xs text-slate-300 space-y-0.5">
        <p>Ex-GST: {formatMoney(quote.amount_ex_gst)} · GST: {formatMoney(quote.gst_amount)}</p>
        <p className="font-heading text-base font-bold text-amber-400">{formatMoney(quote.total_inc_gst)} inc GST</p>
      </div>

      <div className="text-xs text-slate-400 space-y-1 mb-3">
        {quote.quote_date && <p>Quoted {formatDate(quote.quote_date)}</p>}
        {quote.expiry_date && <p>Valid until {formatDate(quote.expiry_date)}</p>}
        {quote.scope_description && <p className="text-slate-300 line-clamp-3">{quote.scope_description}</p>}
        {quote.exclusions && <p className="text-slate-500 line-clamp-2">Excl: {quote.exclusions}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-700/70">
        {quote.status !== "accepted" && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" data-testid={`quote-accept-${quote.id}`}
                className="bg-emerald-600 text-white hover:bg-emerald-500 text-xs h-8">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Accept
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-card border-slate-700">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-slate-100">Accept this quote?</AlertDialogTitle>
                <AlertDialogDescription className="text-slate-400">
                  Accepting "{quote.trade_name}" for {formatMoney(quote.total_inc_gst)} will mark all other quotes in
                  the "{quote.work_package}" package as rejected. The accepted quote becomes a budget commitment.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid={`quote-accept-cancel-${quote.id}`} className="border-slate-600 text-slate-300">Cancel</AlertDialogCancel>
                <AlertDialogAction data-testid={`quote-accept-confirm-${quote.id}`} onClick={() => onAccept(quote)}
                  className="bg-emerald-600 text-white hover:bg-emerald-500">Accept Quote</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {quote.attachment ? (
          <a href={`${BACKEND_URL}/api/quotes/${quote.id}/attachment`} target="_blank" rel="noopener noreferrer"
            data-testid={`quote-attachment-link-${quote.id}`}
            className="inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 transition-colors duration-200">
            <FileText className="h-3.5 w-3.5" aria-hidden="true" /> {quote.attachment.filename}
          </a>
        ) : (
          <button data-testid={`quote-attach-${quote.id}`} onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-amber-400 transition-colors duration-200">
            <Paperclip className="h-3.5 w-3.5" aria-hidden="true" /> Attach
          </button>
        )}
        <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden"
          data-testid={`quote-attach-input-${quote.id}`} onChange={(e) => upload(e.target.files?.[0])} />
        <span className="flex-1" />
        <button data-testid={`quote-edit-${quote.id}`} onClick={() => onEdit(quote)}
          className="p-1.5 rounded-md text-slate-500 hover:text-amber-400 transition-colors duration-200">
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </button>
        <button data-testid={`quote-delete-${quote.id}`} onClick={() => onDelete(quote)}
          className="p-1.5 rounded-md text-slate-500 hover:text-red-400 transition-colors duration-200">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </article>
  );
};

export const QuotesTab = ({ projectId }) => {
  const [quotes, setQuotes] = useState([]);
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const [q, t] = await Promise.all([api.get(`/projects/${projectId}/quotes`), api.get("/trades")]);
      setQuotes(q.data);
      setTrades(t.data);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const accept = async (quote) => {
    try {
      const { data } = await api.post(`/quotes/${quote.id}/accept`);
      toast.success(`Quote accepted — ${data.rejected_count} competing quote(s) rejected`);
      fetchData();
    } catch (e) {
      toast.error("Failed to accept quote.");
    }
  };

  const remove = async (quote) => {
    try {
      await api.delete(`/quotes/${quote.id}`);
      toast.success("Quote deleted");
      fetchData();
    } catch (e) {
      toast.error("Failed to delete quote.");
    }
  };

  const groups = quotes.reduce((m, q) => {
    (m[q.work_package] = m[q.work_package] || []).push(q);
    return m;
  }, {});

  return (
    <div data-testid="quotes-tab">
      <div className="flex justify-end mb-6">
        <Button data-testid="add-quote-button" onClick={() => { setEditing(null); setFormOpen(true); }}
          className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
          <Plus className="h-4 w-4" aria-hidden="true" /> Add Quote
        </Button>
      </div>

      {loading && <p className="text-sm text-slate-400">Loading quotes…</p>}
      {!loading && quotes.length === 0 && (
        <p className="text-sm text-slate-500" data-testid="quotes-empty">No quotes yet. Add quotes and compare them by work package.</p>
      )}

      <div className="space-y-10">
        {Object.entries(groups).map(([pkg, pkgQuotes]) => (
          <section key={pkg} data-testid={`work-package-${pkg.replace(/\s+/g, "-").toLowerCase()}`}>
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <h3 className="font-heading text-lg font-bold uppercase tracking-wider text-slate-100">{pkg}</h3>
              <span className="text-xs text-slate-500">{pkgQuotes.length} quote{pkgQuotes.length === 1 ? "" : "s"}</span>
              {pkgQuotes.some((q) => q.status === "accepted") && (
                <Badge variant="outline" className="bg-emerald-600/20 text-emerald-400 border-emerald-600/40 uppercase tracking-wider text-[10px]">
                  Committed
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 items-start">
              {pkgQuotes.map((q) => (
                <QuoteCard key={q.id} quote={q} onAccept={accept} onDelete={remove} onUploaded={fetchData}
                  onEdit={(quote) => { setEditing(quote); setFormOpen(true); }} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <QuoteFormDialog open={formOpen} onOpenChange={setFormOpen} projectId={projectId} quote={editing} trades={trades} onSaved={fetchData} />
    </div>
  );
};
