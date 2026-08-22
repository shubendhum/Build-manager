import { Link } from "react-router-dom";
import { ShieldAlert, ReceiptText, FileWarning, CalendarClock, FileSpreadsheet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatAUD, formatMoney, formatDate, statusLabel, STATUS_STYLES, HEALTH_STYLES, HEALTH_LABELS, roadmapStageLabel } from "@/lib/projectUtils";

export const Panel = ({ title, icon: Icon, children, testId }) => (
  <section className="rounded-md border border-slate-700 bg-card" data-testid={testId}>
    <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-700">
      <Icon className="h-4 w-4 text-amber-400" aria-hidden="true" />
      <h2 className="font-heading text-sm font-bold uppercase tracking-wider text-slate-100">{title}</h2>
    </div>
    <div className="p-5">{children}</div>
  </section>
);

export const InspectionsWidget = ({ inspections }) => (
  <Panel title="RBS Inspection Reminders" icon={ShieldAlert} testId="widget-inspections">
    {inspections.length === 0 && <p className="text-sm text-slate-500" data-testid="inspections-empty">No upcoming mandatory inspections.</p>}
    <ul className="space-y-3">
      {inspections.map((i) => (
        <li key={i.task_id} data-testid={`inspection-${i.task_id}`}>
          <Link to={`/projects/${i.project_id}?tab=roadmap`} className="flex items-start justify-between gap-3 rounded-md -mx-2 px-2 py-1.5 hover:bg-slate-800/60 transition-colors duration-200">
          <div>
            <span className="text-sm text-slate-200">
              {i.title.replace("MANDATORY INSPECTION: ", "")}
            </span>
            <p className="text-xs text-slate-500">{i.project_name} · {roadmapStageLabel(i.stage_key)}</p>
          </div>
          {i.unscheduled ? (
            <Badge variant="outline" className="shrink-0 bg-slate-500/15 text-slate-400 border-slate-500/40 text-[10px] uppercase tracking-wider">
              Unscheduled — upcoming
            </Badge>
          ) : i.is_overdue ? (
            <Badge variant="outline" className="shrink-0 bg-red-500/15 text-red-400 border-red-500/50 text-[10px] uppercase tracking-wider"
              data-testid={`inspection-overdue-${i.task_id}`}>
              Overdue by {Math.abs(i.days_until)}d
            </Badge>
          ) : (
            <Badge variant="outline" className="shrink-0 bg-amber-500/15 text-amber-400 border-amber-500/50 text-[10px] uppercase tracking-wider">
              Due in {i.days_until}d
            </Badge>
          )}
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
              <Link to={`/projects/${i.project_id}?tab=invoices`} className="flex items-center justify-between gap-3 text-sm rounded-md -mx-2 px-2 py-1.5 hover:bg-slate-800/60 transition-colors duration-200">
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
          <Link to={`/projects/${t.project_id}?tab=roadmap`} className="flex items-center justify-between gap-3 text-sm rounded-md -mx-2 px-2 py-1.5 hover:bg-slate-800/60 transition-colors duration-200">
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
    {snapshot.length === 0 && <p className="text-sm text-slate-500" data-testid="claims-snapshot-empty">No claim schedules on active projects.</p>}
    <ul className="space-y-4">
      {snapshot.map((c) => (
        <li key={c.project_id} data-testid={`claims-snapshot-${c.project_id}`}>
          <Link to={`/projects/${c.project_id}?tab=budget`} className="block rounded-md -mx-2 px-2 py-1.5 hover:bg-slate-800/60 transition-colors duration-200">
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

export const PortfolioList = ({ portfolio }) => (
  <div className="space-y-3" data-testid="portfolio-list">
    {portfolio.length === 0 && <p className="text-sm text-slate-500">No projects yet.</p>}
    {portfolio.map((p) => (
      <Link key={p.id} to={`/projects/${p.id}`} data-testid={`portfolio-project-${p.id}`}
        className="block rounded-md border border-slate-700 bg-card px-5 py-4 hover:border-amber-500/50 transition-colors duration-200">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[200px]">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-heading font-semibold text-slate-100">{p.name}</p>
              <Badge variant="outline" className={`uppercase tracking-wider text-[9px] ${STATUS_STYLES[p.status]}`}>{statusLabel(p.status)}</Badge>
              <Badge variant="outline" className={`uppercase tracking-wider text-[9px] ${HEALTH_STYLES[p.budget_health]}`}
                data-testid={`portfolio-health-${p.id}`}>
                {HEALTH_LABELS[p.budget_health]}
              </Badge>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">{p.site_suburb} VIC {p.site_postcode} · {formatAUD(p.contract_value)}</p>
          </div>
          <div className="flex items-center gap-3 w-56">
            <Progress value={p.progress} className="h-2 bg-slate-700" />
            <span className="text-sm font-heading font-bold text-amber-400 w-12 text-right">{p.progress}%</span>
          </div>
        </div>
      </Link>
    ))}
  </div>
);
