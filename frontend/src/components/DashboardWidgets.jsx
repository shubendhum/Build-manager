import { Link } from "react-router-dom";
import { OctagonAlert, ReceiptText, FileWarning, CalendarClock, FileSpreadsheet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatAUD, formatMoney, formatDate } from "@/lib/projectUtils";

export const Panel = ({ title, icon: Icon, children, testId }) => (
  <section className="rounded-md border border-slate-700 bg-card" data-testid={testId}>
    <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-700">
      <Icon className="h-4 w-4 text-amber-400" aria-hidden="true" />
      <h2 className="font-heading text-sm font-bold uppercase tracking-wider text-slate-100">{title}</h2>
    </div>
    <div className="p-5">{children}</div>
  </section>
);

export const HoldPointsWidget = ({ holds, overdue }) => (
  <Panel title="Stop work — hold points" icon={OctagonAlert} testId="widget-hold-points">
    {holds.length === 0 && overdue.length === 0 && (
      <p className="text-sm text-slate-500" data-testid="hold-points-empty">
        Nothing is blocking a job right now.
      </p>
    )}
    <ul className="space-y-2">
      {holds.map((h) => (
        <li key={`${h.project_id}-${h.action_key}`} data-testid={`hold-point-${h.action_key}`}>
          <Link to={`/projects/${h.project_id}?tab=steps`}
            className="flex items-start gap-2 text-sm rounded-md -mx-2 px-2 py-1.5 hover:bg-slate-800/60 transition-colors duration-200">
            <OctagonAlert className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
            <span className="min-w-0">
              <span className="text-red-300 break-words">{h.name}</span>
              <span className="block text-xs text-slate-500">{h.project_name}</span>
            </span>
          </Link>
        </li>
      ))}
      {overdue.map((o) => (
        <li key={`${o.project_id}-${o.action_key}`} data-testid={`checklist-overdue-${o.action_key}`}>
          <Link to={`/projects/${o.project_id}?tab=steps`}
            className="flex items-start gap-2 text-sm rounded-md -mx-2 px-2 py-1.5 hover:bg-slate-800/60 transition-colors duration-200">
            <CalendarClock className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
            <span className="min-w-0">
              <span className="text-slate-200 break-words">{o.name}</span>
              <span className="block text-xs text-slate-500">{o.project_name} · {o.why}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  </Panel>
);

export const OverdueInvoicesWidget = ({ data }) => (
  <Panel title="Overdue Invoices" icon={ReceiptText} testId="widget-overdue-invoices">
    {data.count === 0 ? (
      <p className="text-sm text-slate-500" data-testid="overdue-invoices-empty">No overdue invoices.</p>
    ) : (
      <>
        <p className="text-sm text-red-400 font-heading font-bold mb-3" data-testid="overdue-invoices-summary">
          {data.count} overdue · {formatMoney(data.total_balance)} outstanding
        </p>
        <ul className="space-y-2">
          {data.items.map((i) => (
            <li key={i.invoice_id} data-testid={`overdue-invoice-${i.invoice_id}`}>
              <Link to={`/projects/${i.project_id}?tab=money`} className="flex items-center justify-between gap-3 text-sm rounded-md -mx-2 px-2 py-1.5 hover:bg-slate-800/60 transition-colors duration-200">
                <span>
                  <span className="text-slate-200">{i.invoice_number}</span>
                  <span className="text-xs text-slate-500 ml-2">{i.trade_name || i.project_name}</span>
                </span>
                <span className="text-red-400 font-medium whitespace-nowrap">{formatMoney(i.balance)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </>
    )}
  </Panel>
);

export const TradeWarningsWidget = ({ warnings }) => (
  <Panel title="Licence & Insurance Alerts" icon={FileWarning} testId="widget-trade-warnings">
    {warnings.length === 0 && <p className="text-sm text-slate-500" data-testid="trade-warnings-empty">All trade credentials current.</p>}
    <ul className="space-y-3">
      {warnings.map((t) => (
        <li key={t.trade_id} data-testid={`trade-warning-item-${t.trade_id}`}>
          <Link to="/trades" className="flex items-start justify-between gap-3 rounded-md -mx-2 px-2 py-1.5 hover:bg-slate-800/60 transition-colors duration-200">
          <span className="text-sm text-slate-200">{t.business_name}</span>
          <div className="flex flex-col items-end gap-1">
            {t.warnings.map((w, i) => (
              <Badge key={i} variant="outline"
                className={`text-[10px] uppercase tracking-wider ${w.level === "expired" ? "bg-red-500/15 text-red-400 border-red-500/50" : "bg-amber-500/15 text-amber-400 border-amber-500/50"}`}>
                {w.type} {w.level === "expired" ? "expired" : `expires ${formatDate(w.expiry)}`}
              </Badge>
            ))}
          </div>
          </Link>
        </li>
      ))}
    </ul>
  </Panel>
);

export const UpcomingTasksWidget = ({ tasks }) => (
  <Panel title="Tasks — Next 7 Days" icon={CalendarClock} testId="widget-upcoming-tasks">
    {tasks.length === 0 && <p className="text-sm text-slate-500" data-testid="upcoming-tasks-empty">Nothing due in the next 7 days.</p>}
    <ul className="space-y-2">
      {tasks.map((t) => (
        <li key={t.task_id} data-testid={`upcoming-task-${t.task_id}`}>
          <Link to={`/projects/${t.project_id}?tab=money`} className="flex items-center justify-between gap-3 text-sm rounded-md -mx-2 px-2 py-1.5 hover:bg-slate-800/60 transition-colors duration-200">
            <span>
              <span className="text-slate-200">{t.title}</span>
              <span className="text-xs text-slate-500 ml-2">{t.project_name}</span>
            </span>
            <span className={`text-xs whitespace-nowrap ${t.is_overdue ? "text-red-400 font-semibold" : "text-slate-400"}`}>
              {formatDate(t.due_date)}{t.is_overdue && " · OVERDUE"}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  </Panel>
);

export const ClaimsSnapshotWidget = ({ snapshot }) => (
  <Panel title="Progress Claims Snapshot" icon={FileSpreadsheet} testId="widget-claims-snapshot">
    {snapshot.length === 0 && <p className="text-sm text-slate-500" data-testid="claims-snapshot-empty">No claim schedules on active jobs.</p>}
    <ul className="space-y-4">
      {snapshot.map((c) => (
        <li key={c.project_id} data-testid={`claims-snapshot-${c.project_id}`}>
          <Link to={`/projects/${c.project_id}?tab=money`} className="block rounded-md -mx-2 px-2 py-1.5 hover:bg-slate-800/60 transition-colors duration-200">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-slate-200">{c.project_name}</span>
            {c.next_unclaimed ? (
              <span className="text-xs text-amber-300 whitespace-nowrap">
                Next: {c.next_unclaimed.stage_label} — {formatMoney(c.next_unclaimed.amount)}
              </span>
            ) : (
              <span className="text-xs text-emerald-400">Fully claimed</span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Claimed {formatMoney(c.total_claimed)} · Paid {formatMoney(c.total_paid)} of {formatAUD(c.contract_value)}
          </p>
          </Link>
        </li>
      ))}
    </ul>
  </Panel>
);
