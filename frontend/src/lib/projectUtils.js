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

export const ROADMAP_STAGES = [
  { value: "pre-construction", label: "Pre-Construction" },
  { value: "base", label: "Base" },
  { value: "frame", label: "Frame" },
  { value: "lockup", label: "Lockup" },
  { value: "fixing", label: "Fixing" },
  { value: "completion", label: "Completion" },
];

export const roadmapStageLabel = (v) => ROADMAP_STAGES.find((s) => s.value === v)?.label || v;

export const typeLabel = (v) => PROJECT_TYPES.find((t) => t.value === v)?.label || v;
export const statusLabel = (v) => PROJECT_STATUSES.find((s) => s.value === v)?.label || v;

export const formatAUD = (value) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);

export const formatMoney = (value) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);

export const HEALTH_STYLES = {
  under: "bg-emerald-600/20 text-emerald-400 border-emerald-600/40",
  "on-track": "bg-sky-500/15 text-sky-400 border-sky-500/40",
  over: "bg-red-500/15 text-red-400 border-red-500/50",
  "no-estimate": "bg-slate-500/15 text-slate-400 border-slate-500/40",
};

export const HEALTH_LABELS = {
  under: "Under Budget",
  "on-track": "On Track",
  over: "Over Budget",
  "no-estimate": "No Estimate",
};

export const formatDate = (iso) => {
  if (!iso) return "—";
  const d = iso.includes("T") ? new Date(iso) : new Date(`${iso}T00:00:00`);
  return isNaN(d) ? iso : d.toLocaleDateString("en-AU", { day: "2-digit", month: "2-digit", year: "numeric" });
};

export const formatDateTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d)
    ? iso
    : d.toLocaleString("en-AU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
};

export const isOverdue = (task) =>
  task.due_date && task.status !== "done" && task.status !== "n-a" &&
  new Date(`${task.due_date}T23:59:59`) < new Date();
