import { useState, useEffect, useCallback } from "react";
import { Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import api from "@/lib/api";
import { formatMoney, HEALTH_STYLES, HEALTH_LABELS } from "@/lib/projectUtils";

const Variance = ({ value, testId }) => {
  if (value === 0) return <span className="text-slate-500" data-testid={testId}>—</span>;
  const over = value > 0;
  return (
    <span className={over ? "text-red-400" : "text-emerald-400"} data-testid={testId}>
      {over ? "+" : "−"}{formatMoney(Math.abs(value))}
    </span>
  );
};

const Bars = ({ row, max }) => {
  const bar = (v, color) => (
    <div className="h-1 rounded bg-slate-800 overflow-hidden">
      <div className={`h-full ${color}`} style={{ width: `${max ? Math.min((v / max) * 100, 100) : 0}%` }} />
    </div>
  );
  return (
    <div className="space-y-0.5 mt-1.5">
      {bar(row.estimated, "bg-slate-500")}
      {bar(row.committed, "bg-amber-500")}
      {bar(row.invoiced, "bg-sky-500")}
      {bar(row.paid, "bg-emerald-500")}
    </div>
  );
};

export const BudgetSection = ({ projectId, refreshKey }) => {
  const [budget, setBudget] = useState(null);

  const fetchBudget = useCallback(async () => {
    const { data } = await api.get(`/projects/${projectId}/budget`);
    setBudget(data);
  }, [projectId]);

  useEffect(() => { fetchBudget(); }, [fetchBudget, refreshKey]);

  if (!budget) return <p className="text-sm text-slate-400">Loading budget…</p>;
  const { by_stage, by_work_package, totals } = budget;
  const max = Math.max(...by_stage.map((s) => Math.max(s.estimated, s.committed, s.invoiced, s.paid)), 1);

  return (
    <section data-testid="budget-section">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Scale className="h-5 w-5 text-amber-400" aria-hidden="true" />
        <h3 className="font-heading text-lg font-bold uppercase tracking-wider text-slate-100">Budget Tracking</h3>
        <Badge variant="outline" className={`uppercase tracking-wider text-[10px] ${HEALTH_STYLES[totals.health]}`} data-testid="budget-health-badge">
          {HEALTH_LABELS[totals.health]}
        </Badge>
        <span className="text-xs text-slate-500">All figures inc GST</span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        <div className="rounded-md border border-slate-700 bg-card p-4" data-testid="budget-contract-value">
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-1">Contract Value</p>
          <p className="font-heading text-lg font-bold text-slate-200">{formatMoney(totals.contract_value)}</p>
        </div>
        <div className="rounded-md border border-slate-700 bg-card p-4" data-testid="budget-approved-variations">
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-1">Approved Variations</p>
          <p className={`font-heading text-lg font-bold ${totals.approved_variations_total < 0 ? "text-red-400" : "text-emerald-400"}`}>
            {totals.approved_variations_total >= 0 ? "+" : "−"}{formatMoney(Math.abs(totals.approved_variations_total))}
          </p>
        </div>
        <div className="rounded-md border border-amber-500/40 bg-card p-4" data-testid="budget-adjusted-contract-value">
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-1">Adjusted Contract Value</p>
          <p className="font-heading text-lg font-bold text-amber-400">{formatMoney(totals.adjusted_contract_value)}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">contract + approved variations</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <div className="rounded-md border border-slate-700 bg-card p-4" data-testid="budget-total-estimated">
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-1">Estimated</p>
          <p className="font-heading text-lg font-bold text-slate-200">{formatMoney(totals.estimated)}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">+{totals.contingency_pct}% cont. = {formatMoney(totals.estimate_with_contingency)}</p>
        </div>
        <div className="rounded-md border border-slate-700 bg-card p-4" data-testid="budget-total-committed">
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-1">Committed</p>
          <p className="font-heading text-lg font-bold text-amber-400">{formatMoney(totals.committed)}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">accepted quotes</p>
        </div>
        <div className="rounded-md border border-slate-700 bg-card p-4" data-testid="budget-total-invoiced">
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-1">Invoiced</p>
          <p className="font-heading text-lg font-bold text-sky-400">{formatMoney(totals.invoiced)}</p>
        </div>
        <div className="rounded-md border border-slate-700 bg-card p-4" data-testid="budget-total-paid">
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-1">Paid</p>
          <p className="font-heading text-lg font-bold text-emerald-400">{formatMoney(totals.paid)}</p>
        </div>
        <div className="rounded-md border border-slate-700 bg-card p-4" data-testid="budget-total-exposure">
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-1">Exposure</p>
          <p className="font-heading text-lg font-bold text-slate-200">{formatMoney(totals.exposure)}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">committed + unlinked invoices</p>
        </div>
      </div>

      <div className="rounded-md border border-slate-700 bg-card overflow-x-auto mb-8">
        <table className="w-full text-sm" data-testid="budget-stage-table">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-800/40 text-[10px] uppercase tracking-[0.2em] text-slate-500">
              <th className="text-left px-4 py-2.5 font-medium">Stage</th>
              <th className="text-right px-4 py-2.5 font-medium">Estimated</th>
              <th className="text-right px-4 py-2.5 font-medium">Committed</th>
              <th className="text-right px-4 py-2.5 font-medium">Invoiced</th>
              <th className="text-right px-4 py-2.5 font-medium">Paid</th>
              <th className="text-right px-4 py-2.5 font-medium">Est → Comm</th>
              <th className="text-right px-4 py-2.5 font-medium">Comm → Inv</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {by_stage.map((s) => (
              <tr key={s.stage_key} data-testid={`budget-stage-${s.stage_key}`}>
                <td className="px-4 py-2.5">
                  <p className="text-slate-200 font-medium">{s.label}</p>
                  <Bars row={s} max={max} />
                </td>
                <td className="px-4 py-2.5 text-right text-slate-300 align-top">{formatMoney(s.estimated)}</td>
                <td className="px-4 py-2.5 text-right text-amber-300 align-top">{formatMoney(s.committed)}</td>
                <td className="px-4 py-2.5 text-right text-sky-300 align-top">{formatMoney(s.invoiced)}</td>
                <td className="px-4 py-2.5 text-right text-emerald-300 align-top">{formatMoney(s.paid)}</td>
                <td className="px-4 py-2.5 text-right align-top">
                  {s.committed > 0 ? <Variance value={s.variance_est_committed} testId={`variance-ec-${s.stage_key}`} /> : <span className="text-slate-600">—</span>}
                </td>
                <td className="px-4 py-2.5 text-right align-top">
                  {s.invoiced > 0 ? <Variance value={s.variance_committed_invoiced} testId={`variance-ci-${s.stage_key}`} /> : <span className="text-slate-600">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-2 border-t border-slate-700 bg-slate-800/40 flex gap-4 text-[10px] uppercase tracking-wider text-slate-500">
          <span><span className="inline-block h-2 w-2 rounded-full bg-slate-500 mr-1" />Estimated</span>
          <span><span className="inline-block h-2 w-2 rounded-full bg-amber-500 mr-1" />Committed</span>
          <span><span className="inline-block h-2 w-2 rounded-full bg-sky-500 mr-1" />Invoiced</span>
          <span><span className="inline-block h-2 w-2 rounded-full bg-emerald-500 mr-1" />Paid</span>
        </div>
      </div>

      <h4 className="text-xs uppercase tracking-[0.2em] text-slate-400 font-semibold mb-3">By Work Package</h4>
      {by_work_package.length === 0 ? (
        <p className="text-sm text-slate-500" data-testid="budget-wp-empty">No quoted work packages yet.</p>
      ) : (
        <div className="rounded-md border border-slate-700 bg-card overflow-x-auto">
          <table className="w-full text-sm" data-testid="budget-wp-table">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/40 text-[10px] uppercase tracking-[0.2em] text-slate-500">
                <th className="text-left px-4 py-2.5 font-medium">Work package</th>
                <th className="text-right px-4 py-2.5 font-medium">Committed</th>
                <th className="text-right px-4 py-2.5 font-medium">Invoiced</th>
                <th className="text-right px-4 py-2.5 font-medium">Paid</th>
                <th className="text-right px-4 py-2.5 font-medium">Comm → Inv</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {by_work_package.map((w) => (
                <tr key={w.work_package} data-testid={`budget-wp-${w.work_package.replace(/\s+/g, "-").toLowerCase()}`}>
                  <td className="px-4 py-2.5 text-slate-200">{w.work_package}</td>
                  <td className="px-4 py-2.5 text-right text-amber-300">{formatMoney(w.committed)}</td>
                  <td className="px-4 py-2.5 text-right text-sky-300">{formatMoney(w.invoiced)}</td>
                  <td className="px-4 py-2.5 text-right text-emerald-300">{formatMoney(w.paid)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {w.invoiced > 0 ? <Variance value={w.variance_committed_invoiced} /> : <span className="text-slate-600">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
