import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, MapPin, ChevronDown, Hammer, FileSearch, CalendarDays, Wallet, MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NextSteps } from "@/components/NextSteps";
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

// The builder's loop — engage, price, book, invoice, pay, cost — is one row per
// trade on the Work board. Everything else is reference material and sits behind
// More, so the main bar stays at four choices.
const MAIN = [
  ["work", "Work", Hammer],          // who is doing what, and where it is up to
  ["planner", "Plan", FileSearch],   // read the drawings
  ["roadmap", "Schedule", CalendarDays],
  ["budget", "Costs", Wallet],
];

const MORE = [
  ["overview", "Project details"],
  ["quotes", "All quotes"],
  ["invoices", "All invoices"],
  ["packages", "Package list"],
  ["trades", "Trades on this job"],
  ["variations", "Variations"],
  ["diary", "Site diary"],
  ["documents", "Documents"],
];

const LEAVES = [...MAIN, ...MORE].map(([k]) => k);
const MORE_KEYS = MORE.map(([k]) => k);

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

  const moreActive = MORE_KEYS.includes(leaf);
  const moreLabel = MORE.find(([k]) => k === leaf)?.[1];
  const tabCls = (on) =>
    `px-4 py-2 text-sm font-medium rounded-md transition-colors duration-200 ${
      on ? "bg-amber-500 text-slate-950" : "text-slate-300 hover:text-amber-400 hover:bg-slate-800"
    }`;

  return (
    <main className="max-w-7xl mx-auto px-6 py-8" data-testid="project-detail-page">
      {/* Compact header — the work should be visible without scrolling. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <button data-testid="back-to-projects" onClick={() => navigate("/projects")}
            className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-amber-400 transition-colors duration-200 shrink-0">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All jobs
          </button>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-slate-100 truncate" data-testid="project-title">
            {project.name}
          </h1>
          <Badge variant="outline" className={`uppercase tracking-wider text-[10px] shrink-0 ${STATUS_STYLES[project.status]}`}
            data-testid="project-status-badge">
            {statusLabel(project.status)}
          </Badge>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-400">
          <span className="hidden sm:inline-flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
            {project.site_suburb} VIC {project.site_postcode}
          </span>
          <span className="hidden md:inline">{formatAUD(project.contract_value)}</span>
          <span className="flex items-center gap-2">
            <Progress value={project.progress} className="h-2 w-24 bg-slate-700" />
            <span className="font-heading font-bold text-amber-400 tabular-nums" data-testid="project-overall-progress">
              {project.progress}%
            </span>
          </span>
        </div>
      </div>

      <nav className="flex flex-wrap items-center gap-1 mb-6 border-b border-slate-800 pb-3" aria-label="Project sections">
        {MAIN.map(([k, label, Icon]) => (
          <button key={k} type="button" data-testid={`tab-${k}`} onClick={() => setLeaf(k)}
            aria-current={leaf === k ? "page" : undefined}
            className={`${tabCls(leaf === k)} inline-flex items-center gap-2`}>
            <Icon className="h-4 w-4" aria-hidden="true" /> {label}
          </button>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" data-testid="tab-more" className={`${tabCls(moreActive)} inline-flex items-center gap-1`}>
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              {moreActive ? moreLabel : "More"} <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="bg-card border-slate-700">
            {MORE.map(([k, label]) => (
              <DropdownMenuItem key={k} data-testid={`more-${k}`} onSelect={() => setLeaf(k)}
                className="text-slate-300 focus:bg-slate-800 focus:text-amber-400 cursor-pointer">
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>

      {content}
    </main>
  );
}
