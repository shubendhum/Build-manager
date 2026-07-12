import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, History } from "lucide-react";
import { stageLabel, CONFIDENCE_STYLES } from "@/lib/stages";
import { formatDateTime } from "@/lib/projectUtils";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

export const HistoryGrid = ({ history, loading }) => {
  return (
    <section className="mt-16" data-testid="history-section">
      <div className="flex items-center gap-3 mb-6">
        <History className="h-5 w-5 text-amber-400" aria-hidden="true" />
        <h2 className="font-heading text-lg font-bold uppercase tracking-wider text-slate-100">Analysis History</h2>
        <span className="text-xs text-slate-500" data-testid="history-count">{history.length} record{history.length === 1 ? "" : "s"}</span>
      </div>

      {loading && <p className="text-sm text-slate-400">Loading history…</p>}

      {!loading && history.length === 0 && (
        <div data-testid="history-empty" className="rounded-md border border-slate-700 bg-slate-800/30 p-10 text-center">
          <p className="text-sm text-slate-400">No analyses yet. Upload your first site photo above to start your build record.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 items-start">
        {history.map((item, idx) => (
          <motion.article
            key={item.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: Math.min(idx * 0.06, 0.4) }}
            data-testid={`history-card-${item.id}`}
            className="rounded-md border border-slate-700 bg-card overflow-hidden hover:-translate-y-1 transition-transform duration-200"
          >
            <img
              src={`${BACKEND_URL}${item.image_url}`}
              alt={`Site photo — ${stageLabel(item.analysis.identified_stage)}`}
              className="w-full h-40 object-cover border-b border-slate-700"
              loading="lazy"
            />
            <div className="p-5 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-amber-500/15 text-amber-400 border border-amber-500/40 hover:bg-amber-500/15 uppercase tracking-wider text-[10px]">
                  {stageLabel(item.analysis.identified_stage)}
                </Badge>
                <Badge variant="outline" className={`uppercase tracking-wider text-[10px] ${CONFIDENCE_STYLES[item.analysis.confidence] || CONFIDENCE_STYLES.medium}`}>
                  {item.analysis.confidence}
                </Badge>
                {item.analysis.potential_issues.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-red-400">
                    <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                    {item.analysis.potential_issues.length} issue{item.analysis.potential_issues.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-300 leading-relaxed line-clamp-3">{item.analysis.progress_notes}</p>
              <p className="text-xs text-slate-500">{formatDateTime(item.created_at)}</p>
            </div>
          </motion.article>
        ))}
      </div>
    </section>
  );
};
