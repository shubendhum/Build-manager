import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, Eye, AlertTriangle, CheckCircle2 } from "lucide-react";
import { stageLabel, CONFIDENCE_STYLES } from "@/lib/stages";

export const AnalysisResult = ({ result }) => {
  const { analysis } = result;
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      data-testid="analysis-result-card"
      className="rounded-md border border-slate-700 bg-card"
    >
      <div className="px-6 py-4 border-b border-slate-700 flex flex-wrap items-center gap-3">
        <Badge data-testid="result-stage-badge" className="bg-amber-500 text-slate-950 hover:bg-amber-500 font-heading font-bold uppercase tracking-wider text-xs px-3 py-1">
          {stageLabel(analysis.identified_stage)}
        </Badge>
        <Badge data-testid="result-confidence-badge" variant="outline" className={`uppercase tracking-wider text-[10px] ${CONFIDENCE_STYLES[analysis.confidence] || CONFIDENCE_STYLES.medium}`}>
          {analysis.confidence} confidence
        </Badge>
        <span className="ml-auto text-xs text-slate-500">{new Date(result.created_at).toLocaleString()}</span>
      </div>

      <div className="p-6 space-y-6">
        <section>
          <h3 className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-amber-400 font-semibold mb-2">
            <ClipboardList className="h-4 w-4" aria-hidden="true" /> Site Diary Notes
          </h3>
          <p data-testid="result-progress-notes" className="text-sm leading-relaxed text-slate-200">{analysis.progress_notes}</p>
        </section>

        <section>
          <h3 className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-400 font-semibold mb-2">
            <Eye className="h-4 w-4" aria-hidden="true" /> Observations
          </h3>
          <ul data-testid="result-observations-list" className="space-y-1.5">
            {analysis.observations.map((obs, i) => (
              <li key={i} className="text-sm text-slate-300 flex gap-2">
                <span className="text-amber-500 shrink-0 mt-0.5">▸</span>{obs}
              </li>
            ))}
            {analysis.observations.length === 0 && <li className="text-sm text-slate-500">No notable observations recorded.</li>}
          </ul>
        </section>

        <section>
          <h3 className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-red-400 font-semibold mb-2">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Potential Issues
          </h3>
          {analysis.potential_issues.length > 0 ? (
            <ul data-testid="result-issues-list" className="space-y-2">
              {analysis.potential_issues.map((issue, i) => (
                <li key={i} className="text-sm text-red-200 flex gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2">
                  <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" aria-hidden="true" />{issue}
                </li>
              ))}
            </ul>
          ) : (
            <p data-testid="result-no-issues" className="text-sm text-emerald-400 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> No visible defects or safety concerns identified.
            </p>
          )}
        </section>
      </div>
    </motion.div>
  );
};
