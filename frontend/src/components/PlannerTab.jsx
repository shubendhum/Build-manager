import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  FileUp, X, Loader2, Sparkles, DraftingCompass, Home, Layers, BedDouble, Bath, Car, Ruler,
  Wrench, ListChecks, RefreshCw, CheckCircle2, ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import api, { formatApiErrorDetail } from "@/lib/api";
import { ROADMAP_STAGES, roadmapStageLabel, formatMoney, formatDateTime } from "@/lib/projectUtils";
import { tradeTypeLabel } from "@/lib/tradeUtils";

const MAX_BYTES = 30 * 1024 * 1024;
const ACCEPTED = ["application/pdf", "image/jpeg", "image/png"];

const ANALYZE_STEPS = [
  "Uploading drawing…",
  "Rendering drawing sheets…",
  "AI is reading each sheet — rooms, dimensions, materials…",
  "Cross-checking sheets against each other…",
  "Aggregating the project scope…",
];
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

const PlanUploadZone = ({ file, onFileSelected, onClear, disabled }) => {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = (f) => {
    if (!f) return;
    if (!ACCEPTED.includes(f.type)) {
      toast.error("Unsupported file. Upload the drawings as PDF, JPEG or PNG.");
      return;
    }
    if (f.size > MAX_BYTES) {
      toast.error("Drawing too large. Maximum size is 30 MB.");
      return;
    }
    onFileSelected(f);
  };

  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-slate-700 bg-slate-800/50 px-4 py-3" data-testid="plan-file-selected">
        <DraftingCompass className="h-5 w-5 text-amber-400 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-slate-200 truncate">{file.name}</p>
          <p className="text-xs text-slate-500">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
        </div>
        <button type="button" data-testid="plan-file-clear" onClick={onClear} disabled={disabled}
          className="shrink-0 inline-flex items-center gap-1 text-xs text-slate-300 hover:text-amber-400 transition-colors duration-200 disabled:opacity-50">
          <X className="h-3.5 w-3.5" aria-hidden="true" /> Remove
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="plan-upload-dropzone"
      role="button"
      tabIndex={0}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => e.key === "Enter" && !disabled && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); if (!disabled) handleFile(e.dataTransfer.files?.[0]); }}
      className={`cursor-pointer rounded-md border-2 border-dashed p-10 flex flex-col items-center justify-center gap-3 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-amber-500
        ${dragging ? "border-amber-500 bg-slate-800/60" : "border-slate-600 bg-slate-800/30 hover:border-amber-500 hover:bg-slate-800/50"}`}
    >
      <div className="h-12 w-12 rounded-md bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
        <FileUp className="h-6 w-6 text-amber-400" aria-hidden="true" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-slate-200">Drop the architectural drawings here</p>
        <p className="text-xs text-slate-400 mt-1">or click to browse — PDF (up to 8 sheets read), JPEG or PNG up to 30 MB</p>
      </div>
      <input ref={inputRef} data-testid="plan-file-input" type="file" accept="application/pdf,image/jpeg,image/png"
        className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
    </div>
  );
};

const ScopeFact = ({ icon: Icon, label, value }) => (
  <div className="rounded-md border border-slate-700/70 bg-slate-800/40 px-3 py-2">
    <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-0.5">
      <Icon className="h-3 w-3 text-amber-400" aria-hidden="true" /> {label}
    </p>
    <p className="text-sm text-slate-200">{value ?? "—"}</p>
  </div>
);

