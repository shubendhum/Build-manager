export const STAGES = [
  { value: "site-preparation", label: "Site Preparation" },
  { value: "base/slab", label: "Base / Slab" },
  { value: "frame", label: "Frame" },
  { value: "lockup", label: "Lockup" },
  { value: "fixing", label: "Fixing" },
  { value: "completion", label: "Completion" },
  { value: "external-works", label: "External Works" },
];

export const stageLabel = (value) => {
  const s = STAGES.find((st) => st.value === value);
  if (s) return s.label;
  return value === "unknown" ? "Unknown" : value;
};

export const CONFIDENCE_STYLES = {
  high: "bg-emerald-600/20 text-emerald-400 border-emerald-600/40",
  medium: "bg-amber-500/15 text-amber-400 border-amber-500/40",
  low: "bg-red-500/15 text-red-400 border-red-500/40",
};
