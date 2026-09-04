import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, MapPin, Hammer, FileSearch, CalendarDays, Wallet, FolderOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { NextSteps } from "@/components/NextSteps";
import { QuickUpload } from "@/components/QuickUpload";
import { ChatPanel } from "@/components/ChatPanel";
import { BuildStepsTab } from "@/components/BuildStepsTab";
import { TradeBoard } from "@/components/TradeBoard";
import { ProjectOverview } from "@/components/ProjectOverview";
import { PlannerTab } from "@/components/PlannerTab";
import { RoadmapView } from "@/components/RoadmapView";
import { ProjectTradesTab } from "@/components/ProjectTradesTab";
import { PackagesTab } from "@/components/PackagesTab";
import { QuotesTab } from "@/components/QuotesTab";
import { InvoicesTab } from "@/components/InvoicesTab";
import { BudgetTab } from "@/components/BudgetTab";
import { PhotosTab } from "@/components/PhotosTab";
import { VariationsTab } from "@/components/VariationsTab";
import { DocumentsTab } from "@/components/DocumentsTab";
import api from "@/lib/api";
import { statusLabel, STATUS_STYLES, formatAUD } from "@/lib/projectUtils";

// Tabs with sub-tabs meant you had to click a group to discover what was inside
// it — you cannot find a screen you do not know exists. Every destination is now
// listed at once, grouped by heading: a rail on a wide screen, a single select
// on a phone. Nothing to hunt for.
const AREAS = [
  { key: "work", label: "The work", icon: Hammer, children: [
      ["work", "Trade board", "who is doing what, and where each is up to"],
      ["steps", "My checklist", "permits, hold points, inspections and certificates"],
      ["packages", "Packages", "the scopes you send out for quotes"],
      ["quotes", "Quotes & requests", "prices in, and who you asked"],
      ["trades", "Tradies on this job", "assigned to this job"],
  ] },
  { key: "plan", label: "Planning", icon: FileSearch, children: [
      ["planner", "Read the drawings", "AI reads your plans into packages and costs"],
      ["roadmap", "Tasks", "the job's task list by stage"],
  ] },
  { key: "money", label: "Money", icon: Wallet, children: [
      ["budget", "Budget", "estimated against committed and paid"],
      ["invoices", "Invoices & claims", "what is owed and what is claimed"],
      ["variations", "Variations", "approved changes to the contract"],
  ] },
  { key: "files", label: "Files & records", icon: FolderOpen, children: [
      ["documents", "Documents", "drawings, permits, certificates"],
      ["diary", "Site diary & photos", "progress photos and daily notes"],
      ["overview", "Job details", "client, builder, insurance, dates"],
  ] },
];

const LEAF_TO_AREA = {};
AREAS.forEach((a) => a.children.forEach(([leaf]) => { LEAF_TO_AREA[leaf] = a.key; }));
const LEAVES = Object.keys(LEAF_TO_AREA);

// Actions the Work board already surfaces on its own rows — don't say it twice.
const BOARD_COVERS = new Set([
  "send-packages", "decide-quotes", "chase-trades", "unopened-rfqs", "overdue-invoices",
]);

