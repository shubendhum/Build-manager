import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProjectOverview } from "@/components/ProjectOverview";
import { RoadmapView } from "@/components/RoadmapView";
import api from "@/lib/api";
import { statusLabel, STATUS_STYLES, formatAUD } from "@/lib/projectUtils";

const FUTURE_TABS = ["Trades", "Quotes", "Invoices", "Budget", "Photos", "Documents"];

export default function ProjectDetailPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const fetchProject = useCallback(async () => {
    try {
      const { data } = await api.get(`/projects/${projectId}`);
      setProject(data);
    } catch (e) {
      if (e.response?.status === 404) setNotFound(true);
    }
  }, [projectId]);

  useEffect(() => { fetchProject(); }, [fetchProject]);

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

      <Tabs defaultValue="overview">
        <TabsList className="bg-slate-800/60 flex-wrap h-auto">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="roadmap" data-testid="tab-roadmap">Roadmap &amp; Tasks</TabsTrigger>
          {FUTURE_TABS.map((t) => (
            <TabsTrigger key={t} value={t.toLowerCase()} disabled data-testid={`tab-${t.toLowerCase()}`} className="opacity-40">
              {t}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview" className="mt-6">
          <ProjectOverview project={project} onChanged={fetchProject} />
        </TabsContent>
        <TabsContent value="roadmap" className="mt-6">
          <RoadmapView projectId={project.id} onProgressChanged={fetchProject} />
        </TabsContent>
      </Tabs>
    </main>
  );
}
