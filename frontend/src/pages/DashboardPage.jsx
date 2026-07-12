import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { FolderKanban, Activity, DollarSign, TrendingUp, ArrowRight } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import api from "@/lib/api";
import { formatAUD } from "@/lib/projectUtils";

const StatCard = ({ icon: Icon, label, value, testId }) => (
  <div className="rounded-md border border-slate-700 bg-card p-5" data-testid={testId}>
    <div className="flex items-center gap-2 text-slate-400 mb-2">
      <Icon className="h-4 w-4 text-amber-400" aria-hidden="true" />
      <span className="text-xs uppercase tracking-[0.15em]">{label}</span>
    </div>
    <p className="font-heading text-2xl font-bold text-slate-100">{value}</p>
  </div>
);

export default function DashboardPage() {
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    api.get("/projects").then(({ data }) => setProjects(data)).catch(() => {});
  }, []);

  const active = projects.filter((p) => p.status === "active");
  const totalValue = projects.reduce((s, p) => s + (p.contract_value || 0), 0);
  const avgProgress = projects.length ? Math.round(projects.reduce((s, p) => s + p.progress, 0) / projects.length) : 0;

  return (
    <main className="max-w-7xl mx-auto px-6 py-12" data-testid="dashboard-page">
      <p className="text-xs uppercase tracking-[0.2em] text-amber-400 font-semibold mb-2">Overview</p>
      <h1 className="font-heading text-4xl font-bold tracking-tight text-slate-100 mb-2">Dashboard</h1>
      <p className="text-sm text-slate-400 mb-10">Portfolio snapshot — the full dashboard arrives in a later phase.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
        <StatCard icon={FolderKanban} label="Projects" value={projects.length} testId="stat-total-projects" />
        <StatCard icon={Activity} label="Active" value={active.length} testId="stat-active-projects" />
        <StatCard icon={DollarSign} label="Portfolio Value" value={formatAUD(totalValue)} testId="stat-portfolio-value" />
        <StatCard icon={TrendingUp} label="Avg Progress" value={`${avgProgress}%`} testId="stat-avg-progress" />
      </div>

      <div className="flex items-center justify-between mb-4">
        <h2 className="font-heading text-lg font-bold uppercase tracking-wider text-slate-100">Active Builds</h2>
        <Link to="/projects" data-testid="dashboard-view-projects-link"
          className="inline-flex items-center gap-1 text-sm text-amber-400 hover:text-amber-300 transition-colors duration-200">
          All projects <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
      <div className="space-y-3">
        {active.length === 0 && <p className="text-sm text-slate-500">No active projects.</p>}
        {active.map((p) => (
          <Link key={p.id} to={`/projects/${p.id}`} data-testid={`dashboard-project-${p.id}`}
            className="block rounded-md border border-slate-700 bg-card px-5 py-4 hover:border-amber-500/50 transition-colors duration-200">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-[200px]">
                <p className="font-heading font-semibold text-slate-100">{p.name}</p>
                <p className="text-xs text-slate-500">{p.site_suburb} VIC {p.site_postcode} · {formatAUD(p.contract_value)}</p>
              </div>
              <div className="flex items-center gap-3 w-56">
                <Progress value={p.progress} className="h-2 bg-slate-700" />
                <span className="text-sm font-heading font-bold text-amber-400 w-12 text-right">{p.progress}%</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