const ScopeCard = ({ plan }) => {
  const s = plan.scope || {};
  return (
    <section className="rounded-md border border-slate-700 bg-card p-5 mb-6" data-testid="plan-scope-card">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <DraftingCompass className="h-5 w-5 text-amber-400" aria-hidden="true" />
        <h3 className="font-heading text-lg font-bold uppercase tracking-wider text-slate-100">Extracted Scope</h3>
        <span className="text-xs text-slate-500">{plan.filename} · {plan.page_count} sheet{plan.page_count === 1 ? "" : "s"} · {formatDateTime(plan.created_at)}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <ScopeFact icon={Home} label="Dwelling" value={s.dwelling_type} />
        <ScopeFact icon={Layers} label="Storeys" value={s.storeys} />
        <ScopeFact icon={BedDouble} label="Bedrooms" value={s.bedrooms} />
        <ScopeFact icon={Bath} label="Bathrooms" value={s.bathrooms} />
        <ScopeFact icon={Car} label="Garage" value={s.garage_spaces} />
        <ScopeFact icon={Ruler} label="Floor area" value={s.approx_floor_area_m2 ? `≈ ${s.approx_floor_area_m2} m²` : null} />
        <ScopeFact icon={Wrench} label="Construction" value={s.construction_type} />
        <ScopeFact icon={Home} label="Roof" value={s.roof_type} />
      </div>
      {s.summary && <p className="text-sm text-slate-300 leading-relaxed mb-3" data-testid="plan-scope-summary">{s.summary}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {s.notable_features?.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-semibold mb-1">Notable features</p>
            <ul className="space-y-1">
              {s.notable_features.map((f, i) => (
                <li key={i} className="text-sm text-slate-300 flex gap-2"><span className="text-amber-500 shrink-0 mt-0.5">▸</span>{f}</li>
              ))}
            </ul>
          </div>
        )}
        {s.site_considerations?.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-semibold mb-1">Site considerations</p>
            <ul className="space-y-1">
              {s.site_considerations.map((f, i) => (
                <li key={i} className="text-sm text-slate-300 flex gap-2"><span className="text-sky-400 shrink-0 mt-0.5">▸</span>{f}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
};

const DraftReview = ({ plan, draft, onApplied }) => {
  const [taskInc, setTaskInc] = useState({});
  const [tradeInc, setTradeInc] = useState({});
  const [lines, setLines] = useState([]);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    setTaskInc(Object.fromEntries(draft.tasks.map((_, i) => [i, true])));
    setTradeInc(Object.fromEntries(draft.trade_types.map((t) => [t, true])));
    setLines(draft.estimate_lines.map((l) => ({ ...l, include: true, qtyStr: String(l.quantity), rateStr: String(l.rate) })));
  }, [draft]);

  const setLine = (i, k, v) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));

  const includedLines = lines.filter((l) => l.include);
  const subtotal = includedLines.reduce((s, l) => s + (parseFloat(l.qtyStr) || 0) * (parseFloat(l.rateStr) || 0), 0);
  const gst = subtotal * 0.1;
  const taskCount = Object.values(taskInc).filter(Boolean).length;
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
        estimate_lines: includedLines.map((l) => ({
          description: l.description,
          stage_key: l.stage_key,
          quantity: parseFloat(l.qtyStr) || 0,
          unit: l.unit,
          rate: parseFloat(l.rateStr) || 0,
          rate_item_id: l.rate_item_id,
          ai_suggested: l.ai_suggested,
        })),
      };
      const { data } = await api.post(`/plans/${plan.id}/apply`, payload, { timeout: 60000 });
      toast.success(`Applied — ${data.tasks_created} task(s) and ${data.estimate_lines_created} estimate line(s) added to the project.`);
      onApplied();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Failed to apply the build plan.");
    } finally {
      setApplying(false);
    }
  };

  return (
    <section className="rounded-md border border-slate-700 bg-card p-5" data-testid="plan-draft-review">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <ListChecks className="h-5 w-5 text-amber-400" aria-hidden="true" />
        <h3 className="font-heading text-lg font-bold uppercase tracking-wider text-slate-100">Review Build Plan Draft</h3>
      </div>
      <p className="text-xs text-slate-500 mb-5">Untick anything you don't want, adjust quantities and rates, then apply to the project in one go.</p>

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
  const [file, setFile] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const analyzeMsg = useStagedProgress(analyzing, ANALYZE_STEPS);
  const draftMsg = useStagedProgress(drafting, DRAFT_STEPS);

  const fetchPlans = useCallback(async () => {
    const { data } = await api.get(`/projects/${project.id}/plans`);
    setPlans(data);
  }, [project.id]);

  useEffect(() => { fetchPlans(); }, [fetchPlans]);

  const analyze = async () => {
    if (!file) return;
    setAnalyzing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api.post(`/projects/${project.id}/plans/analyze`, fd, { timeout: 600000 });
      setFile(null);
      toast.success("Drawings analysed — scope extracted below.");
      fetchPlans();
    } catch (e) {
      toast.error(
        (formatApiErrorDetail(e.response?.data?.detail) || "AI analysis failed — check the vision model is running, then try again."),
        { duration: 10000 },
      );
    } finally {
      setAnalyzing(false);
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
          <h3 className="font-heading text-lg font-bold uppercase tracking-wider text-slate-100">AI Build Planner</h3>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          Upload the architectural drawings and the AI will extract the scope, then draft tasks, trades and a
          priced estimate from your rate guide — all reviewable before anything touches the project.
        </p>
        <PlanUploadZone file={file} onFileSelected={setFile} onClear={() => setFile(null)} disabled={analyzing} />
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <Button data-testid="plan-analyze-button" onClick={analyze} disabled={!file || analyzing}
            className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
            {analyzing ? (<><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Analysing…</>) : (<><Sparkles className="h-4 w-4" aria-hidden="true" /> Analyse Drawings</>)}
          </Button>
          {analyzing && (
            <p className="text-xs text-slate-400" data-testid="plan-analyze-progress">
              {analyzeMsg} <span className="text-slate-600">— large drawing sets can take 1–3 minutes.</span>
            </p>
          )}
        </div>
      </section>

      {!plan && !analyzing && (
        <div className="rounded-md border border-dashed border-slate-700 bg-slate-800/20 p-10 text-center" data-testid="planner-empty">
          <DraftingCompass className="h-8 w-8 text-slate-600 mx-auto mb-3" aria-hidden="true" />
          <p className="text-sm text-slate-400 mb-1">No drawings analysed yet.</p>
          <p className="text-xs text-slate-500">Upload the working drawings above — the AI planner reads floor plans, elevations and site plans.</p>
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
                <h3 className="font-heading text-lg font-bold uppercase tracking-wider text-slate-100">Build Plan Applied</h3>
              </div>
              <p className="text-sm text-slate-400 mb-4">
                Tasks were added to the roadmap and lines to the estimate on {formatDateTime(draft.applied_at)}.
                Fine-tune them in the Roadmap and Budget tabs.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button data-testid="applied-goto-roadmap" variant="outline" size="sm" asChild
                  className="border-slate-600 text-slate-300 hover:text-amber-400 hover:border-amber-500/50">
                  <Link to={`/projects/${project.id}?tab=roadmap`}>Roadmap <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
                </Button>
                <Button data-testid="applied-goto-budget" variant="outline" size="sm" asChild
                  className="border-slate-600 text-slate-300 hover:text-amber-400 hover:border-amber-500/50">
                  <Link to={`/projects/${project.id}?tab=budget`}>Budget &amp; Estimate <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
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
