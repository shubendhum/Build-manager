import { useState, useEffect } from "react";
import { toast } from "sonner";
import { RefreshCw, Copy, Eye, AlertTriangle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { copyRfqLink } from "@/components/SendRfqDialog";
import api, { formatApiErrorDetail } from "@/lib/api";
import { formatDateTime } from "@/lib/projectUtils";
import {
  RFQ_STATUS_STYLES, INVITATION_STATUS_STYLES, INVITATION_STATUS_LABELS,
} from "@/lib/tradeUtils";

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

/**
 * The quote requests sent for one package: who was asked, what came back, and
 * the emails that went out. Sits inside the board row it belongs to, so you
 * never have to go looking for it on another screen.
 */
export const RfqPanel = ({ rfqs, onChanged }) => {
  const [resendingId, setResendingId] = useState(null);
  const [showLog, setShowLog] = useState(null);

  if (!rfqs?.length) return null;

  const resend = async (rfq, invitation) => {
    setResendingId(invitation.id);
    try {
      const { data } = await api.post(`/rfqs/${rfq.id}/send`, {
        channels: ["email"], invitation_ids: [invitation.id],
      });
      if (data.sent) toast.success(`Sent again to ${invitation.trade_name}`);
      else toast.warning(data.results?.[0]?.error || "Could not reach them.");
      onChanged();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Could not send it again.");
    } finally {
      setResendingId(null);
    }
  };

  const close = async (rfq) => {
    try {
      await api.post(`/rfqs/${rfq.id}/close`);
      toast.success("Quote request closed");
      onChanged();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Could not close it.");
    }
  };

  return (
    <div data-testid="rfq-panel">
      <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-1.5">Who you asked</p>
      <div className="space-y-2">
        {rfqs.map((rfq) => (
          <div key={rfq.id} className="rounded-md border border-slate-700 overflow-hidden"
            data-testid={`rfq-${rfq.id}`}>
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-slate-800/50">
              <span className="text-xs text-slate-400 flex-1 min-w-0 break-words">
                Sent {rfq.sent_at ? formatDateTime(rfq.sent_at) : "—"}
                {rfq.due_date && ` · replies due ${rfq.due_date}`}
              </span>
              <Badge variant="outline"
                className={`uppercase tracking-wider text-[10px] shrink-0 ${RFQ_STATUS_STYLES[rfq.status]}`}>
                {rfq.status}
              </Badge>
              <button onClick={() => setShowLog(showLog === rfq.id ? null : rfq.id)}
                data-testid={`rfq-log-${rfq.id}`}
                className="text-[11px] text-slate-500 hover:text-amber-400 transition-colors duration-200">
                {showLog === rfq.id ? "hide emails" : "emails sent"}
              </button>
              {rfq.status === "open" && (
                <Button size="sm" variant="outline" data-testid={`rfq-close-${rfq.id}`}
                  onClick={() => close(rfq)}
                  className="border-slate-600 text-slate-400 hover:text-amber-400 text-xs h-7">
                  <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> Close
                </Button>
              )}
            </div>
            <div className="divide-y divide-slate-800">
              {(rfq.invitations || []).map((inv) => (
                <InvitationRow key={inv.id} invitation={inv} resending={resendingId === inv.id}
                  onResend={(i) => resend(rfq, i)} />
              ))}
            </div>
            {showLog === rfq.id && <MessageLog rfqId={rfq.id} />}
          </div>
        ))}
      </div>
    </div>
  );
};
