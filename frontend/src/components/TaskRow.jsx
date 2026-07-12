import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Trash2, CalendarClock, ShieldAlert, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TaskDialog } from "@/components/TaskDialog";
import api from "@/lib/api";
import { TASK_STATUSES, formatDate, isOverdue } from "@/lib/projectUtils";

export const TaskRow = ({ task, onChanged }) => {
  const [editOpen, setEditOpen] = useState(false);
  const overdue = isOverdue(task);
  const done = task.status === "done";
  const na = task.status === "n-a";

  const setStatus = async (status) => {
    try {
      await api.put(`/tasks/${task.id}`, { status });
      onChanged();
    } catch (e) {
      toast.error("Failed to update task status.");
    }
  };

  const remove = async () => {
    try {
      await api.delete(`/tasks/${task.id}`);
      toast.success("Task deleted");
      onChanged();
    } catch (e) {
      toast.error("Failed to delete task.");
    }
  };

  return (
    <div className={`px-5 py-3 flex flex-wrap items-center gap-3 ${na ? "opacity-50" : ""}`} data-testid={`task-row-${task.id}`}>
      <div className="flex-1 min-w-[240px]">
        <div className="flex flex-wrap items-center gap-2">
          <p className={`text-sm font-medium ${done ? "text-slate-500 line-through" : "text-slate-200"}`} data-testid={`task-title-${task.id}`}>
            {task.title}
          </p>
          {task.is_mandatory_inspection && (
            <Badge className="bg-amber-500 text-slate-950 hover:bg-amber-500 uppercase tracking-wider text-[9px] px-2 py-0.5 gap-1" data-testid={`task-inspection-badge-${task.id}`}>
              <ShieldAlert className="h-3 w-3" aria-hidden="true" /> RBS Inspection
            </Badge>
          )}
          {task.is_custom && (
            <Badge variant="outline" className="border-slate-600 text-slate-400 uppercase tracking-wider text-[9px] px-2 py-0.5">Custom</Badge>
          )}
        </div>
        {task.description && <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">{task.description}</p>}
        <div className="flex flex-wrap items-center gap-3 mt-1">
          {task.assigned_trade && (
            <span className="inline-flex items-center gap-1 text-xs text-slate-400">
              <Wrench className="h-3 w-3 text-amber-400" aria-hidden="true" /> {task.assigned_trade}
            </span>
          )}
          {task.due_date && (
            <span className={`inline-flex items-center gap-1 text-xs ${overdue ? "text-red-400 font-semibold" : "text-slate-400"}`}
              data-testid={`task-due-${task.id}`}>
              <CalendarClock className="h-3 w-3" aria-hidden="true" />
              {formatDate(task.due_date)}{overdue && " · OVERDUE"}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Select value={task.status} onValueChange={setStatus}>
          <SelectTrigger className="h-8 w-[140px] bg-slate-800/50 border-slate-600 text-xs" data-testid={`task-status-select-${task.id}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TASK_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                <span className="inline-flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                  {s.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button data-testid={`task-edit-${task.id}`} onClick={() => setEditOpen(true)}
          className="p-1.5 rounded-md text-slate-500 hover:text-amber-400 transition-colors duration-200">
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </button>
        <button data-testid={`task-delete-${task.id}`} onClick={remove}
          className="p-1.5 rounded-md text-slate-500 hover:text-red-400 transition-colors duration-200">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <TaskDialog open={editOpen} onOpenChange={setEditOpen} projectId={task.project_id} stageKey={task.stage_key} task={task} onSaved={onChanged} />
    </div>
  );
};
