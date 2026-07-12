import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { FolderKanban, Activity, DollarSign, ReceiptText, ArrowRight, Loader2 } from "lucide-react";
import api from "@/lib/api";
import { formatAUD, formatMoney } from "@/lib/projectUtils";
import {
  InspectionsWidget, OverdueInvoicesWidget, TradeWarningsWidget,
  UpcomingTasksWidget, ClaimsSnapshotWidget, PortfolioList,
} from "@/components/DashboardWidgets";

const StatCard = ({ icon: Icon, label, value, sub, testId }) => (
  <div className="rounded-md border border-slate-700 bg-card p-5" data-testid={testId}>
    <div className="flex items-center gap-2 text-slate-400 mb-2">
      <Icon className="h-4 w-4 text-amber-400" aria-hidden="true" />
      <span className="text-xs uppercase tracking-[0.15em]">{label}</span>
    </div>
    <p className="font-heading text-2xl font-bold text-slate-100">{value}</p>
    {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
  </div>
);

export default function DashboardPage() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/dashboard").then(({ data: d }) => setData(d)).catch(() => {});
  }, []);

  if (!data) {
    return (
      <main className="max-w-7xl mx-auto px-6 py-12" data-testid="dashboard-page">
        <div className="flex items-center gap-3 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin text-amber-400" aria-hidden="true" />
          <p className="text-sm">Loading dashboard…</p>
        </div>
      </main>
    );
  }

  const { portfolio, inspections, overdue_invoices, trade_warnings, upcoming_tasks, claims_snapshot } = data;
  const active = portfolio.filter((p) => p.status === "active");
  const totalValue = portfolio.reduce((s, p) => s + (p.contract_value || 0), 0);

  return (
    <main className="max-w-7xl mx-auto px-6 py-12" data-testid="dashboard-page">
      <p className="text-xs uppercase tracking-[0.2em] text-amber-400 font-semibold mb-2">Overview</p>
      <h1 className="font-heading text-4xl font-bold tracking-tight text-slate-100 mb-10">Dashboard</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        <StatCard icon={FolderKanban} label="Projects" value={portfolio.length} testId="stat-total-projects" />
        <StatCard icon={Activity} label="Active" value={active.length} testId="stat-active-projects" />
        <StatCard icon={DollarSign} label="Portfolio Value" value={formatAUD(totalValue)} testId="stat-portfolio-value" />
        <StatCard icon={ReceiptText} label="Overdue Invoices" value={overdue_invoices.count}
          sub={overdue_invoices.count ? `${formatMoney(overdue_invoices.total_balance)} outstanding` : "All within terms"}
          testId="stat-overdue-invoices" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
        <InspectionsWidget inspections={inspections} />
        <OverdueInvoicesWidget data={overdue_invoices} />
        <TradeWarningsWidget warnings={trade_warnings} />
        <UpcomingTasksWidget tasks={upcoming_tasks} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
        <ClaimsSnapshotWidget snapshot={claims_snapshot} />
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-heading text-sm font-bold uppercase tracking-wider text-slate-100">Portfolio</h2>
            <Link to="/projects" data-testid="dashboard-view-projects-link"
              className="inline-flex items-center gap-1 text-sm text-amber-400 hover:text-amber-300 transition-colors duration-200">
              All projects <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          <PortfolioList portfolio={portfolio} />
        </div>
      </div>
    </main>
  );
}
