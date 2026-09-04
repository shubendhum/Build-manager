import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ProjectFormDialog } from "@/components/ProjectFormDialog";
import {
  HoldPointsWidget, OverdueInvoicesWidget, TradeWarningsWidget,
  UpcomingTasksWidget, ClaimsSnapshotWidget,
} from "@/components/DashboardWidgets";
import api from "@/lib/api";
import { formatAUD, typeLabel, statusLabel, STATUS_STYLES } from "@/lib/projectUtils";

/**
 * The jobs list, and what needs you across all of them. This is where the app
 * opens. There used to be a separate Home above it that showed the same list,
 * linked back to the same list, and told you how many jobs were in it.
 */
export default function ProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [alerts, setAlerts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const navigate = useNavigate();

  const fetchProjects = useCallback(async () => {
    try {
      const { data } = await api.get("/projects");
      setProjects(data);
    } finally {
      setLoading(false);
    }
  }, []);

  // Advisory only — a slow or failing dashboard must never hide the job list.
  const fetchAlerts = useCallback(async () => {
    try {
      const { data } = await api.get("/dashboard");
      setAlerts(data);
    } catch {
      setAlerts(null);
    }
  }, []);

  useEffect(() => { fetchProjects(); fetchAlerts(); }, [fetchProjects, fetchAlerts]);

  const needsYou = alerts && (
    alerts.hold_points.length + alerts.checklist_overdue.length
    + alerts.overdue_invoices.count + alerts.trade_warnings.length
    + alerts.upcoming_tasks.length);

  return (
    <main className="max-w-7xl mx-auto px-6 py-12" data-testid="projects-page">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-10">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-amber-400 font-semibold mb-2">Your builds</p>
          <h1 className="font-heading text-4xl font-bold tracking-tight text-slate-100">Jobs</h1>
        </div>
        <Button data-testid="new-project-button" onClick={() => setCreateOpen(true)}
          className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
          <Plus className="h-4 w-4" aria-hidden="true" /> New Job
        </Button>
      </div>

      {loading && <p className="text-sm text-slate-400">Loading your jobs…</p>}
      {!loading && projects.length === 0 && (
        <div data-testid="projects-empty" className="rounded-md border border-slate-700 bg-slate-800/30 p-10 text-center">
          <p className="text-sm text-slate-400">
            No jobs yet. Create your first one and it comes with the Victorian payment stages
            and the full supervisor checklist.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 items-start">
        {projects.map((p, idx) => (
          <motion.article
            key={p.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: Math.min(idx * 0.06, 0.4) }}
            data-testid={`project-card-${p.id}`}
            onClick={() => navigate(`/projects/${p.id}`)}
            className="cursor-pointer rounded-md border border-slate-700 bg-card p-6 hover:-translate-y-1 transition-transform duration-200"
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <h2 className="font-heading text-lg font-bold text-slate-100 leading-tight">{p.name}</h2>
              <Badge variant="outline" className={`shrink-0 uppercase tracking-wider text-[10px] ${STATUS_STYLES[p.status]}`}>
                {statusLabel(p.status)}
              </Badge>
            </div>
            <p className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
              <MapPin className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
              {p.site_suburb} VIC {p.site_postcode}
            </p>
            <p className="text-xs text-slate-500 mb-4">{p.client_name} · {typeLabel(p.project_type)}</p>
            <div className="flex items-center gap-3 mb-3">
              <Progress value={p.progress} className="h-2 bg-slate-700" />
              <span className="text-sm font-heading font-bold text-amber-400 w-12 text-right" data-testid={`project-progress-${p.id}`}>
                {p.progress}%
              </span>
            </div>
            <p className="font-heading text-base font-semibold text-slate-200">{formatAUD(p.contract_value)}</p>
          </motion.article>
        ))}
      </div>

      {alerts && needsYou > 0 && (
        <section className="mt-12" data-testid="attention-section">
          <h2 className="font-heading text-sm font-bold uppercase tracking-wider text-slate-100 mb-4">
            Needs you, across every job
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {(alerts.hold_points.length > 0 || alerts.checklist_overdue.length > 0) && (
              <HoldPointsWidget holds={alerts.hold_points} overdue={alerts.checklist_overdue} />
            )}
            {alerts.overdue_invoices.count > 0 && <OverdueInvoicesWidget data={alerts.overdue_invoices} />}
            {alerts.trade_warnings.length > 0 && <TradeWarningsWidget warnings={alerts.trade_warnings} />}
            {alerts.upcoming_tasks.length > 0 && <UpcomingTasksWidget tasks={alerts.upcoming_tasks} />}
            {alerts.claims_snapshot.length > 0 && <ClaimsSnapshotWidget snapshot={alerts.claims_snapshot} />}
          </div>
        </section>
      )}

      <ProjectFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        project={null}
        onSaved={(created) => { fetchProjects(); navigate(`/projects/${created.id}`); }}
      />
    </main>
  );
}
