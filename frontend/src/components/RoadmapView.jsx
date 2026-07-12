import { useState, useEffect, useCallback } from "react";
import { Progress } from "@/components/ui/progress";
import { StageSection } from "@/components/StageSection";
import api from "@/lib/api";

export const RoadmapView = ({ projectId, onProgressChanged }) => {
  const [roadmap, setRoadmap] = useState(null);

  const fetchRoadmap = useCallback(async () => {
    const { data } = await api.get(`/projects/${projectId}/roadmap`);
    setRoadmap(data);
  }, [projectId]);

  useEffect(() => { fetchRoadmap(); }, [fetchRoadmap]);

  const handleChanged = () => {
    fetchRoadmap();
    onProgressChanged?.();
  };

  if (!roadmap) return <p className="text-sm text-slate-400">Loading roadmap…</p>;

  const firstIncomplete = roadmap.stages.find((s) => (s.progress ?? 0) < 100)?.key;

  return (
    <div data-testid="roadmap-view">
      <div className="rounded-md border border-slate-700 bg-card p-5 mb-6 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[220px]">
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-1">Victorian compliance roadmap</p>
          <p className="text-sm text-slate-300">
            Stage weights follow the Victorian progress payment schedule. RBS inspections are flagged.
          </p>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-72">
          <Progress value={roadmap.overall_progress} className="h-2.5 bg-slate-700" />
          <span className="font-heading text-lg font-bold text-amber-400" data-testid="roadmap-overall-progress">
            {roadmap.overall_progress}%
          </span>
        </div>
      </div>

      <div className="space-y-4">
        {roadmap.stages.map((stage) => (
          <StageSection
            key={stage.key}
            stage={stage}
            projectId={projectId}
            defaultOpen={stage.key === firstIncomplete}
            onChanged={handleChanged}
          />
        ))}
      </div>
    </div>
  );
};
