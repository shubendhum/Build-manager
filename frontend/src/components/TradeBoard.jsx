import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  Plus, ChevronDown, Phone, Mail, Send, CheckCircle2, FileText, Pencil, Trash2,
  CalendarDays, AlertTriangle, DollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { PackageFormDialog } from "@/components/PackageFormDialog";
import { QuoteFormDialog } from "@/components/QuoteFormDialog";
import { QuoteCard } from "@/components/QuoteCard";
import { RfqPanel } from "@/components/RfqPanel";
import { SendRfqDialog, copyRfqLink } from "@/components/SendRfqDialog";
import { ScheduleDialog } from "@/components/ScheduleDialog";
import { InvoiceFormDialog } from "@/components/InvoiceFormDialog";
import { PaymentDialog } from "@/components/PaymentDialog";
import api, { formatApiErrorDetail } from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/projectUtils";
import { tradeTypeLabel } from "@/lib/tradeUtils";

const STATE = {
  "not-engaged": { label: "Not engaged", dot: "bg-slate-500", tone: "text-slate-400" },
  chasing: { label: "Waiting on prices", dot: "bg-sky-400", tone: "text-sky-400" },
  decide: { label: "Decide", dot: "bg-amber-400", tone: "text-amber-400" },
  "to-schedule": { label: "Needs dates", dot: "bg-violet-400", tone: "text-violet-400" },
  booked: { label: "Booked", dot: "bg-emerald-500", tone: "text-emerald-400" },
  invoiced: { label: "Invoice to pay", dot: "bg-amber-400", tone: "text-amber-400" },
  paid: { label: "Paid", dot: "bg-emerald-600", tone: "text-slate-400" },
};

const Money = ({ v, className = "" }) =>
  v ? <span className={`tabular-nums ${className}`}>{formatMoney(v)}</span>
    : <span className="text-slate-600">—</span>;

// The money, plus how much of the build is actually priced — the coverage
// figures the Packages screen used to hold on its own.
const SummaryBar = ({ totals }) => (
  <div className="grid grid-cols-2 md:grid-cols-6 gap-px bg-slate-700 rounded-md overflow-hidden border border-slate-700 mb-5"
    data-testid="board-summary">
    {[
      { k: "needs_you", label: "Needs you", v: totals.needs_you, plain: true,
        tone: totals.needs_you > 0 ? "text-amber-400" : "text-slate-400" },
      { k: "priced", label: "Priced", plain: true,
        v: `${totals.priced_count}/${totals.package_count}`,
        tone: totals.priced_count < totals.package_count ? "text-slate-100" : "text-emerald-400" },
      { k: "committed", label: "Committed", v: totals.committed, tone: "text-slate-100" },
      { k: "invoiced", label: "Invoiced", v: totals.invoiced, tone: "text-slate-100" },
      { k: "paid", label: "Paid", v: totals.paid, tone: "text-emerald-400" },
      { k: "outstanding", label: "Owing", v: totals.outstanding,
        tone: totals.outstanding > 0 ? "text-amber-400" : "text-slate-400" },
    ].map((c) => (
      <div key={c.k} className="bg-card px-4 py-3" data-testid={`board-total-${c.k}`}>
        <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-1">{c.label}</p>
        <p className={`font-heading text-lg font-bold tabular-nums ${c.tone}`}>
          {c.plain ? c.v : formatMoney(c.v)}
        </p>
      </div>
    ))}
  </div>
);

