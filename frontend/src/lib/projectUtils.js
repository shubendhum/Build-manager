export const PROJECT_TYPES = [
  { value: "new-build", label: "New Build" },
  { value: "extension", label: "Extension" },
  { value: "renovation", label: "Renovation" },
];

export const PROJECT_STATUSES = [
  { value: "planning", label: "Planning" },
  { value: "active", label: "Active" },
  { value: "on-hold", label: "On Hold" },
  { value: "completed", label: "Completed" },
];

export const STATUS_STYLES = {
  planning: "bg-sky-500/15 text-sky-400 border-sky-500/40",
  active: "bg-emerald-600/20 text-emerald-400 border-emerald-600/40",
  "on-hold": "bg-amber-500/15 text-amber-400 border-amber-500/40",
  completed: "bg-slate-500/15 text-slate-300 border-slate-500/40",
};

export const TASK_STATUSES = [
  { value: "not-started", label: "Not Started", dot: "bg-slate-500" },
  { value: "in-progress", label: "In Progress", dot: "bg-sky-400" },
  { value: "blocked", label: "Blocked", dot: "bg-red-500" },
  { value: "done", label: "Done", dot: "bg-emerald-500" },
  { value: "n-a", label: "N/A", dot: "bg-slate-600" },
];

export const typeLabel = (v) => PROJECT_TYPES.find((t) => t.value === v)?.label || v;
export const statusLabel = (v) => PROJECT_STATUSES.find((s) => s.value === v)?.label || v;

export const formatAUD = (value) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(value || 0);

export const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d) ? iso : d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
};

export const isOverdue = (task) =>
  task.due_date && task.status !== "done" && task.status !== "n-a" &&
  new Date(`${task.due_date}T23:59:59`) < new Date();
