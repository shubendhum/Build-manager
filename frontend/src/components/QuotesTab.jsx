import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, CheckCircle2, Paperclip, FileText, Send, Copy, XCircle, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { QuoteFormDialog } from "@/components/QuoteFormDialog";
import { RfqDialog, copyRfqLink } from "@/components/RfqDialog";
import api, { formatApiErrorDetail } from "@/lib/api";
import { formatMoney, formatDate, roadmapStageLabel } from "@/lib/projectUtils";
import { QUOTE_STATUS_STYLES, RFQ_STATUS_STYLES } from "@/lib/tradeUtils";

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
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge variant="outline" className={`uppercase tracking-wider text-[10px] ${QUOTE_STATUS_STYLES[quote.status]}`}
            data-testid={`quote-status-${quote.id}`}>
            {quote.status}
          </Badge>
          {quote.source === "portal" && (
            <Badge variant="outline" className="bg-violet-500/15 text-violet-400 border-violet-500/40 uppercase tracking-wider text-[10px]"
              data-testid={`quote-portal-badge-${quote.id}`}>
              <Globe className="h-3 w-3 mr-1" aria-hidden="true" /> Submitted via portal
            </Badge>
          )}
        </div>
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
        {quote.lead_time && <p>Lead time: {quote.lead_time}</p>}
        {quote.source === "portal" && quote.contact_name && (
          <p className="text-slate-500">
            Contact: {quote.contact_name}
            {quote.contact_phone && ` · ${quote.contact_phone}`}
            {quote.contact_email && ` · ${quote.contact_email}`}
          </p>
        )}
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

const RfqList = ({ rfqs, onClose }) => {
  if (rfqs.length === 0) return null;
  return (
    <section className="mb-10" data-testid="rfq-list">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="font-heading text-lg font-bold uppercase tracking-wider text-slate-100">Quote Requests</h3>
        <span className="text-xs text-slate-500">{rfqs.length} sent</span>
      </div>
      <div className="rounded-md border border-slate-700 bg-card divide-y divide-slate-800">
        {rfqs.map((rfq) => (
          <div key={rfq.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid={`rfq-row-${rfq.id}`}>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-200 truncate">{rfq.trade_name || "Unknown trade"}</p>
              <p className="text-xs text-slate-500 truncate">
                {rfq.scope.split("\n")[0]}
                {rfq.due_date && <span> · due {formatDate(rfq.due_date)}</span>}
              </p>
            </div>
            <Badge variant="outline" className={`uppercase tracking-wider text-[10px] shrink-0 ${RFQ_STATUS_STYLES[rfq.status]}`}
              data-testid={`rfq-status-${rfq.id}`}>
              {rfq.status}
            </Badge>
            {rfq.status !== "closed" && (
              <button data-testid={`rfq-copy-${rfq.id}`} onClick={() => copyRfqLink(rfq)} title="Copy public link"
                className="p-1.5 rounded-md text-slate-500 hover:text-amber-400 transition-colors duration-200">
                <Copy className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
            {rfq.status === "sent" && (
              <button data-testid={`rfq-close-${rfq.id}`} onClick={() => onClose(rfq)} title="Close request"
                className="p-1.5 rounded-md text-slate-500 hover:text-red-400 transition-colors duration-200">
                <XCircle className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
};

export const QuotesTab = ({ projectId }) => {
  const [quotes, setQuotes] = useState([]);
  const [trades, setTrades] = useState([]);
  const [rfqs, setRfqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [rfqOpen, setRfqOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const [q, t, r] = await Promise.all([
        api.get(`/projects/${projectId}/quotes`),
        api.get("/trades"),
        api.get(`/projects/${projectId}/rfqs`),
      ]);
      setQuotes(q.data);
      setTrades(t.data);
      setRfqs(r.data);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const closeRfq = async (rfq) => {
    try {
      await api.post(`/rfqs/${rfq.id}/close`);
      toast.success("Quote request closed — the public link is now disabled.");
      fetchData();
    } catch (e) {
      toast.error("Failed to close quote request.");
    }
  };

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
      <div className="flex flex-wrap justify-end gap-3 mb-6">
        <Button data-testid="request-quote-button" variant="outline" onClick={() => setRfqOpen(true)}
          className="border-amber-500/50 bg-transparent text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 font-heading font-bold uppercase tracking-wider">
          <Send className="h-4 w-4" aria-hidden="true" /> Request Quote
        </Button>
        <Button data-testid="add-quote-button" onClick={() => { setEditing(null); setFormOpen(true); }}
          className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
          <Plus className="h-4 w-4" aria-hidden="true" /> Add Quote
        </Button>
      </div>

      {loading && <p className="text-sm text-slate-400">Loading quotes…</p>}
      {!loading && <RfqList rfqs={rfqs} onClose={closeRfq} />}
      {!loading && quotes.length === 0 && (
        <div className="rounded-md border border-slate-700 bg-slate-800/30 p-10 text-center" data-testid="quotes-empty">
          <p className="text-sm text-slate-400 mb-1">No quotes yet.</p>
          <p className="text-xs text-slate-500">Add quotes manually, or send a trade a Request Quote link and their submission will land here automatically.</p>
        </div>
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
      <RfqDialog open={rfqOpen} onOpenChange={setRfqOpen} projectId={projectId} trades={trades} onSaved={fetchData} />
    </div>
  );
};
