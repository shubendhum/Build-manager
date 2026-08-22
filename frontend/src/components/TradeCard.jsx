import { Star, Phone, Mail, ShieldCheck, FileWarning, BadgeCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { tradeTypeLabel } from "@/lib/tradeUtils";
import { formatDate } from "@/lib/projectUtils";

const WarningBadge = ({ warning }) => {
  const expired = warning.level === "expired";
  const label = `${warning.type === "licence" ? "Licence" : "Insurance"} ${expired ? "EXPIRED" : "expiring soon"}`;
  return (
    <Badge variant="outline"
      data-testid={`trade-warning-${warning.type}-${warning.level}`}
      className={`uppercase tracking-wider text-[9px] gap-1 ${expired ? "bg-red-500/15 text-red-400 border-red-500/50" : "bg-amber-500/15 text-amber-400 border-amber-500/50"}`}>
      <FileWarning className="h-3 w-3" aria-hidden="true" /> {label}
    </Badge>
  );
};

const Stars = ({ rating }) => {
  if (!rating) return null;
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`h-3.5 w-3.5 ${i <= rating ? "text-amber-400 fill-amber-400" : "text-slate-600"}`} aria-hidden="true" />
      ))}
    </span>
  );
};

export const TradeCard = ({ trade, actions, onOpen }) => (
  <article
    onClick={onOpen ? () => onOpen(trade) : undefined}
    onKeyDown={onOpen ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(trade); } } : undefined}
    role={onOpen ? "button" : undefined}
    tabIndex={onOpen ? 0 : undefined}
    className={`rounded-md border border-slate-700 bg-card p-5 transition-colors duration-200 ${
      onOpen ? "cursor-pointer hover:border-amber-500/50 focus:outline-none focus:ring-2 focus:ring-amber-500" : ""
    }`}
    data-testid={`trade-card-${trade.id}`}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <h3 className="font-heading font-bold text-slate-100 leading-tight">{trade.business_name}</h3>
        <p className="text-xs text-slate-500 mt-0.5">{trade.contact_person}</p>
      </div>
      <Badge variant="outline" className="shrink-0 bg-slate-500/10 text-slate-300 border-slate-600 uppercase tracking-wider text-[10px]">
        {tradeTypeLabel(trade.trade_type)}
      </Badge>
    </div>

    <div className="flex flex-wrap items-center gap-2 mt-2">
      <Stars rating={trade.rating} />
      {(trade.warnings || []).map((w, i) => <WarningBadge key={i} warning={w} />)}
    </div>

    <div className="mt-4 space-y-1.5 text-xs text-slate-400">
      {trade.phone && <p className="flex items-center gap-1.5"><Phone className="h-3 w-3 text-amber-400" aria-hidden="true" />{trade.phone}</p>}
      {trade.email && <p className="flex items-center gap-1.5 truncate"><Mail className="h-3 w-3 text-amber-400" aria-hidden="true" />{trade.email}</p>}
      {trade.licence_number && (
        <p className="flex items-center gap-1.5">
          <BadgeCheck className="h-3 w-3 text-amber-400" aria-hidden="true" />
          {trade.licence_number}{trade.licence_expiry && ` · exp ${formatDate(trade.licence_expiry)}`}
        </p>
      )}
      {trade.insurer && (
        <p className="flex items-center gap-1.5">
          <ShieldCheck className="h-3 w-3 text-amber-400" aria-hidden="true" />
          {trade.insurer} {trade.insurance_policy_number}{trade.insurance_expiry && ` · exp ${formatDate(trade.insurance_expiry)}`}
        </p>
      )}
      {trade.rate_notes && <p className="text-slate-500">{trade.rate_notes}</p>}
    </div>

    {actions && <div className="mt-4 pt-3 border-t border-slate-700/70 flex justify-end gap-2">{actions}</div>}
  </article>
);
