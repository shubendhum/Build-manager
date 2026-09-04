import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  FileUp, X, Loader2, Sparkles, DraftingCompass, Home, Layers, BedDouble, Bath, Car, Ruler,
  Wrench, ListChecks, RefreshCw, CheckCircle2, ArrowRight, AlertCircle, Pencil, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import api, { formatApiErrorDetail } from "@/lib/api";
import { ROADMAP_STAGES, roadmapStageLabel, formatMoney, formatDateTime } from "@/lib/projectUtils";
import { tradeTypeLabel } from "@/lib/tradeUtils";

const MAX_BYTES = 30 * 1024 * 1024;
const ACCEPTED = ["application/pdf", "image/jpeg", "image/png"];

const DRAFT_STEPS = [
  "Feeding the scope and your rate guide to the AI…",
  "Drafting stage-by-stage tasks…",
  "Pricing estimate lines from the rate guide…",
  "Validating stages, quantities and rates…",
];

const useStagedProgress = (active, steps) => {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!active) { setIdx(0); return; }
    const t = setInterval(() => setIdx((i) => Math.min(i + 1, steps.length - 1)), 15000);
    return () => clearInterval(t);
  }, [active, steps.length]);
  return steps[idx];
};


const EditableField = ({ label, value, onChange, type, placeholder }) => {
  const [editing, setEditing] = useState(false);
  return (
    <div className="rounded-md border border-slate-700/70 bg-slate-800/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-0.5 flex items-center justify-between">
        <span>{label}</span>
        <button type="button" onClick={() => setEditing(!editing)}
          className="text-slate-500 hover:text-amber-400 transition-colors" title="Edit">
          {editing ? <Check className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
        </button>
      </p>
      {editing ? (
        <Input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder} autoFocus
          className="w-full h-7 text-sm bg-slate-900/50 border-slate-600 mt-1" />
      ) : (
        <p className="text-sm text-slate-200">{value ?? "—"}</p>
      )}
    </div>
  );
};

