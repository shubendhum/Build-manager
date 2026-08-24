import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Plus, Pencil, Trash2, CheckCircle2, Paperclip, FileText, Copy, XCircle, Globe,
  ChevronDown, RefreshCw, PackageOpen, Eye, AlertTriangle, Mail, MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { QuoteFormDialog } from "@/components/QuoteFormDialog";
import { copyRfqLink } from "@/components/SendRfqDialog";
import api, { formatApiErrorDetail } from "@/lib/api";
import { formatMoney, formatDate, formatDateTime, roadmapStageLabel } from "@/lib/projectUtils";
import {
  QUOTE_STATUS_STYLES, RFQ_STATUS_STYLES, INVITATION_STATUS_STYLES, INVITATION_STATUS_LABELS,
} from "@/lib/tradeUtils";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

const QuoteCard = ({ quote, packageTitle, onAccept, onEdit, onDelete, onUploaded }) => {
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
          {quote.source === "email" && (
            <Badge variant="outline" className="bg-sky-500/15 text-sky-400 border-sky-500/40 uppercase tracking-wider text-[10px]"
              data-testid={`quote-email-badge-${quote.id}`}>
              <Mail className="h-3 w-3 mr-1" aria-hidden="true" /> Replied by email
            </Badge>
          )}
          {quote.needs_review && (
            <Badge variant="outline" className="bg-amber-500/15 text-amber-400 border-amber-500/50 uppercase tracking-wider text-[10px]"
              data-testid={`quote-review-badge-${quote.id}`}>
              <AlertTriangle className="h-3 w-3 mr-1" aria-hidden="true" /> Check the price
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
        {quote.email_body && (
          <details className="mt-1" data-testid={`quote-reply-${quote.id}`}>
            <summary className="cursor-pointer text-sky-400 hover:text-sky-300 transition-colors duration-200">
              Read their reply
            </summary>
            {quote.email_subject && <p className="text-slate-500 mt-1">Subject: {quote.email_subject}</p>}
            <pre className="mt-1 whitespace-pre-wrap text-[11px] text-slate-400 bg-slate-900/50 rounded-md p-2.5 max-h-56 overflow-y-auto">
              {quote.email_body}
            </pre>
          </details>
        )}
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
                  Accepting "{quote.trade_name}" for {formatMoney(quote.total_inc_gst)} will mark every other quote in
                  the "{packageTitle || quote.work_package}" package as rejected, and award the package to them. The
                  accepted quote becomes a budget commitment.
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

const InvitationRow = ({ invitation, onResend, resending }) => (
  <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-slate-900/30" data-testid={`invitation-row-${invitation.id}`}>
    <div className="min-w-0 flex-1">
      <p className="text-xs font-medium text-slate-300 break-words">{invitation.trade_name || "Unknown trade"}</p>
      <p className="text-[11px] text-slate-500 break-words">
        {invitation.trade_email || invitation.trade_phone || "no contact on file"}
        {invitation.sent_at && <> · sent {formatDateTime(invitation.sent_at)}</>}
        {invitation.first_viewed_at && (
          <span className="text-violet-400"> · opened {formatDateTime(invitation.first_viewed_at)}</span>
        )}
      </p>
      {invitation.last_error && (
        <p className="text-[11px] text-red-400 flex items-center gap-1 mt-0.5">
          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" /> {invitation.last_error}
        </p>
      )}
    </div>
    {invitation.downloaded_at && (
      <span className="text-[10px] text-slate-500 inline-flex items-center gap-1 shrink-0" title="Downloaded the drawings">
        <Eye className="h-3 w-3" aria-hidden="true" /> plans
      </span>
    )}
    <Badge variant="outline" className={`uppercase tracking-wider text-[10px] shrink-0 ${INVITATION_STATUS_STYLES[invitation.status]}`}
      data-testid={`invitation-status-${invitation.id}`}>
      {INVITATION_STATUS_LABELS[invitation.status] || invitation.status}
    </Badge>
    <button data-testid={`invitation-copy-${invitation.id}`} onClick={() => copyRfqLink(invitation.token)}
      title="Copy this trade's private link"
      className="p-1.5 rounded-md text-slate-500 hover:text-amber-400 transition-colors duration-200">
      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
    {invitation.status !== "submitted" && (
      <button data-testid={`invitation-resend-${invitation.id}`} onClick={() => onResend(invitation)} disabled={resending}
        title="Send again" className="p-1.5 rounded-md text-slate-500 hover:text-amber-400 transition-colors duration-200 disabled:opacity-40">
        <RefreshCw className={`h-3.5 w-3.5 ${resending ? "animate-spin" : ""}`} aria-hidden="true" />
      </button>
    )}
  </div>
);

const MessageLog = ({ rfqId }) => {
  const [log, setLog] = useState(null);
  useEffect(() => {
    api.get(`/rfqs/${rfqId}/log`).then(({ data }) => setLog(data)).catch(() => setLog([]));
  }, [rfqId]);

  if (!log) return <p className="px-4 py-2 text-xs text-slate-500">Loading messages…</p>;
  if (log.length === 0) {
    return <p className="px-4 py-2 text-xs text-slate-500">Nothing sent yet for this request.</p>;
  }
  return (
    <div data-testid={`message-log-${rfqId}`}>
      <p className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-[0.2em] text-slate-500">
        Messages sent ({log.length})
      </p>
      <div className="divide-y divide-slate-800">
        {log.map((m) => (
          <details key={m.id} className="px-4 py-2" data-testid={`message-${m.id}`}>
            <summary className="flex flex-wrap items-center gap-2 cursor-pointer list-none">
              {m.channel === "email"
                ? <Mail className="h-3.5 w-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                : <MessageSquare className="h-3.5 w-3.5 text-slate-500 shrink-0" aria-hidden="true" />}
              <span className="text-xs text-slate-300 flex-1 min-w-0 break-words">{m.to || "(no address)"}</span>
              <Badge variant="outline" className={`uppercase tracking-wider text-[10px] shrink-0 ${
                m.status === "sent" ? "bg-emerald-600/20 text-emerald-400 border-emerald-600/40"
                  : "bg-red-500/15 text-red-400 border-red-500/50"}`}>
                {m.status}
              </Badge>
              <span className="text-[11px] text-slate-500 shrink-0">
                {formatDateTime(m.sent_at || m.created_at)}
              </span>
            </summary>
            {m.error && <p className="text-[11px] text-red-400 mt-1.5">{m.error}</p>}
            {m.subject && <p className="text-[11px] text-slate-400 mt-1.5">Subject: {m.subject}</p>}
            {m.body && (
              <pre className="mt-1.5 whitespace-pre-wrap text-[11px] text-slate-400 bg-slate-900/50 rounded-md p-2.5 max-h-56 overflow-y-auto">
                {m.body}
              </pre>
            )}
          </details>
        ))}
      </div>
    </div>
  );
};

const RfqCard = ({ rfq, onClose, onResend, resendingId }) => {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="border-b border-slate-800 last:border-b-0" data-testid={`rfq-row-${rfq.id}`}>
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 min-w-0 flex-1 text-left" data-testid={`rfq-toggle-${rfq.id}`}>
              <ChevronDown className={`h-4 w-4 text-amber-400 shrink-0 transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
                aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-200 break-words">
                  {rfq.package_title || rfq.scope.split("\n")[0]}
                </span>
                <span className="block text-xs text-slate-500 break-words">
                  {rfq.submitted_count}/{rfq.invited_count} responded
                  {rfq.due_date && <> · due {formatDate(rfq.due_date)}</>}
                  {rfq.document_ids?.length > 0 && <> · {rfq.document_ids.length} document{rfq.document_ids.length === 1 ? "" : "s"}</>}
                </span>
              </span>
            </button>
          </CollapsibleTrigger>
          <Badge variant="outline" className={`uppercase tracking-wider text-[10px] shrink-0 ${RFQ_STATUS_STYLES[rfq.status]}`}
            data-testid={`rfq-status-${rfq.id}`}>
            {rfq.status}
          </Badge>
          {rfq.status === "open" && (
            <button data-testid={`rfq-close-${rfq.id}`} onClick={() => onClose(rfq)} title="Close request — disables every link"
              className="p-1.5 rounded-md text-slate-500 hover:text-red-400 transition-colors duration-200">
              <XCircle className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <CollapsibleContent>
          <div className="border-t border-slate-800 divide-y divide-slate-800">
            {rfq.invitations.map((inv) => (
              <InvitationRow key={inv.id} invitation={inv} onResend={(i) => onResend(rfq, i)}
                resending={resendingId === inv.id} />
            ))}
            {open && <MessageLog rfqId={rfq.id} />}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
};

export const QuotesTab = ({ projectId }) => {
  const [quotes, setQuotes] = useState([]);
  const [trades, setTrades] = useState([]);
  const [rfqs, setRfqs] = useState([]);
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [resendingId, setResendingId] = useState(null);
  const [, setSearchParams] = useSearchParams();

  const fetchData = useCallback(async () => {
    try {
      const [q, t, r, p] = await Promise.all([
        api.get(`/projects/${projectId}/quotes`),
        api.get("/trades"),
        api.get(`/projects/${projectId}/rfqs`),
        api.get(`/projects/${projectId}/packages`),
      ]);
      setQuotes(q.data);
      setTrades(t.data);
      setRfqs(r.data);
      setPackages(p.data);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const packageTitle = (id) => packages.find((p) => p.id === id)?.title;

  const closeRfq = async (rfq) => {
    try {
      await api.post(`/rfqs/${rfq.id}/close`);
      toast.success("Quote request closed — every link for it is now disabled.");
      fetchData();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Failed to close quote request.");
    }
  };

  const resend = async (rfq, invitation) => {
    setResendingId(invitation.id);
    try {
      const { data } = await api.post(`/rfqs/${rfq.id}/send`, {
        channels: invitation.channels?.length ? invitation.channels : ["email"],
        invitation_ids: [invitation.id],
      });
      const result = data.results[0];
      if (result?.ok) toast.success(`Re-sent to ${result.trade_name}`);
      else toast.error(result?.error || "Send failed.");
      fetchData();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Failed to send.");
    } finally {
      setResendingId(null);
    }
  };

  const accept = async (quote) => {
    try {
      const { data } = await api.post(`/quotes/${quote.id}/accept`);
      toast.success(`Quote accepted — ${data.rejected_count} competing quote(s) rejected`);
      fetchData();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Failed to accept quote.");
    }
  };

  const remove = async (quote) => {
    try {
      await api.delete(`/quotes/${quote.id}`);
      toast.success("Quote deleted");
      fetchData();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Failed to delete quote.");
    }
  };

  // Group by the package record; pre-migration quotes fall back to their string.
  const groups = quotes.reduce((m, q) => {
    const key = q.package_id || `legacy:${q.work_package}`;
    (m[key] = m[key] || { title: packageTitle(q.package_id) || q.work_package, quotes: [] }).quotes.push(q);
    return m;
  }, {});

  return (
    <div data-testid="quotes-tab">
      <div className="flex flex-wrap justify-end gap-3 mb-6">
        <Button data-testid="go-to-packages-button" variant="outline" onClick={() => setSearchParams({ tab: "packages" }, { replace: true })}
          className="border-amber-500/50 bg-transparent text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 font-heading font-bold uppercase tracking-wider">
          <PackageOpen className="h-4 w-4" aria-hidden="true" /> Request Quotes
        </Button>
        <Button data-testid="add-quote-button" onClick={() => { setEditing(null); setFormOpen(true); }}
          className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
          <Plus className="h-4 w-4" aria-hidden="true" /> Add Quote
        </Button>
      </div>

      {loading && <p className="text-sm text-slate-400">Loading quotes…</p>}

      {!loading && rfqs.length > 0 && (
        <section className="mb-10" data-testid="rfq-list">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="font-heading text-lg font-bold uppercase tracking-wider text-slate-100">Quote Requests</h3>
            <span className="text-xs text-slate-500">{rfqs.length}</span>
          </div>
          <div className="rounded-md border border-slate-700 bg-card">
            {rfqs.map((rfq) => (
              <RfqCard key={rfq.id} rfq={rfq} onClose={closeRfq} onResend={resend} resendingId={resendingId} />
            ))}
          </div>
        </section>
      )}

      {!loading && quotes.length === 0 && (
        <div className="rounded-md border border-slate-700 bg-slate-800/30 p-10 text-center" data-testid="quotes-empty">
          <p className="text-sm text-slate-400 mb-1">No quotes yet.</p>
          <p className="text-xs text-slate-500">
            Add quotes manually, or open the Packages tab and send a request — every trade you invite gets their
            own link, and their submission lands here automatically.
          </p>
        </div>
      )}

      <div className="space-y-10">
        {Object.entries(groups).map(([key, group]) => (
          <section key={key} data-testid={`work-package-${group.title.replace(/\s+/g, "-").toLowerCase()}`}>
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <h3 className="font-heading text-lg font-bold uppercase tracking-wider text-slate-100">{group.title}</h3>
              <span className="text-xs text-slate-500">{group.quotes.length} quote{group.quotes.length === 1 ? "" : "s"}</span>
              {group.quotes.some((q) => q.status === "accepted") && (
                <Badge variant="outline" className="bg-emerald-600/20 text-emerald-400 border-emerald-600/40 uppercase tracking-wider text-[10px]">
                  Committed
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 items-start">
              {group.quotes.map((q) => (
                <QuoteCard key={q.id} quote={q} packageTitle={group.title} onAccept={accept} onDelete={remove}
                  onUploaded={fetchData} onEdit={(quote) => { setEditing(quote); setFormOpen(true); }} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <QuoteFormDialog open={formOpen} onOpenChange={setFormOpen} projectId={projectId} quote={editing}
        trades={trades} onSaved={fetchData} />
    </div>
  );
};