const StageTracker = ({ sequence, current, upcoming, onAction, rows }) => {
  if (!sequence?.length) return null;
  const done = sequence.filter((s) => s.state === "done").length;
  const withWork = sequence.filter((s) => s.packages.length > 0);

  return (
    <section className="rounded-md border border-slate-700 bg-card p-5 mb-5" data-testid="stage-tracker">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-0.5">Where the job is up to</p>
          <h2 className="font-heading text-lg font-bold text-slate-100" data-testid="current-stage">
            {current ? `${current.n}. ${current.name}` : "All stages settled"}
          </h2>
        </div>
        <span className="text-xs text-slate-500 tabular-nums">
          step {current?.n ?? sequence.length} of {sequence.length}
        </span>
      </div>

      {current?.detail && <p className="text-xs text-slate-400 mb-1 max-w-3xl">{current.detail}</p>}
      {current?.note && (
        <p className="text-xs text-amber-400 mb-3 max-w-3xl" data-testid="stage-note">{current.note}</p>
      )}

      {/* One tick per step of the build, so the whole sequence is visible at a glance. */}
      <div className="flex flex-wrap gap-1 mb-3" role="list" aria-label="Build sequence">
        {sequence.map((s) => (
          <span key={s.n} role="listitem" title={`${s.n}. ${s.name}`}
            data-testid={`seq-${s.n}`}
            className={`h-2 flex-1 min-w-[10px] rounded-sm ${
              s.state === "done" ? "bg-emerald-500"
                : s.state === "current" ? "bg-amber-400"
                  : s.packages.length ? "bg-slate-600" : "bg-slate-800"
            }`} />
        ))}
      </div>
      <p className="text-[11px] text-slate-500">
        {done} of {withWork.length} stages with trades on them are settled ·
        <span className="text-slate-600"> pale ticks are stages with nothing booked yet</span>
      </p>

      {upcoming?.length > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-700/70" data-testid="needs-pricing">
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-2">
            Price these now — longest lead first
          </p>
          <div className="space-y-1.5">
            {upcoming.map((u) => {
              const row = rows.find((r) => r.package_id === u.package_id);
              return (
                <div key={u.package_id} className="flex flex-wrap items-center gap-2 text-xs"
                  data-testid={`upcoming-${u.package_id}`}>
                  <span className="text-amber-400 font-medium tabular-nums w-14 shrink-0">
                    {u.lead_weeks}wk lead
                  </span>
                  <span className="text-slate-200 flex-1 min-w-0 break-words">{u.title}</span>
                  <span className="text-slate-500 hidden sm:inline">step {u.step} · {u.step_name}</span>
                  {row?.next_action && (
                    <Button size="sm" variant="outline"
                      data-testid={`upcoming-action-${u.package_id}`}
                      onClick={() => onAction(row, row.next_action.id)}
                      className="border-amber-500/50 text-amber-400 hover:bg-amber-500/10 text-xs h-7">
                      {row.next_action.label}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};

const Row = ({ row, expanded, onToggle, onAction, detail }) => {
  const s = STATE[row.state] || STATE["not-engaged"];
  return (
    <div className="border-b border-slate-800 last:border-b-0" data-testid={`board-row-${row.package_id}`}>
      {/* Two layouts. Below lg this is a stacked card, because a 900px-wide
          table on a phone shows about a third of a row and clips every name —
          and this is the screen a builder opens while standing on site. */}
      <div className="hover:bg-slate-800/40 transition-colors duration-200">

        {/* ---- phone / tablet ---- */}
        <div className="lg:hidden px-4 py-3">
          <button type="button" onClick={onToggle} data-testid={`board-expand-${row.package_id}`}
            className="w-full text-left">
            <span className="flex items-start gap-2.5">
              <ChevronDown className={`h-4 w-4 text-slate-500 shrink-0 mt-1 transition-transform duration-200 ${expanded ? "" : "-rotate-90"}`}
                aria-hidden="true" />
              <span className={`h-2 w-2 rounded-full shrink-0 mt-2 ${s.dot}`} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                {/* Full name, wrapped — never cut. */}
                <span className="block text-[15px] font-semibold text-slate-100 leading-snug break-words">
                  <span className="text-slate-500 tabular-nums mr-1.5">{row.step}.</span>{row.title}
                </span>
                <span className="block text-xs text-slate-400 mt-0.5 break-words">
                  {row.trade_name || tradeTypeLabel(row.trade_type)}
                </span>
              </span>
              <span className={`text-xs font-medium shrink-0 ${s.tone}`} data-testid={`board-state-${row.package_id}`}>
                {s.label}
              </span>
            </span>
          </button>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-3 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Price</dt>
              <dd>{row.awarded_amount ? <Money v={row.awarded_amount} className="text-slate-100 font-medium" />
                : row.best_quote ? <Money v={row.best_quote} className="text-amber-400" />
                  : <span className="text-slate-600">—</span>}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">On site</dt>
              <dd className="text-slate-300 text-right">
                {row.scheduled_start
                  ? <>{formatDate(row.scheduled_start)}{row.scheduled_end && <> – {formatDate(row.scheduled_end)}</>}</>
                  : <span className="text-slate-600">—</span>}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Invoiced</dt>
              <dd><Money v={row.invoiced} className="text-slate-300" /></dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Paid</dt>
              <dd>
                <Money v={row.paid} className="text-emerald-400" />
                {row.overdue_count > 0 && <AlertTriangle className="h-3.5 w-3.5 text-red-400 inline ml-1" aria-hidden="true" />}
              </dd>
            </div>
          </dl>

          {row.next_action && (
            <Button size="sm" data-testid={`board-action-m-${row.package_id}`}
              onClick={() => onAction(row, row.next_action.id)}
              className="w-full mt-3 bg-amber-500 text-slate-950 text-xs h-9 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
              {row.next_action.label}
            </Button>
          )}
        </div>

        {/* ---- desktop table row ---- */}
        <div className="hidden lg:flex items-center gap-3 px-4 py-3">
          <button type="button" onClick={onToggle} data-testid={`board-expand-lg-${row.package_id}`}
            className="flex items-center gap-2.5 min-w-0 flex-1 text-left">
            <ChevronDown className={`h-4 w-4 text-slate-500 shrink-0 transition-transform duration-200 ${expanded ? "" : "-rotate-90"}`}
              aria-hidden="true" />
            <span className={`h-2 w-2 rounded-full shrink-0 ${s.dot}`} aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-100 break-words">
                <span className="text-slate-500 tabular-nums mr-1.5">{row.step}.</span>{row.title}
              </span>
              <span className="block text-xs text-slate-500 break-words">
                {row.trade_name || tradeTypeLabel(row.trade_type)}
                {row.state === "chasing" && ` · ${row.replied}/${row.invited} replied`}
                {row.state === "decide" && ` · ${row.live_quote_count} quote${row.live_quote_count === 1 ? "" : "s"} in`}
                {row.state === "chasing" && row.days_since_sent >= 3 && ` · ${row.days_since_sent}d ago`}
              </span>
            </span>
          </button>

          <span className={`text-xs font-medium shrink-0 w-28 ${s.tone}`}>{s.label}</span>

          <span className="text-sm shrink-0 w-28 text-right">
            {row.awarded_amount ? <Money v={row.awarded_amount} className="text-slate-100 font-medium" />
              : row.best_quote ? <Money v={row.best_quote} className="text-amber-400" />
                : <span className="text-slate-600">—</span>}
          </span>

          <span className="text-xs shrink-0 w-28 text-right text-slate-400">
            {row.scheduled_start
              ? <>{formatDate(row.scheduled_start)}{row.scheduled_end && ` – ${formatDate(row.scheduled_end)}`}</>
              : <span className="text-slate-600">—</span>}
          </span>

          <span className="text-sm shrink-0 w-24 text-right"><Money v={row.invoiced} className="text-slate-300" /></span>
          <span className="text-sm shrink-0 w-24 text-right">
            <Money v={row.paid} className="text-emerald-400" />
            {row.overdue_count > 0 && (
              <AlertTriangle className="h-3.5 w-3.5 text-red-400 inline ml-1" aria-hidden="true" />
            )}
          </span>

          <span className="shrink-0 w-40 flex justify-end">
            {row.next_action && (
              <Button size="sm" data-testid={`board-action-${row.package_id}`}
                onClick={() => onAction(row, row.next_action.id)}
                className="bg-amber-500 text-slate-950 text-xs h-8 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
                {row.next_action.label}
              </Button>
            )}
          </span>
        </div>
      </div>

      {expanded && <div className="bg-slate-900/40 border-t border-slate-800 px-4 py-4">{detail}</div>}
    </div>
  );
};

/**
 * Everything about one trade package, opened in place: who you asked, every
 * price that came back with the email it arrived in, the invoices, and the
 * actions. This used to be three separate screens.
 */
const RowDetail = ({ row, data, onAction, onRefresh, onEditQuote }) => {
  if (!data) return <p className="text-xs text-slate-500">Loading…</p>;
  const { quotes = [], rfqs = [], invoices = [] } = data;

  const accept = async (q) => {
    try {
      const { data: res } = await api.post(`/quotes/${q.id}/accept`);
      toast.success(`Awarded to ${q.trade_name} — ${res.rejected_count} other quote(s) rejected`);
      onRefresh();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Could not award this quote.");
    }
  };

  const deleteQuote = async (q) => {
    try {
      await api.delete(`/quotes/${q.id}`);
      toast.success(q.source === "email" ? "Discarded — still watching that thread" : "Quote deleted");
      onRefresh();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Could not delete that quote.");
    }
  };

  return (
    <div className="space-y-4 text-sm">
      {row.trade_name && (
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-slate-300 font-medium">{row.trade_name}</span>
          {row.trade_phone && (
            <a href={`tel:${row.trade_phone}`} data-testid={`board-call-${row.package_id}`}
              className="inline-flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 transition-colors duration-200">
              <Phone className="h-3.5 w-3.5" aria-hidden="true" /> {row.trade_phone}
            </a>
          )}
          {row.trade_email && (
            <a href={`mailto:${row.trade_email}`} data-testid={`board-email-${row.package_id}`}
              className="inline-flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 transition-colors duration-200">
              <Mail className="h-3.5 w-3.5" aria-hidden="true" /> {row.trade_email}
            </a>
          )}
        </div>
      )}

      <RfqPanel rfqs={rfqs} onChanged={onRefresh} />

      {quotes.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-1.5">
            Prices in ({quotes.length})
          </p>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
            {quotes.map((q) => (
              <QuoteCard key={q.id} quote={q} packageTitle={row.title}
                onAccept={accept} onEdit={onEditQuote} onDelete={deleteQuote}
                onUploaded={onRefresh} />
            ))}
          </div>
        </div>
      )}

      {invoices.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-1.5">Invoices</p>
          <div className="rounded-md border border-slate-700 divide-y divide-slate-800">
            {invoices.map((inv) => (
              <div key={inv.id} className="flex flex-wrap items-center gap-3 px-3 py-2"
                data-testid={`board-invoice-${inv.id}`}>
                <FileText className="h-3.5 w-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                <span className="text-xs text-slate-300 flex-1 min-w-0 break-words">{inv.invoice_number}</span>
                {inv.is_overdue && (
                  <Badge variant="outline" className="bg-red-500/15 text-red-400 border-red-500/50 uppercase tracking-wider text-[10px]">
                    Overdue
                  </Badge>
                )}
                <span className="text-sm text-slate-100 tabular-nums">{formatMoney(inv.total_inc_gst)}</span>
                <span className="text-[11px] text-slate-500 w-24 text-right">
                  {inv.balance > 0 ? `${formatMoney(inv.balance)} owing` : "paid"}
                </span>
                {inv.balance > 0 && (
                  <Button size="sm" data-testid={`board-pay-${inv.id}`} onClick={() => onAction(row, "pay", inv)}
                    className="bg-amber-500 text-slate-950 text-xs h-7 font-heading font-bold uppercase tracking-wider hover:bg-amber-400">
                    <DollarSign className="h-3.5 w-3.5" aria-hidden="true" /> Pay
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="sm" variant="outline" data-testid={`board-more-quotes-${row.package_id}`}
          onClick={() => onAction(row, "get-quotes")}
          className="border-slate-600 text-slate-300 hover:text-amber-400 text-xs h-8">
          <Send className="h-3.5 w-3.5" aria-hidden="true" /> Ask more trades
        </Button>
        <Button size="sm" variant="outline" data-testid={`board-schedule-${row.package_id}`}
          onClick={() => onAction(row, "schedule")}
          className="border-slate-600 text-slate-300 hover:text-amber-400 text-xs h-8">
          <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" /> {row.scheduled_start ? "Change dates" : "Book dates"}
        </Button>
        <Button size="sm" variant="outline" data-testid={`board-add-invoice-${row.package_id}`}
          onClick={() => onAction(row, "invoice")}
          className="border-slate-600 text-slate-300 hover:text-amber-400 text-xs h-8">
          <FileText className="h-3.5 w-3.5" aria-hidden="true" /> Add invoice
        </Button>
        <Button size="sm" variant="outline" data-testid={`board-add-quote-${row.package_id}`}
          onClick={() => onAction(row, "add-quote")}
          className="border-slate-600 text-slate-300 hover:text-amber-400 text-xs h-8">
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Price by hand
        </Button>
        <span className="flex-1" />
        <Button size="sm" variant="outline" data-testid={`board-edit-pkg-${row.package_id}`}
          onClick={() => onAction(row, "edit-package")}
          className="border-slate-600 text-slate-400 hover:text-amber-400 text-xs h-8">
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="outline" data-testid={`board-delete-pkg-${row.package_id}`}
              className="border-slate-600 text-slate-400 hover:text-red-400 text-xs h-8">
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Remove
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="bg-card border-slate-700">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-slate-100">Remove {row.title} from this job?</AlertDialogTitle>
              <AlertDialogDescription className="text-slate-400">
                The package goes, along with the quote requests sent for it. Prices already received
                and invoices stay on the job.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-slate-600 text-slate-300">Cancel</AlertDialogCancel>
              <AlertDialogAction data-testid={`board-delete-pkg-confirm-${row.package_id}`}
                onClick={() => onAction(row, "delete-package")}
                className="bg-red-600 text-white hover:bg-red-500">Remove</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
};

export const TradeBoard = ({ projectId }) => {
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [details, setDetails] = useState({});
  const [trades, setTrades] = useState([]);
  const [documents, setDocuments] = useState([]);

  const [pkgOpen, setPkgOpen] = useState(false);
  const [editingPkg, setEditingPkg] = useState(null);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [editingQuote, setEditingQuote] = useState(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [schedOpen, setSchedOpen] = useState(false);
  const [invOpen, setInvOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [active, setActive] = useState(null);
  const [payInvoice, setPayInvoice] = useState(null);

  const fetchBoard = useCallback(async () => {
    try {
      const [b, t, d] = await Promise.all([
        api.get(`/projects/${projectId}/board`),
        api.get("/trades"),
        api.get(`/projects/${projectId}/documents`),
      ]);
      setBoard(b.data);
      setTrades(t.data);
      setDocuments(d.data);
      setDetails({});
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchBoard(); }, [fetchBoard]);

  const loadDetail = useCallback(async (row) => {
    const [q, r, i] = await Promise.all([
      api.get(`/projects/${projectId}/quotes`),
      api.get(`/projects/${projectId}/rfqs`),
      api.get(`/projects/${projectId}/invoices`),
    ]);
    const quoteIds = new Set(q.data.filter((x) => x.package_id === row.package_id).map((x) => x.id));
    setDetails((d) => ({
      ...d,
      [row.package_id]: {
        quotes: q.data.filter((x) => x.package_id === row.package_id),
        rfqs: r.data.filter((x) => x.package_id === row.package_id),
        invoices: (i.data.invoices || i.data).filter(
          (x) => x.package_id === row.package_id || quoteIds.has(x.quote_id)),
      },
    }));
  }, [projectId]);

  const toggle = (row) => {
    const next = expanded === row.package_id ? null : row.package_id;
    setExpanded(next);
    if (next && !details[row.package_id]) loadDetail(row);
  };

  const onAction = async (row, id, invoice) => {
    setActive(row);
    if (id === "get-quotes") { setSendOpen(true); return; }
    if (id === "add-quote") { setEditingQuote(null); setQuoteOpen(true); return; }
    if (id === "edit-package") { setEditingPkg(row); setPkgOpen(true); return; }
    if (id === "delete-package") {
      try {
        await api.delete(`/packages/${row.package_id}`);
        toast.success(`${row.title} removed`);
        setExpanded(null);
        fetchBoard();
      } catch (e) {
        toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Could not remove that package.");
      }
      return;
    }
    if (id === "schedule") { setSchedOpen(true); return; }
    if (id === "invoice") { setInvOpen(true); return; }
    if (id === "pay") {
      if (invoice) { setPayInvoice(invoice); setPayOpen(true); return; }
      if (!details[row.package_id]) await loadDetail(row);
      setExpanded(row.package_id);
      return;
    }
    if (id === "award" || id === "view-rfq") {
      setExpanded(row.package_id);
      if (!details[row.package_id]) loadDetail(row);
      return;
    }
    if (id === "chase") {
      try {
        const rfqs = await api.get(`/projects/${projectId}/rfqs`);
        const rfq = rfqs.data.find((x) => x.package_id === row.package_id && x.status === "open");
        if (!rfq) { toast.error("No open quote request to chase."); return; }
        const pending = rfq.invitations.filter((i) => i.status !== "submitted").map((i) => i.id);
        const { data } = await api.post(`/rfqs/${rfq.id}/send`, {
          channels: ["email"], invitation_ids: pending,
        });
        if (data.sent) toast.success(`Chased ${data.sent} trade${data.sent === 1 ? "" : "s"}`);
        if (data.failed) toast.warning(`${data.failed} could not be reached — open the row for details.`);
        fetchBoard();
      } catch (e) {
        toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Could not send the chaser.");
      }
    }
  };

  const acceptedQuotes = (details[active?.package_id]?.quotes || []).filter((q) => q.status === "accepted");

  return (
    <div data-testid="trade-board">
      {loading && <p className="text-sm text-slate-400">Loading…</p>}

      {!loading && board && (
        <>
          <SummaryBar totals={board.totals} />
          <StageTracker sequence={board.sequence} current={board.current_step}
            upcoming={board.needs_pricing_soon} rows={board.rows} onAction={onAction} />

          <div className="flex flex-wrap justify-between items-center gap-3 mb-3">
            <p className="text-xs text-slate-500">
              {board.totals.needs_you > 0
                ? `${board.totals.needs_you} thing${board.totals.needs_you === 1 ? "" : "s"} need you`
                : "Nothing waiting on you"}
            </p>
            <Button size="sm" data-testid="board-add-package"
              onClick={() => { setEditingPkg(null); setPkgOpen(true); }}
              className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
              <Plus className="h-4 w-4" aria-hidden="true" /> Add a trade package
            </Button>
          </div>

          {board.rows.length === 0 ? (
            <div className="rounded-md border border-slate-700 bg-slate-800/30 p-10 text-center" data-testid="board-empty">
              <p className="text-sm text-slate-400 mb-1">No trade packages on this job yet.</p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Add one for each scope you need priced — plumbing, electrical, concrete — then send it to as
                many tradies as you like and compare what comes back.
              </p>
            </div>
          ) : (
            <div className="rounded-md border border-slate-700 bg-card lg:overflow-x-auto">
              <div className="lg:min-w-[900px]">
                <div className="hidden lg:flex items-center gap-3 px-4 py-2 border-b border-slate-700 bg-slate-800/60 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                  <span className="flex-1">Trade</span>
                  <span className="w-28 shrink-0">Status</span>
                  <span className="w-28 shrink-0 text-right">Price</span>
                  <span className="w-28 shrink-0 text-right">On site</span>
                  <span className="w-24 shrink-0 text-right">Invoiced</span>
                  <span className="w-24 shrink-0 text-right">Paid</span>
                  <span className="w-40 shrink-0" />
                </div>
                {board.rows.map((row) => (
                  <Row key={row.package_id} row={row} expanded={expanded === row.package_id}
                    onToggle={() => toggle(row)} onAction={onAction}
                    detail={<RowDetail row={row} data={details[row.package_id]} onAction={onAction}
                      onRefresh={() => { fetchBoard(); loadDetail(row); }}
                      onEditQuote={(q) => { setActive(row); setEditingQuote(q); setQuoteOpen(true); }} />} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <PackageFormDialog open={pkgOpen} onOpenChange={setPkgOpen} projectId={projectId}
        pkg={editingPkg && { ...editingPkg, id: editingPkg.package_id }} onSaved={fetchBoard} />
      <QuoteFormDialog open={quoteOpen} onOpenChange={setQuoteOpen} projectId={projectId}
        quote={editingQuote} trades={trades} pkg={active}
        onSaved={() => { fetchBoard(); if (active) loadDetail(active); }} />
      <SendRfqDialog open={sendOpen} onOpenChange={setSendOpen} projectId={projectId}
        pkg={active} trades={trades} documents={documents} onSaved={fetchBoard} />
      <ScheduleDialog open={schedOpen} onOpenChange={setSchedOpen} row={active} onSaved={fetchBoard} />
      <InvoiceFormDialog open={invOpen} onOpenChange={setInvOpen} projectId={projectId} invoice={null}
        trades={trades} acceptedQuotes={acceptedQuotes} onSaved={fetchBoard} />
      <PaymentDialog open={payOpen} onOpenChange={setPayOpen} invoice={payInvoice} onSaved={fetchBoard} />
    </div>
  );
};