const EditableList = ({ label, items, onChange, colorClass }) => {
  const [editing, setEditing] = useState(false);
  const [newItem, setNewItem] = useState("");
  const add = () => { const v = newItem.trim(); if (v) { onChange([...(items || []), v]); setNewItem(""); } };
  const remove = (i) => { onChange((items || []).filter((_, idx) => idx !== i)); };
  return (
    <div>
      <p className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-semibold">{label}</span>
        <button type="button" onClick={() => setEditing(!editing)}
          className="text-slate-500 hover:text-amber-400 transition-colors" title="Edit">
          {editing ? <Check className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
        </button>
      </p>
      <ul className="space-y-1 mt-1">
        {(items || []).map((f, i) => (
          <li key={i} className="text-sm text-slate-300 flex items-center gap-2">
            <span className={`${colorClass} shrink-0 mt-0.5`}>▸</span>
            <span className="flex-1">{f}</span>
            {editing && (
              <button type="button" onClick={() => remove(i)} className="text-slate-500 hover:text-red-400 shrink-0">
                <X className="h-3 w-3" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {editing && (
        <div className="flex gap-2 mt-2">
          <Input value={newItem} onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Add item…"
            className="h-7 text-sm bg-slate-900/50 border-slate-600" />
          <Button size="sm" onClick={add} className="h-7 bg-slate-700 hover:bg-slate-600 text-slate-200 px-3">
            Add
          </Button>
        </div>
      )}
    </div>
  );
};

const EditableSummary = ({ value, onChange }) => {
  const [editing, setEditing] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-semibold">Summary</span>
        <button type="button" onClick={() => setEditing(!editing)}
          className="text-slate-500 hover:text-amber-400 transition-colors" title="Edit">
          {editing ? <Check className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
        </button>
      </div>
      {editing ? (
        <Textarea value={value ?? ""} onChange={(e) => onChange(e.target.value)}
          autoFocus rows={4}
          className="w-full text-sm bg-slate-900/50 border-slate-600 resize-none" />
      ) : (
        <p className="text-sm text-slate-300 leading-relaxed">{value || "—"}</p>
      )}
    </div>
  );
};

const ScopeCard = ({ plan, onSaved }) => {
  const [scope, setScope] = useState(plan.scope || {});
  const [saving, setSaving] = useState(false);

  // Reset when plan changes
  useEffect(() => { setScope(plan.scope || {}); }, [plan.scope]);

  const save = async () => {
    setSaving(true);
    try {
      // Convert numeric fields back
      const payload = {
        dwelling_type: scope.dwelling_type || null,
        storeys: scope.storeys ? Number(scope.storeys) : null,
        bedrooms: scope.bedrooms ? Number(scope.bedrooms) : null,
        bathrooms: scope.bathrooms ? Number(scope.bathrooms) : null,
        garage_spaces: scope.garage_spaces ? Number(scope.garage_spaces) : null,
        approx_floor_area_m2: scope.approx_floor_area_m2 ? Number(scope.approx_floor_area_m2) : null,
        construction_type: scope.construction_type || null,
        roof_type: scope.roof_type || null,
        notable_features: scope.notable_features || [],
        site_considerations: scope.site_considerations || [],
        summary: scope.summary || "",
      };
      await api.put(`/plans/${plan.id}/scope`, payload);
      toast.success("Scope updated successfully.");
      if (onSaved) onSaved();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Could not save the scope.");
    } finally {
      setSaving(false);
    }
  };

  const set = (k, v) => setScope((s) => ({ ...s, [k]: v }));
  const setList = (k, v) => setScope((s) => ({ ...s, [k]: v }));

  return (
    <section className="rounded-md border border-slate-700 bg-card p-5 mb-6" data-testid="plan-scope-card">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <DraftingCompass className="h-5 w-5 text-amber-400" aria-hidden="true" />
        <h3 className="font-heading text-lg font-bold uppercase tracking-wider text-slate-100">Scope read from the drawings</h3>
        <span className="text-xs text-slate-500">{plan.filename} · {plan.page_count} sheet{plan.page_count === 1 ? "" : "s"} · {formatDateTime(plan.created_at)}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <EditableField label="Dwelling" value={scope.dwelling_type} onChange={(v) => set("dwelling_type", v)} placeholder="e.g. single dwelling" />
        <EditableField label="Storeys" value={scope.storeys ?? ""} type="number" onChange={(v) => set("storeys", v)} placeholder="1" />
        <EditableField label="Bedrooms" value={scope.bedrooms ?? ""} type="number" onChange={(v) => set("bedrooms", v)} placeholder="3" />
        <EditableField label="Bathrooms" value={scope.bathrooms ?? ""} type="number" onChange={(v) => set("bathrooms", v)} placeholder="2" />
        <EditableField label="Garage" value={scope.garage_spaces ?? ""} type="number" onChange={(v) => set("garage_spaces", v)} placeholder="2" />
        <EditableField label="Floor area (m²)" value={scope.approx_floor_area_m2 ?? ""} type="number" onChange={(v) => set("approx_floor_area_m2", v)} placeholder="150" />
        <EditableField label="Construction" value={scope.construction_type} onChange={(v) => set("construction_type", v)} placeholder="slab + timber frame" />
        <EditableField label="Roof" value={scope.roof_type} onChange={(v) => set("roof_type", v)} placeholder="Colorbond metal" />
      </div>
      <div className="mb-4">
        <EditableSummary value={scope.summary} onChange={(v) => set("summary", v)} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <EditableList label="Notable features" items={scope.notable_features} onChange={(v) => setList("notable_features", v)} colorClass="text-amber-500" />
        <EditableList label="Site considerations" items={scope.site_considerations} onChange={(v) => setList("site_considerations", v)} colorClass="text-sky-400" />
      </div>
      <div className="flex justify-end">
        <Button data-testid="scope-save-button" onClick={save} disabled={saving}
          className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200 text-xs px-4 py-1.5">
          {saving ? (<><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Saving…</>) : (<><Check className="h-3.5 w-3.5" aria-hidden="true" /> Save Changes</>)}
        </Button>
      </div>
    </section>
  );
};

const DraftReview = ({ plan, draft, onApplied }) => {
  const [taskInc, setTaskInc] = useState({});
  const [tradeInc, setTradeInc] = useState({});
  const [pkgInc, setPkgInc] = useState({});
  const [lines, setLines] = useState([]);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    setTaskInc(Object.fromEntries(draft.tasks.map((_, i) => [i, true])));
    setTradeInc(Object.fromEntries(draft.trade_types.map((t) => [t, true])));
    setPkgInc(Object.fromEntries((draft.packages || []).map((p) => [p.title, true])));
    setLines(draft.estimate_lines.map((l) => ({ ...l, include: true, qtyStr: String(l.quantity), rateStr: String(l.rate) })));
  }, [draft]);

  const setLine = (i, k, v) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));

  const includedLines = lines.filter((l) => l.include);
  const subtotal = includedLines.reduce((s, l) => s + (parseFloat(l.qtyStr) || 0) * (parseFloat(l.rateStr) || 0), 0);
  const gst = subtotal * 0.1;
  const taskCount = Object.values(taskInc).filter(Boolean).length;
  const packages = draft.packages || [];
  const includedPackages = packages.filter((p) => pkgInc[p.title]);
  const tradeCount = Object.values(tradeInc).filter(Boolean).length;

  const tasksByStage = ROADMAP_STAGES
    .map((s) => ({
      stage: s,
      tasks: draft.tasks.map((t, i) => ({ ...t, idx: i })).filter((t) => t.stage_key === s.value),
    }))
    .filter((g) => g.tasks.length > 0);

  const apply = async () => {
    setApplying(true);
    try {
      const payload = {
        draft_id: draft.id,
        tasks: draft.tasks.filter((_, i) => taskInc[i]).map((t) => ({ stage_key: t.stage_key, name: t.name, description: t.description })),
        trade_types: draft.trade_types.filter((t) => tradeInc[t]),
        packages: includedPackages.map((p) => ({
          title: p.title, trade_type: p.trade_type, stage_key: p.stage_key, scope: p.scope,
        })),
        estimate_lines: includedLines.map((l) => ({
          description: l.description,
          stage_key: l.stage_key,
          // Only keep the link if that package is actually being created.
          package_title: pkgInc[l.package_title] ? l.package_title : null,
          quantity: parseFloat(l.qtyStr) || 0,
          unit: l.unit,
          rate: parseFloat(l.rateStr) || 0,
          rate_item_id: l.rate_item_id,
          ai_suggested: l.ai_suggested,
        })),
      };
      const { data } = await api.post(`/plans/${plan.id}/apply`, payload, { timeout: 60000 });
      toast.success(
        `Applied — ${data.packages_created || 0} trade package(s), ${data.tasks_created} task(s) ` +
        `and ${data.estimate_lines_created} estimate line(s) added.`);
      onApplied();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Could not apply the build plan.");
    } finally {
      setApplying(false);
    }
  };

  return (
    <section className="rounded-md border border-slate-700 bg-card p-5" data-testid="plan-draft-review">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <ListChecks className="h-5 w-5 text-amber-400" aria-hidden="true" />
        <h3 className="font-heading text-lg font-bold uppercase tracking-wider text-slate-100">Review the draft build plan</h3>
      </div>
      <p className="text-xs text-slate-500 mb-5">Untick anything you don't want, adjust quantities and rates, then apply to the job in one go.</p>

      {/* Tasks by stage */}
      <h4 className="text-xs uppercase tracking-[0.2em] text-slate-400 font-semibold mb-3">Tasks ({taskCount} selected)</h4>
      <div className="space-y-4 mb-6">
        {tasksByStage.map((g) => (
          <div key={g.stage.value} data-testid={`draft-stage-${g.stage.value}`}>
            <div className="flex items-center gap-2 mb-2">
              <h5 className="text-xs uppercase tracking-[0.2em] text-amber-400 font-semibold">{g.stage.label}</h5>
              <div className="flex-1 h-px bg-slate-800" />
            </div>
            <div className="space-y-1.5">
              {g.tasks.map((t) => (
                <label key={t.idx} className="flex items-start gap-2.5 rounded-md border border-slate-700/60 bg-slate-800/30 px-3 py-2 cursor-pointer hover:bg-slate-800/60 transition-colors duration-150">
                  <Checkbox data-testid={`draft-task-check-${t.idx}`} checked={!!taskInc[t.idx]}
                    onCheckedChange={(v) => setTaskInc((m) => ({ ...m, [t.idx]: !!v }))} className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-sm text-slate-200">{t.name}</span>
                    {t.description && <span className="block text-xs text-slate-500">{t.description}</span>}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Trade packages — these become the rows on the Work board */}
      {packages.length > 0 && (
        <>
          <h4 className="text-xs uppercase tracking-[0.2em] text-slate-400 font-semibold mb-1">
            Trade packages ({includedPackages.length} selected)
          </h4>
          <p className="text-xs text-slate-500 mb-3">
            Each becomes a row on the Work board that you can send out for quotes. The scope text is what
            the tradie receives.
          </p>
          <div className="space-y-2 mb-6" data-testid="draft-packages">
            {packages.map((p) => (
              <label key={p.title} data-testid={`draft-package-${p.title.replace(/\s+/g, "-").toLowerCase()}`}
                className={`flex items-start gap-3 rounded-md border px-3 py-2.5 cursor-pointer transition-colors duration-150 ${
                  pkgInc[p.title] ? "border-amber-500/50 bg-amber-500/5" : "border-slate-700 bg-slate-800/40"
                }`}>
                <Checkbox className="mt-0.5" checked={!!pkgInc[p.title]}
                  onCheckedChange={(v) => setPkgInc((m) => ({ ...m, [p.title]: !!v }))} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-100">{p.title}</span>
                    <span className="text-[10px] uppercase tracking-wider text-amber-400">{tradeTypeLabel(p.trade_type)}</span>
                    <span className="text-[10px] uppercase tracking-wider text-slate-500">{roadmapStageLabel(p.stage_key)}</span>
                  </span>
                  {p.scope && <span className="block text-xs text-slate-400 mt-1 line-clamp-3">{p.scope}</span>}
                </span>
              </label>
            ))}
          </div>
        </>
      )}

      {/* Trades checklist */}
      {draft.trade_types.length > 0 && (
        <>
          <h4 className="text-xs uppercase tracking-[0.2em] text-slate-400 font-semibold mb-3">Required trades ({tradeCount} selected)</h4>
          <div className="flex flex-wrap gap-2 mb-6" data-testid="draft-trades">
            {draft.trade_types.map((t) => (
              <label key={t} className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 cursor-pointer transition-colors duration-150 ${tradeInc[t] ? "border-amber-500/50 bg-amber-500/10 text-amber-300" : "border-slate-700 bg-slate-800/40 text-slate-400"}`}>
                <Checkbox data-testid={`draft-trade-check-${t}`} checked={!!tradeInc[t]}
                  onCheckedChange={(v) => setTradeInc((m) => ({ ...m, [t]: !!v }))} />
                <span className="text-xs font-medium">{tradeTypeLabel(t)}</span>
              </label>
            ))}
          </div>
        </>
      )}

      {/* Estimate lines */}
      <h4 className="text-xs uppercase tracking-[0.2em] text-slate-400 font-semibold mb-3">Estimate lines ({includedLines.length} selected)</h4>
      <div className="rounded-md border border-slate-700 overflow-x-auto mb-4">
        <table className="w-full text-sm" data-testid="draft-lines-table">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-800/40 text-[10px] uppercase tracking-[0.2em] text-slate-500">
              <th className="px-3 py-2.5" />
              <th className="text-left px-3 py-2.5 font-medium">Description</th>
              <th className="text-left px-3 py-2.5 font-medium">Stage</th>
              <th className="text-right px-3 py-2.5 font-medium">Qty</th>
              <th className="text-left px-3 py-2.5 font-medium">Unit</th>
              <th className="text-right px-3 py-2.5 font-medium">Rate</th>
              <th className="text-left px-3 py-2.5 font-medium">Rate source</th>
              <th className="text-right px-3 py-2.5 font-medium">Total ex GST</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {lines.map((l, i) => (
              <tr key={i} className={l.include ? "" : "opacity-40"} data-testid={`draft-line-${i}`}>
                <td className="px-3 py-2">
                  <Checkbox data-testid={`draft-line-check-${i}`} checked={l.include}
                    onCheckedChange={(v) => setLine(i, "include", !!v)} />
                </td>
                <td className="px-3 py-2 text-slate-200 min-w-[220px]">{l.description}</td>
                <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{roadmapStageLabel(l.stage_key)}</td>
                <td className="px-3 py-2 text-right">
                  <Input data-testid={`draft-line-qty-${i}`} type="number" min="0" step="0.01" value={l.qtyStr}
                    onChange={(e) => setLine(i, "qtyStr", e.target.value)} disabled={!l.include}
                    className="w-20 h-8 text-right bg-slate-800/50 border-slate-600 ml-auto" />
                </td>
                <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{l.unit || "—"}</td>
                <td className="px-3 py-2 text-right">
                  <Input data-testid={`draft-line-rate-${i}`} type="number" min="0" step="0.01" value={l.rateStr}
                    onChange={(e) => setLine(i, "rateStr", e.target.value)} disabled={!l.include}
                    className="w-24 h-8 text-right bg-slate-800/50 border-slate-600 ml-auto" />
                </td>
                <td className="px-3 py-2">
                  {l.ai_suggested ? (
                    <Badge variant="outline" className="bg-violet-500/15 text-violet-400 border-violet-500/40 uppercase tracking-wider text-[10px]">AI suggested</Badge>
                  ) : (
                    <Badge variant="outline" className="bg-emerald-600/20 text-emerald-400 border-emerald-600/40 uppercase tracking-wider text-[10px]">Rate guide</Badge>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-slate-200 whitespace-nowrap">
                  {formatMoney((parseFloat(l.qtyStr) || 0) * (parseFloat(l.rateStr) || 0))}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-700 bg-slate-800/40">
              <td colSpan={7} className="px-3 py-2 text-right text-xs uppercase tracking-wider text-slate-400">Subtotal ex GST</td>
              <td className="px-3 py-2 text-right font-medium text-slate-200" data-testid="draft-subtotal">{formatMoney(subtotal)}</td>
            </tr>
            <tr className="bg-slate-800/40">
              <td colSpan={7} className="px-3 py-1 text-right text-xs uppercase tracking-wider text-slate-400">GST (10%)</td>
              <td className="px-3 py-1 text-right text-slate-300">{formatMoney(gst)}</td>
            </tr>
            <tr className="bg-slate-800/40">
              <td colSpan={7} className="px-3 py-2 text-right text-xs uppercase tracking-wider text-amber-400 font-semibold">Total inc GST</td>
              <td className="px-3 py-2 text-right font-heading font-bold text-amber-400" data-testid="draft-total">{formatMoney(subtotal + gst)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex justify-end">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button data-testid="apply-draft-button" disabled={applying || (taskCount === 0 && includedLines.length === 0)}
              className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
              {applying ? (<><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Applying…</>) : (<><CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Apply to Project</>)}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="bg-card border-slate-700">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-slate-100">Apply this build plan?</AlertDialogTitle>
              <AlertDialogDescription className="text-slate-400">
                {taskCount} task(s) will be added to the roadmap and {includedLines.length} line(s) totalling{" "}
                {formatMoney(subtotal + gst)} inc GST will be added to the estimate. You can edit or delete
                everything afterwards. A draft can only be applied once.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="bg-slate-800 border-slate-600 text-slate-200 hover:bg-slate-700 hover:text-slate-100">Cancel</AlertDialogCancel>
              <AlertDialogAction data-testid="apply-draft-confirm" onClick={apply}
                className="bg-amber-500 text-slate-950 hover:bg-amber-400 font-heading font-bold uppercase tracking-wider">
                Apply
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </section>
  );
};

export const PlannerTab = ({ project, onChanged }) => {
  const [plans, setPlans] = useState(null);
  const [drawings, setDrawings] = useState([]);
  const [docId, setDocId] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [jobStatus, setJobStatus] = useState(null);      // {id, status, step, error}
  const draftMsg = useStagedProgress(drafting, DRAFT_STEPS);
  const pollRef = useRef(null);

  const fetchPlans = useCallback(async () => {
    const { data } = await api.get(`/projects/${project.id}/plans`);
    setPlans(data);
    // If a plan is still processing, start polling it
    const firstPlan = data[0];
    if (firstPlan && firstPlan.job_status && ["pending", "processing"].includes(firstPlan.job_status)) {
      setAnalyzing(true);
      setJobStatus({ id: firstPlan.id, status: firstPlan.job_status, step: firstPlan.job_step, error: firstPlan.job_error });
      startPolling(firstPlan.id);
    }
  }, [project.id]);

  // The drawings already filed on this job are what the planner reads.
  const fetchDrawings = useCallback(async () => {
    const { data } = await api.get(`/projects/${project.id}/documents`, { params: { category: "drawings" } });
    setDrawings(data);
    setDocId((cur) => cur || data[0]?.id || "");
  }, [project.id]);

  useEffect(() => { fetchPlans(); fetchDrawings(); }, [fetchPlans, fetchDrawings]);

  // Stop polling on unmount
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const startPolling = (planId) => {
    if (pollRef.current) clearInterval(pollRef.current);
    const poll = async () => {
      try {
        const { data } = await api.get(`/plans/${planId}`);
        setJobStatus({ id: data.id, status: data.job_status, step: data.job_step, error: data.job_error });
        if (data.job_status === "analyzed") {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setAnalyzing(false);
          toast.success("Drawings analysed — scope extracted below.");
          fetchPlans();
        } else if (data.job_status === "failed") {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setAnalyzing(false);
          toast.error(data.job_error || "AI analysis failed — please try again.", { duration: 10000 });
        }
      } catch (e) {
        // keep polling on transient errors
      }
    };
    poll(); // immediate first check
    pollRef.current = setInterval(poll, 30000); // poll every 30s
  };

  const analyze = async () => {
    if (!docId) return;
    setAnalyzing(true);
    setJobStatus({ id: null, status: "pending", step: "Reading the drawing…", error: null });
    try {
      const fd = new FormData();
      fd.append("document_id", docId);
      const { data } = await api.post(`/projects/${project.id}/plans/analyze`, fd, { timeout: 60000 });
      // Immediate response: {id, job_status: "pending", page_count}
      setJobStatus({ id: data.id, status: "pending", step: "Queued for analysis…", error: null });
      toast.info("Reading the drawing — analysis is running in the background.");
      startPolling(data.id);
    } catch (e) {
      setAnalyzing(false);
      setJobStatus(null);
      toast.error(
        (formatApiErrorDetail(e.response?.data?.detail) || "Could not read that drawing — please try again."),
        { duration: 10000 },
      );
    }
  };

  const generateDraft = async (plan) => {
    setDrafting(true);
    try {
      await api.post(`/plans/${plan.id}/generate-draft`, {}, { timeout: 600000 });
      toast.success("Build plan draft generated — review it below.");
      fetchPlans();
    } catch (e) {
      toast.error(
        (formatApiErrorDetail(e.response?.data?.detail) || "Draft generation failed — please try again."),
        { duration: 10000 },
      );
    } finally {
      setDrafting(false);
    }
  };

  if (!plans) return <p className="text-sm text-slate-400">Loading AI planner…</p>;

  const plan = plans[0] || null;
  const draft = plan?.draft || null;

  return (
    <div data-testid="planner-tab">
      {/* Upload / analyze */}
      <section className="rounded-md border border-slate-700 bg-card p-5 mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="h-5 w-5 text-amber-400" aria-hidden="true" />
          <h3 className="font-heading text-lg font-bold uppercase tracking-wider text-slate-100">Read the drawings</h3>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Pick a drawing from the ones filed on this job and the AI will extract the scope, then draft tasks,
          trades and a priced estimate from your rate guide — all reviewable before anything touches the job.
        </p>
        {drawings.length === 0 ? (
          <p className="text-sm text-slate-400" data-testid="planner-no-drawings">
            No drawings on this job yet. Use Upload in the header — or drop a file anywhere on the page — and
            file it under Drawings.
          </p>
        ) : (
          <Select value={docId} onValueChange={setDocId}>
            <SelectTrigger data-testid="plan-document-select"
              className="w-full sm:w-96 bg-slate-800/50 border-slate-600 text-slate-200">
              <SelectValue placeholder="Choose a drawing to read" />
            </SelectTrigger>
            <SelectContent className="bg-card border-slate-700 max-h-64">
              {drawings.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.title || d.filename}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <Button data-testid="plan-analyze-button" onClick={analyze} disabled={!docId || analyzing}
            className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
            {analyzing ? (<><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Analysing…</>) : (<><Sparkles className="h-4 w-4" aria-hidden="true" /> Analyse Drawings</>)}
          </Button>
          {analyzing && jobStatus && (
            <div className="flex flex-col gap-2 min-w-[260px]" data-testid="plan-analyze-progress">
              <div className="flex items-center gap-2">
                {jobStatus.status === "pending" && <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" aria-hidden="true" />}
                {jobStatus.status === "processing" && <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" aria-hidden="true" />}
                <p className="text-xs text-slate-300">{jobStatus.step}</p>
              </div>
              {(jobStatus.status === "pending" || jobStatus.status === "processing") && (
                <p className="text-[10px] text-slate-500">Polling every 30 s — results appear automatically when ready.</p>
              )}
            </div>
          )}
        </div>
      </section>

      {!plan && !analyzing && (
        <div className="rounded-md border border-dashed border-slate-700 bg-slate-800/20 p-10 text-center" data-testid="planner-empty">
          <DraftingCompass className="h-8 w-8 text-slate-600 mx-auto mb-3" aria-hidden="true" />
          <p className="text-sm text-slate-400 mb-1">No drawings analysed yet.</p>
          <p className="text-xs text-slate-500">Pick one of your filed drawings above — the planner reads floor plans, elevations and site plans.</p>
        </div>
      )}

      {plan && (
        <>
          <ScopeCard plan={plan} />

          {/* Draft stage */}
          {!draft && (
            <div className="rounded-md border border-slate-700 bg-card p-5 text-center" data-testid="plan-generate-section">
              <p className="text-sm text-slate-300 mb-1">Scope looks right?</p>
              <p className="text-xs text-slate-500 mb-4">Next the AI drafts stage-by-stage tasks, the trade list and a priced preliminary estimate using your rate guide.</p>
              <Button data-testid="generate-draft-button" onClick={() => generateDraft(plan)} disabled={drafting}
                className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
                {drafting ? (<><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Generating…</>) : (<><ListChecks className="h-4 w-4" aria-hidden="true" /> Generate Build Plan</>)}
              </Button>
              {drafting && <p className="text-xs text-slate-400 mt-3" data-testid="plan-draft-progress">{draftMsg}</p>}
            </div>
          )}

          {draft && draft.status === "draft" && (
            <>
              <div className="flex justify-end mb-3">
                <Button data-testid="regenerate-draft-button" variant="outline" size="sm" onClick={() => generateDraft(plan)} disabled={drafting}
                  className="border-slate-600 text-slate-300 hover:text-amber-400 hover:border-amber-500/50">
                  {drafting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />} Regenerate draft
                </Button>
              </div>
              {drafting
                ? <p className="text-xs text-slate-400 mb-3" data-testid="plan-draft-progress">{draftMsg}</p>
                : <DraftReview plan={plan} draft={draft} onApplied={() => { fetchPlans(); onChanged?.(); }} />}
            </>
          )}

          {draft && draft.status === "applied" && (
            <div className="rounded-md border border-emerald-600/50 bg-card p-6" data-testid="plan-applied">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" aria-hidden="true" />
                <h3 className="font-heading text-lg font-bold uppercase tracking-wider text-slate-100">Build plan applied</h3>
              </div>
              <p className="text-sm text-slate-400 mb-4">
                Tasks were added to the roadmap and lines to the estimate on {formatDateTime(draft.applied_at)}.
                Fine-tune them in the Roadmap and Budget tabs.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button data-testid="applied-goto-roadmap" variant="outline" size="sm" asChild
                  className="border-slate-600 text-slate-300 hover:text-amber-400 hover:border-amber-500/50">
                  <Link to={`/projects/${project.id}?tab=money`}>Payment stages <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
                </Button>
                <Button data-testid="applied-goto-budget" variant="outline" size="sm" asChild
                  className="border-slate-600 text-slate-300 hover:text-amber-400 hover:border-amber-500/50">
                  <Link to={`/projects/${project.id}?tab=money`}>Money <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
                </Button>
                <Button data-testid="applied-regenerate" variant="outline" size="sm" onClick={() => generateDraft(plan)} disabled={drafting}
                  className="border-slate-600 text-slate-300 hover:text-amber-400 hover:border-amber-500/50">
                  {drafting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />} Generate a fresh draft
                </Button>
              </div>
            </div>
          )}

          {plans.length > 1 && (
            <div className="mt-6">
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-2">Previous analyses</p>
              <ul className="space-y-1">
                {plans.slice(1).map((p) => (
                  <li key={p.id} className="text-xs text-slate-500">
                    {p.filename} · {p.page_count} sheet{p.page_count === 1 ? "" : "s"} · {formatDateTime(p.created_at)} · {p.status}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
};
