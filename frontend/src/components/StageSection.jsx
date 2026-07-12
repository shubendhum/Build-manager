import { useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { TaskRow } from "@/components/TaskRow";
import { TaskDialog } from "@/components/TaskDialog";

export const StageSection = ({ stage, projectId, defaultOpen, onChanged }) => {
  const [open, setOpen] = useState(defaultOpen);
  const [addOpen, setAddOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-md border border-slate-700 bg-card overflow-hidden" data-testid={`stage-section-${stage.key}`}>
        <CollapsibleTrigger asChild>
          <button className="w-full flex flex-wrap items-center gap-4 px-5 py-4 text-left hover:bg-slate-800/40 transition-colors duration-200"
            data-testid={`stage-toggle-${stage.key}`}>
            <ChevronDown className={`h-4 w-4 text-amber-400 shrink-0 transition-transform duration-200 ${open ? "" : "-rotate-90"}`} aria-hidden="true" />
            <div className="flex-1 min-w-[200px]">
              <p className="font-heading font-bold text-slate-100">
                <span className="text-amber-400 mr-2">Stage {stage.number}</span>{stage.label}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {stage.done_count}/{stage.relevant_count} tasks done · weight {stage.weight}%
              </p>
            </div>
            <div className="flex items-center gap-3 w-full sm:w-56">
              <Progress value={stage.progress ?? 0} className="h-2 bg-slate-700" />
              <span className="text-sm font-heading font-bold text-slate-200 w-12 text-right" data-testid={`stage-progress-${stage.key}`}>
                {stage.progress ?? 0}%
              </span>
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-slate-700/70 divide-y divide-slate-800">
            {stage.tasks.map((task) => (
              <TaskRow key={task.id} task={task} onChanged={onChanged} />
            ))}
          </div>
          <div className="px-5 py-3 border-t border-slate-700/70">
            <Button variant="ghost" size="sm" data-testid={`add-task-button-${stage.key}`} onClick={() => setAddOpen(true)}
              className="text-amber-400 hover:text-amber-300 hover:bg-amber-500/10">
              <Plus className="h-4 w-4" aria-hidden="true" /> Add task
            </Button>
          </div>
        </CollapsibleContent>
      </div>
      <TaskDialog open={addOpen} onOpenChange={setAddOpen} projectId={projectId} stageKey={stage.key} task={null} onSaved={onChanged} />
    </Collapsible>
  );
};
