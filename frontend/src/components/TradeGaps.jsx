import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { UserX, Plus, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import api, { formatApiErrorDetail } from "@/lib/api";

/**
 * Trade work the supervisor checklist expects that nobody is booked for.
 *
 * The checklist is where you confirm; this is where you act. Adding one puts a
 * package on the board, which is then what you send for quotes, award, book and
 * pay — so the two screens end up agreeing about what the job involves.
 */
export const TradeGaps = ({ projectId, onBooked }) => {
  const [gaps, setGaps] = useState(null);
  const [busy, setBusy] = useState(null);   // trade key, or "all"

  const fetchGaps = useCallback(async () => {
    try {
      const { data } = await api.get(`/projects/${projectId}/trade-gaps`);
      setGaps(data.unbooked);
    } catch {
      setGaps([]);   // advisory only — never block the board
    }
  }, [projectId]);

  useEffect(() => { fetchGaps(); }, [fetchGaps]);

  const book = async (keys, label) => {
    setBusy(label);
    try {
      const { data } = await api.post(`/projects/${projectId}/trade-gaps`, { keys });
      toast.success(data.count === 1
        ? `${data.created[0].title} added to the board`
        : `${data.count} trades added to the board`);
      await fetchGaps();
      onBooked?.();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Could not add that to the board.");
    } finally {
      setBusy(null);
    }
  };

  if (!gaps) return null;

  if (gaps.length === 0) {
    return (
      <p className="flex items-center gap-2 text-xs text-slate-500 mb-4" data-testid="trade-gaps-clear">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
        Every trade the checklist expects is on the board.
      </p>
    );
  }

  return (
    <section className="rounded-md border border-red-500/40 bg-red-500/[0.05] p-4 sm:p-5 mb-5"
      data-testid="trade-gaps">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-heading text-sm font-bold uppercase tracking-wider text-red-300">
            <UserX className="h-4 w-4 shrink-0" aria-hidden="true" />
            {gaps.length} trade{gaps.length === 1 ? "" : "s"} the checklist expects, nobody booked
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Adding one puts it on the board at the right step, so it can be priced and booked
            before it is needed.
          </p>
        </div>
        <Button size="sm" data-testid="book-all-trades" disabled={busy !== null}
          onClick={() => book([], "all")}
          className="shrink-0 bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
          {busy === "all"
            ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Adding…</>
            : <><Plus className="h-4 w-4" aria-hidden="true" /> Add all {gaps.length}</>}
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {gaps.map((g) => (
          <button key={g.key + g.phase_key} type="button" disabled={busy !== null}
            onClick={() => book([g.work], g.work)}
            data-testid={`book-trade-${g.key}`}
            title={`Phase ${g.phase_letter} — ${g.phase_name}`}
            className="inline-flex items-center gap-1.5 rounded border border-slate-600 bg-slate-800/50 px-2.5 py-1.5 text-xs text-slate-200 hover:border-amber-500/60 hover:text-amber-400 transition-colors duration-200 disabled:opacity-40">
            {busy === g.work
              ? <Loader2 className="h-3 w-3 animate-spin shrink-0" aria-hidden="true" />
              : <Plus className="h-3 w-3 shrink-0" aria-hidden="true" />}
            <span className="break-words">{g.work}</span>
            <span className="text-slate-500 shrink-0">{g.phase_letter}</span>
          </button>
        ))}
      </div>
    </section>
  );
};
