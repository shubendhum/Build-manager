import { useRef } from "react";
import { toast } from "sonner";
import {
  CheckCircle2, Pencil, Trash2, FileText, Paperclip, Globe, Mail, AlertTriangle, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import api, { formatApiErrorDetail } from "@/lib/api";
import { formatMoney, formatDate, roadmapStageLabel } from "@/lib/projectUtils";
import { QUOTE_STATUS_STYLES } from "@/lib/tradeUtils";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

// One price, with everything that came with it — how it arrived, what they
// actually wrote, the PDF they attached, and the one button that awards it.
export const QuoteCard = ({ quote, packageTitle, onAccept, onEdit, onDelete, onUploaded }) => {
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
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Could not attach that file.");
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
        {quote.total_inc_gst > 0 ? (
          <p className="font-heading text-base font-bold text-amber-400">{formatMoney(quote.total_inc_gst)} inc GST</p>
        ) : (
          <p className="font-heading text-sm font-bold text-slate-400">No price found in their reply</p>
        )}
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
        {quote.source === "email" && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline" data-testid={`quote-discard-${quote.id}`}
                className="border-slate-600 text-slate-400 hover:text-amber-400 text-xs h-8">
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Not a quote
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-card border-slate-700">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-slate-100">Discard this and keep watching?</AlertDialogTitle>
                <AlertDialogDescription className="text-slate-400">
                  Use this when the reply turned out not to be a quote — a forward, a question, or an
                  acknowledgement. It is removed and {quote.trade_name || "the trade"} goes back to
                  awaiting a price, so a real quote arriving later in the same email thread still gets
                  picked up. This exact email will not be read again.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-slate-600 text-slate-300">Cancel</AlertDialogCancel>
                <AlertDialogAction data-testid={`quote-discard-confirm-${quote.id}`} onClick={() => onDelete(quote)}
                  className="bg-amber-500 text-slate-950 hover:bg-amber-400">Discard &amp; keep watching</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        <button data-testid={`quote-delete-${quote.id}`} onClick={() => onDelete(quote)}
          className="p-1.5 rounded-md text-slate-500 hover:text-red-400 transition-colors duration-200"
          title="Delete" aria-label="Delete">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </article>
  );
};