export default function ProjectDetailPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [project, setProject] = useState(null);
  const [steps, setSteps] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const requested = searchParams.get("tab");
  const leaf = LEAVES.includes(requested) ? requested : "work";
  const setLeaf = (v) => setSearchParams(v === "work" ? {} : { tab: v }, { replace: true });

  const fetchProject = useCallback(async () => {
    try {
      const { data } = await api.get(`/projects/${projectId}`);
      setProject(data);
    } catch (e) {
      if (e.response?.status === 404) setNotFound(true);
    }
  }, [projectId]);

  const fetchSteps = useCallback(async () => {
    try {
      const { data } = await api.get(`/projects/${projectId}/next-steps`);
      setSteps(data);
    } catch {
      setSteps(null);   // advisory only — never block the page
    }
  }, [projectId]);

  const refresh = useCallback(() => { fetchProject(); fetchSteps(); }, [fetchProject, fetchSteps]);

  useEffect(() => { fetchProject(); }, [fetchProject]);
  useEffect(() => { fetchSteps(); }, [fetchSteps, leaf]);

  if (notFound) {
    return (
      <main className="max-w-7xl mx-auto px-6 py-12">
        <p className="text-sm text-slate-400" data-testid="project-not-found">Project not found.</p>
      </main>
    );
  }
  if (!project) {
    return <main className="max-w-7xl mx-auto px-6 py-10"><p className="text-sm text-slate-400">Loading project…</p></main>;
  }

  // On the board, only show steps the board itself can't act on.
  const boardSteps = steps && {
    ...steps,
    actions: steps.actions.filter((a) => !BOARD_COVERS.has(a.id)),
    done: [],
  };

  const content = {
    steps: <BuildStepsTab projectId={project.id} />,
    work: (
      <>
        {boardSteps?.actions.length > 0 && <NextSteps data={boardSteps} onGo={setLeaf} />}
        <TradeBoard projectId={project.id} />
      </>
    ),
    planner: <PlannerTab project={project} onChanged={refresh} />,
    roadmap: <RoadmapView projectId={project.id} onProgressChanged={refresh} />,
    budget: <BudgetTab project={project} />,
    overview: <><NextSteps data={steps} onGo={setLeaf} /><ProjectOverview project={project} onChanged={refresh} /></>,
    quotes: <QuotesTab projectId={project.id} />,
    invoices: <InvoicesTab projectId={project.id} contractValue={project.contract_value} />,
    packages: <PackagesTab projectId={project.id} />,
    trades: <ProjectTradesTab projectId={project.id} />,
    variations: <VariationsTab projectId={project.id} />,
    diary: <PhotosTab project={project} />,
    documents: <DocumentsTab projectId={project.id} />,
  }[leaf];

  const area = LEAF_TO_AREA[leaf];
  const activeArea = AREAS.find((a) => a.key === area);
  const activeLeaf = activeArea?.children.find(([k]) => k === leaf);
  const stage = steps?.current_stage;

  return (
    <main className="max-w-[100rem] mx-auto px-4 sm:px-6 py-6" data-testid="project-detail-page">
      {/* Header: the job, and what stage it is at, on every screen. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
          <button data-testid="back-to-projects" onClick={() => navigate("/projects")}
            className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-amber-400 transition-colors duration-200 shrink-0">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All jobs
          </button>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-slate-100" data-testid="project-title">
            {project.name}
          </h1>
          <Badge variant="outline" className={`uppercase tracking-wider text-[10px] shrink-0 ${STATUS_STYLES[project.status]}`}
            data-testid="project-status-badge">
            {statusLabel(project.status)}
          </Badge>
          {stage && (
            <button type="button" data-testid="header-stage" onClick={() => setLeaf("work")}
              title="Go to the trade board"
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-400 hover:bg-amber-500/20 transition-colors duration-200">
              <Hammer className="h-3.5 w-3.5" aria-hidden="true" />
              Stage {stage.n}: {stage.name}
            </button>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <QuickUpload projectId={project.id} onUploaded={refresh} />
          <span className="hidden lg:inline-flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
            {project.site_suburb} VIC {project.site_postcode}
          </span>
          <span className="flex items-center gap-2">
            <Progress value={project.progress} className="h-2 w-20 bg-slate-700" />
            <span className="font-heading font-bold text-amber-400 tabular-nums" data-testid="project-overall-progress">
              {project.progress}%
            </span>
          </span>
        </div>
      </div>

      <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-7">
        {/* Phone: one select listing every screen, so nothing is hidden. */}
        <div className="lg:hidden mb-5">
          <label htmlFor="job-nav" className="sr-only">Go to</label>
          <select id="job-nav" data-testid="job-nav-select" value={leaf}
            onChange={(e) => setLeaf(e.target.value)}
            className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2.5 text-sm text-slate-100">
            {AREAS.map((a) => (
              <optgroup key={a.key} label={a.label}>
                {a.children.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </optgroup>
            ))}
          </select>
          {activeLeaf?.[2] && <p className="text-xs text-slate-500 mt-1.5">{activeLeaf[2]}</p>}
        </div>

        {/* Wide: every destination visible at once, grouped and described. */}
        <nav className="hidden lg:block sticky top-6 self-start" aria-label="Job sections" data-testid="job-nav">
          {AREAS.map((a) => (
            <div key={a.key} className="mb-5">
              <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-1.5 px-2">
                <a.icon className="h-3.5 w-3.5" aria-hidden="true" /> {a.label}
              </p>
              {a.children.map(([k, label, hint]) => (
                <button key={k} type="button" data-testid={`nav-${k}`} onClick={() => setLeaf(k)}
                  aria-current={leaf === k ? "page" : undefined}
                  className={`block w-full text-left rounded-md px-2.5 py-1.5 mb-0.5 transition-colors duration-200 ${
                    leaf === k ? "bg-amber-500/15 text-amber-400" : "text-slate-300 hover:bg-slate-800 hover:text-slate-100"
                  }`}>
                  <span className="block text-sm font-medium">{label}</span>
                  <span className={`block text-[11px] leading-tight ${leaf === k ? "text-amber-400/70" : "text-slate-500"}`}>
                    {hint}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="min-w-0">
      {content}
        </div>
      </div>

      <ChatPanel projectId={project.id} projectName={project.name} />
    </main>
  );
}
