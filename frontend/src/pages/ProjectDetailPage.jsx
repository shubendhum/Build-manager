import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NextSteps } from "@/components/NextSteps";
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

// Eleven flat tabs meant the order of the job lived in the user's head. These
// six groups follow how a build actually runs. The URL still carries the LEAF
// (?tab=packages), so every existing deep link keeps working.
const TAB_GROUPS = [
  { key: "overview", label: "Overview", children: [["overview", "Overview"]] },
  { key: "plan", label: "Plan", children: [["planner", "AI Planner"]] },
  { key: "procure", label: "Procure", children: [
    ["packages", "Packages"], ["trades", "Trades"], ["quotes", "Quotes"],
  ] },
  { key: "build", label: "Build", children: [
    ["roadmap", "Roadmap & Tasks"], ["diary", "Site Diary"],
  ] },
  { key: "money", label: "Money", children: [
    ["budget", "Budget"], ["invoices", "Invoices"], ["variations", "Variations"],
  ] },
  { key: "files", label: "Files", children: [["documents", "Documents"]] },
];

const LEAF_TO_GROUP = {};
TAB_GROUPS.forEach((g) => g.children.forEach(([leaf]) => { LEAF_TO_GROUP[leaf] = g.key; }));
const LEAVES = Object.keys(LEAF_TO_GROUP);

const CountChip = ({ n, testId }) =>
  n > 0 ? (
    <span data-testid={testId}
      className="ml-1.5 inline-flex items-center justify-center min-w-[1.15rem] h-[1.15rem] px-1 rounded-full bg-amber-500 text-slate-950 text-[10px] font-bold tabular-nums">
      {n}
    </span>
  ) : null;

export default function ProjectDetailPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [project, setProject] = useState(null);
  const [steps, setSteps] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const requested = searchParams.get("tab");
  const leaf = LEAVES.includes(requested) ? requested : "overview";
  const group = LEAF_TO_GROUP[leaf];

  const setLeaf = (v) => setSearchParams(v === "overview" ? {} : { tab: v }, { replace: true });
  const setGroup = (g) => setLeaf(TAB_GROUPS.find((x) => x.key === g).children[0][0]);

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
      setSteps(null);   // never block the page on the advisory panel
    }
  }, [projectId]);

  const refresh = useCallback(() => { fetchProject(); fetchSteps(); }, [fetchProject, fetchSteps]);

  useEffect(() => { fetchProject(); }, [fetchProject]);
  // Re-read on navigation so counts reflect whatever you just did in another tab.
  useEffect(() => { fetchSteps(); }, [fetchSteps, leaf]);

  const badges = steps?.badges || {};
  const groupCount = (g) => g.children.reduce((n, [l]) => n + (badges[l] || 0), 0);

  if (notFound) {
    return (
      <main className="max-w-7xl mx-auto px-6 py-12">
        <p className="text-sm text-slate-400" data-testid="project-not-found">Project not found.</p>
      </main>
    );
  }
  if (!project) {
    return <main className="max-w-7xl mx-auto px-6 py-12"><p className="text-sm text-slate-400">Loading project…</p></main>;
  }

  const activeGroup = TAB_GROUPS.find((g) => g.key === group);

  const leafContent = {
    overview: <><NextSteps data={steps} onGo={setLeaf} /><ProjectOverview project={project} onChanged={refresh} /></>,
    planner: <PlannerTab project={project} onChanged={refresh} />,
    packages: <PackagesTab projectId={project.id} />,
    trades: <ProjectTradesTab projectId={project.id} />,
    quotes: <QuotesTab projectId={project.id} />,
    roadmap: <RoadmapView projectId={project.id} onProgressChanged={refresh} />,
    diary: <PhotosTab project={project} />,
    budget: <BudgetTab project={project} />,
    invoices: <InvoicesTab projectId={project.id} contractValue={project.contract_value} />,
    variations: <VariationsTab projectId={project.id} />,
    documents: <DocumentsTab projectId={project.id} />,
  };

  return (
    <main className="max-w-7xl mx-auto px-6 py-10" data-testid="project-detail-page">
      <button data-testid="back-to-projects" onClick={() => navigate("/projects")}
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-amber-400 transition-colors duration-200 mb-6">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Projects
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <h1 className="font-heading text-3xl font-bold tracking-tight text-slate-100" data-testid="project-title">{project.name}</h1>
            <Badge variant="outline" className={`uppercase tracking-wider text-[10px] ${STATUS_STYLES[project.status]}`} data-testid="project-status-badge">
              {statusLabel(project.status)}
            </Badge>
          </div>
          <p className="flex items-center gap-1.5 text-sm text-slate-400">
            <MapPin className="h-4 w-4 text-amber-400" aria-hidden="true" />
            {project.site_street && `${project.site_street}, `}{project.site_suburb} VIC {project.site_postcode}
            <span className="text-slate-600 mx-1">·</span>
            {formatAUD(project.contract_value)}
          </p>
        </div>
        <div className="w-full sm:w-64">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Overall progress</span>
            <span className="font-heading font-bold text-amber-400" data-testid="project-overall-progress">{project.progress}%</span>
          </div>
          <Progress value={project.progress} className="h-2.5 bg-slate-700" />
        </div>
      </div>

      <Tabs value={group} onValueChange={setGroup}>
        <TabsList className="bg-slate-800/60 h-auto max-w-full justify-start overflow-x-auto flex-nowrap md:flex-wrap">
          {TAB_GROUPS.map((g) => (
            <TabsTrigger key={g.key} value={g.key} data-testid={`tab-${g.key}`}>
              {g.label}
              <CountChip n={groupCount(g)} testId={`tab-badge-${g.key}`} />
            </TabsTrigger>
          ))}
        </TabsList>

        {TAB_GROUPS.map((g) => (
          <TabsContent key={g.key} value={g.key} className="mt-6">
            {g.children.length > 1 && (
              <div className="flex flex-wrap gap-1 mb-6 border-b border-slate-800 pb-px" data-testid={`subnav-${g.key}`}>
                {g.children.map(([l, label]) => (
                  <button key={l} type="button" data-testid={`subtab-${l}`} onClick={() => setLeaf(l)}
                    aria-current={leaf === l ? "page" : undefined}
                    className={`inline-flex items-center rounded-t-md px-3.5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors duration-200 ${
                      leaf === l
                        ? "border-amber-500 text-amber-400"
                        : "border-transparent text-slate-400 hover:text-slate-200"
                    }`}>
                    {label}
                    <CountChip n={badges[l] || 0} testId={`subtab-badge-${l}`} />
                  </button>
                ))}
              </div>
            )}
            {g.key === group && leafContent[leaf]}
          </TabsContent>
        ))}
      </Tabs>
    </main>
  );
}
