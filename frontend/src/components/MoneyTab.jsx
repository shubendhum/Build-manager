import { useState, useEffect, useCallback } from "react";
import { Progress } from "@/components/ui/progress";
import { EstimatorSection } from "@/components/EstimatorSection";
import { BudgetSection } from "@/components/BudgetSection";
import { InvoicesTab } from "@/components/InvoicesTab";
import { VariationsTab } from "@/components/VariationsTab";
import api from "@/lib/api";

/**
 * The progress payment schedule. This is the only place the payment-stage
 * percentage belongs — it says how much of the contract can be claimed, not how
 * far along the build is, and showing it in the job header next to the build
 * step had the job contradicting itself.
 */
const PaymentStages = ({ projectId }) => {
  const [roadmap, setRoadmap] = useState(null);

  const fetchRoadmap = useCallback(async () => {
    try {
      const { data } = await api.get(`/projects/${projectId}/roadmap`);
      setRoadmap(data);
    } catch {
      setRoadmap(null);
    }
  }, [projectId]);

  useEffect(() => { fetchRoadmap(); }, [fetchRoadmap]);
  if (!roadmap) return null;

  return (
    <section className="rounded-md border border-slate-700 bg-card p-5 mb-6" data-testid="payment-stages">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-1">
        <h3 className="font-heading text-lg font-bold uppercase tracking-wider text-slate-100">
          Progress payment stages
        </h3>
        <span className="font-heading text-lg font-bold text-amber-400 tabular-nums"
          data-testid="roadmap-overall-progress">
          {roadmap.overall_progress}%
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Weighted by the Victorian domestic building progress payment schedule — deposit 5%, base 10%,
        frame 15%, lock-up 35%, fixing 25%, completion 10%.
      </p>
      <div className="space-y-2.5">
        {roadmap.stages.map((stage) => (
          <div key={stage.key} className="flex flex-wrap items-center gap-3"
            data-testid={`payment-stage-${stage.key}`}>
            <span className="text-sm text-slate-200 min-w-0 flex-1 break-words">
              {stage.label}
              <span className="text-slate-500 text-xs ml-2">{stage.weight}%</span>
            </span>
            <span className="flex items-center gap-2.5 w-full sm:w-56 shrink-0">
              <Progress value={stage.progress ?? 0} className="h-2 bg-slate-700" />
              <span className="text-xs text-slate-400 tabular-nums w-9 text-right">
                {Math.round(stage.progress ?? 0)}%
              </span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
};

/**
 * Everything about money on one screen: what it was estimated at, what has been
 * committed, what has been claimed and invoiced, and what has changed since.
 * These were four separate tabs, two of which were usually empty.
 */
export const MoneyTab = ({ project }) => {
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  return (
    <div data-testid="money-tab">
      <EstimatorSection project={project} onChanged={bump} />
      <BudgetSection projectId={project.id} refreshKey={refreshKey} />
      <PaymentStages projectId={project.id} />
      <InvoicesTab projectId={project.id} contractValue={project.contract_value} />
      <VariationsTab projectId={project.id} onChanged={bump} />
    </div>
  );
};
