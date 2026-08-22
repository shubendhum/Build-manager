import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Building2, Activity, DollarSign, ReceiptText, ArrowRight, Loader2, Plus, FileUp, Send, NotebookPen } from "lucide-react";
import api from "@/lib/api";
import { formatAUD, formatMoney } from "@/lib/projectUtils";
import { ProjectFormDialog } from "@/components/ProjectFormDialog";
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

const QuickAction = ({ icon: Icon, label, sub, onClick, testId }) => (
  <button data-testid={testId} onClick={onClick}
    className="flex items-center gap-3 rounded-md border border-slate-700 bg-card px-4 py-3 text-left hover:border-amber-500/60 hover:bg-slate-800/60 transition-colors duration-200 group">
    <div className="h-9 w-9 rounded-md bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0 group-hover:bg-amber-500/20 transition-colors duration-200">
      <Icon className="h-5 w-5 text-amber-400" aria-hidden="true" />
    </div>
    <div>
      <p className="text-sm font-medium text-slate-200">{label}</p>
      <p className="text-[11px] text-slate-500">{sub}</p>
    </div>
  </button>
);

export default function DashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [projectFormOpen, setProjectFormOpen] = useState(false);

  useEffect(() => {
    api.get("/dashboard").then(({ data: d }) => setData(d)).catch(() => {});
  }, []);

  // Quick actions land on the most recent active project (dashboard portfolio is newest-first)
  const targetProject = data?.portfolio?.find((p) => p.status === "active") || data?.portfolio?.[0];
  const goToProjectTab = (tabKey) => {
    if (!targetProject) {
      toast.info("Create a project first — quick actions work inside a project.");
      setProjectFormOpen(true);
      return;
    }
    navigate(`/projects/${targetProject.id}?tab=${tabKey}`);
  };

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
      <h1 className="font-heading text-4xl font-bold tracking-tight text-slate-100 mb-6">Dashboard</h1>

      <section className="mb-10" data-testid="portfolio-section">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-heading text-sm font-bold uppercase tracking-wider text-slate-100">Your Jobs</h2>
          <Link to="/projects" data-testid="dashboard-view-projects-link"
            className="inline-flex items-center gap-1 text-sm text-amber-400 hover:text-amber-300 transition-colors duration-200">
            All jobs <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
        <PortfolioList portfolio={portfolio} />
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10" data-testid="quick-actions-row">
        <QuickAction icon={Plus} label="New Job" sub="Roadmap auto-generated" testId="quick-action-new-project"
          onClick={() => setProjectFormOpen(true)} />
        <QuickAction icon={FileUp} label="Upload Plans" sub="AI reads your drawings" testId="quick-action-upload-plans"
          onClick={() => goToProjectTab("planner")} />
        <QuickAction icon={Send} label="Request Quote" sub="Send a trade a quote link" testId="quick-action-request-quote"
          onClick={() => goToProjectTab("quotes")} />
        <QuickAction icon={NotebookPen} label="Add Diary Entry" sub="Weather, crew and notes" testId="quick-action-diary-entry"
          onClick={() => goToProjectTab("diary")} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        <StatCard icon={Building2} label="Jobs" value={portfolio.length} testId="stat-total-projects" />
        <StatCard icon={Activity} label="Active" value={active.length} testId="stat-active-projects" />
        <StatCard icon={DollarSign} label="Total Value" value={formatAUD(totalValue)} testId="stat-portfolio-value" />
        <StatCard icon={ReceiptText} label="Overdue Invoices" value={overdue_invoices.count}
          sub={overdue_invoices.count ? `${formatMoney(overdue_invoices.total_balance)} outstanding` : "All within terms"}
          testId="stat-overdue-invoices" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
        <InspectionsWidget inspections={inspections} />
        <OverdueInvoicesWidget data={overdue_invoices} />
        <TradeWarningsWidget warnings={trade_warnings} />
        <UpcomingTasksWidget tasks={upcoming_tasks} />
        <ClaimsSnapshotWidget snapshot={claims_snapshot} />
      </div>

      <ProjectFormDialog open={projectFormOpen} onOpenChange={setProjectFormOpen}
        onSaved={(p) => navigate(`/projects/${p.id}`)} />
    </main>
  );
}
