export const TRADE_TYPES = [
  { value: "electrician", label: "Electrician" },
  { value: "plumber", label: "Plumber" },
  { value: "carpenter", label: "Carpenter" },
  { value: "bricklayer", label: "Bricklayer" },
  { value: "plasterer", label: "Plasterer" },
  { value: "tiler", label: "Tiler" },
  { value: "painter", label: "Painter" },
  { value: "concreter", label: "Concreter" },
  { value: "roofer", label: "Roofer" },
  { value: "renderer", label: "Renderer" },
  { value: "waterproofer", label: "Waterproofer" },
  { value: "excavator-earthworks", label: "Excavator / Earthworks" },
  { value: "building-surveyor", label: "Building Surveyor" },
  { value: "other", label: "Other" },
];

export const tradeTypeLabel = (v) => TRADE_TYPES.find((t) => t.value === v)?.label || v;

export const QUOTE_STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "submitted", label: "Submitted" },
  { value: "accepted", label: "Accepted" },
  { value: "rejected", label: "Rejected" },
  { value: "expired", label: "Expired" },
];

export const QUOTE_STATUS_STYLES = {
  pending: "bg-sky-500/15 text-sky-400 border-sky-500/40",
  submitted: "bg-violet-500/15 text-violet-400 border-violet-500/40",
  accepted: "bg-emerald-600/20 text-emerald-400 border-emerald-600/40",
  rejected: "bg-red-500/15 text-red-400 border-red-500/40",
  expired: "bg-slate-500/15 text-slate-400 border-slate-500/40",
};

export const RFQ_STATUS_STYLES = {
  sent: "bg-sky-500/15 text-sky-400 border-sky-500/40",
  submitted: "bg-emerald-600/20 text-emerald-400 border-emerald-600/40",
  closed: "bg-slate-500/15 text-slate-400 border-slate-500/40",
};

export const INVOICE_STATUS_STYLES = {
  unpaid: "bg-sky-500/15 text-sky-400 border-sky-500/40",
  "part-paid": "bg-amber-500/15 text-amber-400 border-amber-500/40",
  paid: "bg-emerald-600/20 text-emerald-400 border-emerald-600/40",
};

export const CLAIM_STATUSES = [
  { value: "not-claimed", label: "Not Claimed" },
  { value: "claimed", label: "Claimed" },
  { value: "paid", label: "Paid" },
];

export const CLAIM_STATUS_STYLES = {
  "not-claimed": "bg-slate-500/15 text-slate-400 border-slate-500/40",
  claimed: "bg-amber-500/15 text-amber-400 border-amber-500/40",
  paid: "bg-emerald-600/20 text-emerald-400 border-emerald-600/40",
};

export const autoGst = (ex) => Math.round((parseFloat(ex) || 0) * 10) / 100;
