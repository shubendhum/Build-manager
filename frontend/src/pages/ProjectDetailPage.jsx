import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { NextSteps } from "@/components/NextSteps";
import { QuickUpload } from "@/components/QuickUpload";
import { ChatPanel } from "@/components/ChatPanel";
import { BuildStepsTab } from "@/components/BuildStepsTab";
import { TradeBoard } from "@/components/TradeBoard";
import { ProjectOverview } from "@/components/ProjectOverview";
import { DrawingsTab } from "@/components/DrawingsTab";
import { MoneyTab } from "@/components/MoneyTab";
import { TimelineTab } from "@/components/TimelineTab";
import { PhotosTab } from "@/components/PhotosTab";
import api from "@/lib/api";
import { statusLabel, STATUS_STYLES } from "@/lib/projectUtils";

// Six screens, flat, all visible at once — a rail on a wide screen, one select
// on a phone. There were thirteen, and the same trade package appeared on three
// of them; a screen you can reach three ways is a screen you cannot place.
const SCREENS = [
  ["work", "Board", "every trade: who is asked, what they quoted, when they are on site"],
  ["steps", "My checklist", "permits, hold points, inspections and certificates"],
  ["timeline", "Timeline", "planned back from handover, and what to order when"],
  ["drawings", "Drawings & files", "read the plans, and everything filed on this job"],
  ["money", "Money", "estimate, budget, invoices, claims and variations"],
  ["diary", "Site diary", "progress photos and daily notes"],
  ["overview", "Job details", "client, builder, insurance, dates"],
];

// Where the old links land, so a bookmark or an old next-step still works.
const MOVED = {
  packages: "work", quotes: "work", trades: "work",
  planner: "drawings", documents: "drawings",
  budget: "money", invoices: "money", variations: "money",
  roadmap: "money",
};

const KEYS = SCREENS.map(([k]) => k);

export default function ProjectDetailPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [project, setProject] = useState(null);
  const [steps, setSteps] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const [focusPackage, setFocusPackage] = useState(null);

  const requested = searchParams.get("tab");
  const leaf = KEYS.includes(requested) ? requested : MOVED[requested] || "work";
  const setLeaf = (v) => setSearchParams(v === "work" ? {} : { tab: v }, { replace: true });

  // The checklist confirms; the board acts. Following a trade from a checklist
  // item lands on its row rather than dropping you at the top of the board.
  const goToBoard = (packageId) => { setFocusPackage(packageId || null); setLeaf("work"); };

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
        <p className="text-sm text-slate-400" data-testid="project-not-found">Job not found.</p>
      </main>
    );
  }
  if (!project) {
    return <main className="max-w-7xl mx-auto px-6 py-10"><p className="text-sm text-slate-400">Loading the job…</p></main>;
  }

  const content = {
    // "What to do next" is shown once, unfiltered, at the top of the board —
    // the first thing you should read when you open a job.
    work: (
      <>
        {steps?.actions.length > 0 && <NextSteps data={steps} onGo={setLeaf} />}
        <TradeBoard projectId={project.id} focusPackageId={focusPackage} />
      </>
    ),
    steps: <BuildStepsTab projectId={project.id} onGoToBoard={goToBoard} />,
    timeline: <TimelineTab project={project} onChanged={refresh} />,
    drawings: <DrawingsTab project={project} onChanged={refresh} />,
    money: <MoneyTab project={project} />,
    diary: <PhotosTab project={project} />,
    overview: <ProjectOverview project={project} onChanged={refresh} />,
  }[leaf];

  const activeScreen = SCREENS.find(([k]) => k === leaf);
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
              title="Go to the board"
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-400 hover:bg-amber-500/20 transition-colors duration-200">
              <span className="tabular-nums">Step {stage.n} of {stage.of}</span>
              <span className="text-amber-400/70">·</span>
              {stage.name}
            </button>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <QuickUpload projectId={project.id} onUploaded={refresh} />
          <span className="hidden lg:inline-flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
            {project.site_suburb} VIC {project.site_postcode}
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
            {SCREENS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          {activeScreen?.[2] && <p className="text-xs text-slate-500 mt-1.5">{activeScreen[2]}</p>}
        </div>

        {/* Wide: every destination visible at once, grouped and described. */}
        <nav className="hidden lg:block sticky top-6 self-start" aria-label="Job screens" data-testid="job-nav">
          {SCREENS.map(([k, label, hint]) => (
            <button key={k} type="button" data-testid={`nav-${k}`} onClick={() => setLeaf(k)}
              aria-current={leaf === k ? "page" : undefined}
              className={`block w-full text-left rounded-md px-2.5 py-2 mb-1 transition-colors duration-200 ${
                leaf === k ? "bg-amber-500/15 text-amber-400" : "text-slate-300 hover:bg-slate-800 hover:text-slate-100"
              }`}>
              <span className="block text-sm font-medium">{label}</span>
              <span className={`block text-[11px] leading-tight ${leaf === k ? "text-amber-400/70" : "text-slate-500"}`}>
                {hint}
              </span>
            </button>
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
