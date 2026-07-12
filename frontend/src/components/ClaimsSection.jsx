import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { FileSpreadsheet, RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import api, { formatApiErrorDetail } from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/projectUtils";
import { CLAIM_STATUSES, CLAIM_STATUS_STYLES } from "@/lib/tradeUtils";

const ClaimRow = ({ line, onChanged }) => {
  const [amount, setAmount] = useState(String(line.amount));

  useEffect(() => { setAmount(String(line.amount)); }, [line.amount]);

  const save = async (updates) => {
    try {
      await api.put(`/claims/${line.id}`, updates);
      onChanged();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Failed to update claim line.");
    }
  };

  const onAmountBlur = () => {
    const val = Math.round((parseFloat(amount) || 0) * 100) / 100;
    if (val !== line.amount) save({ amount: val });
  };

  return (
    <div className="grid grid-cols-12 items-center gap-3 px-4 py-3" data-testid={`claim-row-${line.id}`}>
      <div className="col-span-3 sm:col-span-2">
        <p className="text-sm font-medium text-slate-200">{line.stage_label}</p>
        <p className="text-xs text-slate-500">{line.percentage}%</p>
      </div>
      <div className="col-span-4 sm:col-span-3">
        <Input data-testid={`claim-amount-${line.id}`} type="number" min="0" step="0.01"
          className="bg-slate-800/50 border-slate-600 h-8 text-sm" value={amount}
          onChange={(e) => setAmount(e.target.value)} onBlur={onAmountBlur} />
      </div>
      <div className="col-span-5 sm:col-span-3">
        <Select value={line.status} onValueChange={(v) => save({ status: v })}>
          <SelectTrigger data-testid={`claim-status-${line.id}`} className="h-8 bg-slate-800/50 border-slate-600 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CLAIM_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="col-span-12 sm:col-span-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <Badge variant="outline" className={`uppercase tracking-wider text-[9px] ${CLAIM_STATUS_STYLES[line.status]}`}>
          {line.status}
        </Badge>
        {line.claimed_date && <span>Claimed {formatDate(line.claimed_date)}</span>}
        {line.paid_date && <span className="text-emerald-400">Paid {formatDate(line.paid_date)}</span>}
      </div>
    </div>
  );
};

export const ClaimsSection = ({ projectId, contractValue }) => {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const fetchClaims = useCallback(async () => {
    const { data: d } = await api.get(`/projects/${projectId}/claims`);
    setData(d);
  }, [projectId]);

  useEffect(() => { fetchClaims(); }, [fetchClaims]);

  const generate = async (force = false) => {
    setBusy(true);
    try {
      await api.post(`/projects/${projectId}/claims/generate${force ? "?force=true" : ""}`);
      toast.success("Progress claim schedule generated (5/10/15/35/25/10)");
      fetchClaims();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Failed to generate schedule.");
    } finally {
      setBusy(false);
    }
  };

  if (!data) return null;
  const { lines, summary } = data;

  return (
    <section className="mt-12" data-testid="claims-section">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <FileSpreadsheet className="h-5 w-5 text-amber-400" aria-hidden="true" />
        <h3 className="font-heading text-lg font-bold uppercase tracking-wider text-slate-100">Client Progress Claims</h3>
        <span className="text-xs text-slate-500">Victorian schedule — Deposit 5% · Base 10% · Frame 15% · Lockup 35% · Fixing 25% · Completion 10%</span>
      </div>

      {lines.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-700 bg-slate-800/20 p-8 text-center" data-testid="claims-empty">
          <p className="text-sm text-slate-400 mb-4">No claim schedule yet. Generate it from the contract value ({formatMoney(contractValue)}).</p>
          <Button data-testid="generate-claims-button" onClick={() => generate(false)} disabled={busy}
            className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
            Generate Schedule
          </Button>
        </div>
      ) : (
        <div className="rounded-md border border-slate-700 bg-card overflow-hidden">
          <div className="grid grid-cols-12 gap-3 px-4 py-2 border-b border-slate-700 bg-slate-800/40 text-[10px] uppercase tracking-[0.2em] text-slate-500">
            <span className="col-span-3 sm:col-span-2">Stage</span>
            <span className="col-span-4 sm:col-span-3">Amount</span>
            <span className="col-span-5 sm:col-span-3">Status</span>
            <span className="hidden sm:block sm:col-span-4">Dates</span>
          </div>
          <div className="divide-y divide-slate-800">
            {lines.map((l) => <ClaimRow key={l.id} line={l} onChanged={fetchClaims} />)}
          </div>
          <div className="px-4 py-3 border-t border-slate-700 bg-slate-800/40 flex flex-wrap items-center gap-4 text-sm">
            <span className="text-slate-300">Schedule total: <strong className="font-heading text-slate-100" data-testid="claims-schedule-total">{formatMoney(summary.schedule_total)}</strong></span>
            <span className="text-slate-300">Claimed: <strong className="font-heading text-amber-400" data-testid="claims-total-claimed">{formatMoney(summary.total_claimed)}</strong></span>
            <span className="text-slate-300">Paid: <strong className="font-heading text-emerald-400" data-testid="claims-total-paid">{formatMoney(summary.total_paid)}</strong></span>
            <span className="flex-1" />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button data-testid="regenerate-claims-button"
                  className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-amber-400 transition-colors duration-200">
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Regenerate
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent className="bg-card border-slate-700">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-slate-100">Regenerate the claim schedule?</AlertDialogTitle>
                  <AlertDialogDescription className="text-slate-400">
                    This replaces the current schedule (including claimed/paid statuses) with a fresh 5/10/15/35/25/10 split of the contract value.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="regenerate-claims-cancel" className="border-slate-600 text-slate-300">Cancel</AlertDialogCancel>
                  <AlertDialogAction data-testid="regenerate-claims-confirm" onClick={() => generate(true)}
                    className="bg-amber-500 text-slate-950 hover:bg-amber-400">Regenerate</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          {summary.warning && (
            <p className="px-4 py-2 border-t border-amber-500/40 bg-amber-500/10 text-xs text-amber-300 flex items-center gap-2" data-testid="claims-variance-warning">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {summary.warning}
            </p>
          )}
        </div>
      )}
    </section>
  );
};
