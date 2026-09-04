import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Calculator, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { EstimateLineDialog } from "@/components/EstimateLineDialog";
import api, { readBlobError, downloadBlob } from "@/lib/api";
import { formatMoney, roadmapStageLabel } from "@/lib/projectUtils";

export const EstimatorSection = ({ project, onChanged }) => {
  const [data, setData] = useState(null);
  const [rates, setRates] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [pct, setPct] = useState(null);

  const fetchEstimate = useCallback(async () => {
    const [est, r] = await Promise.all([api.get(`/projects/${project.id}/estimate`), api.get("/rates")]);
    setData(est.data);
    setRates(r.data);
    setPct(est.data.summary.contingency_pct);
  }, [project.id]);

  useEffect(() => { fetchEstimate(); }, [fetchEstimate]);

  const refresh = () => { fetchEstimate(); onChanged?.(); };

  const remove = async (line) => {
    try {
      await api.delete(`/estimate-lines/${line.id}`);
      toast.success("Line removed");
      refresh();
    } catch (e) {
      toast.error("Could not remove that line.");
    }
  };

  const commitContingency = async (value) => {
    try {
      const { data: d } = await api.put(`/projects/${project.id}/estimate/settings`, { contingency_pct: value });
      setData(d);
      onChanged?.();
    } catch (e) {
      toast.error("Could not save the contingency.");
    }
  };

  const exportPdf = async () => {
    try {
      const { data: blob } = await api.get(`/projects/${project.id}/estimate.pdf`, { responseType: "blob", timeout: 60000 });
      downloadBlob(blob, `Estimate-${project.name.replace(/[^A-Za-z0-9]+/g, "-")}.pdf`);
      toast.success("Estimate saved as a PDF.");
    } catch (e) {
      toast.error(await readBlobError(e));
    }
  };

  if (!data) return <p className="text-sm text-slate-400">Loading estimate…</p>;
  const { lines, summary } = data;
  const marginPositive = summary.margin >= 0;

  return (
    <section data-testid="estimator-section" className="mb-12">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Calculator className="h-5 w-5 text-amber-400" aria-hidden="true" />
          <h3 className="font-heading text-lg font-bold uppercase tracking-wider text-slate-100">Cost estimate</h3>
          <p className="text-xs text-slate-500 mt-0.5">What you expect the job to cost, priced from your rates.</p>
          <span className="text-xs text-slate-500">{lines.length} line{lines.length === 1 ? "" : "s"}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button data-testid="export-estimate-pdf-button" variant="outline" onClick={exportPdf} disabled={lines.length === 0}
            className="border-amber-500/50 bg-transparent text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 font-heading font-bold uppercase tracking-wider">
            <FileDown className="h-4 w-4" aria-hidden="true" /> Export Estimate PDF
          </Button>
          <Button data-testid="add-estimate-line-button" onClick={() => { setEditing(null); setFormOpen(true); }}
            className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
            <Plus className="h-4 w-4" aria-hidden="true" /> Add Line
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
        <div className="xl:col-span-2 rounded-md border border-slate-700 bg-card overflow-x-auto">
          {lines.length === 0 ? (
            <p className="text-sm text-slate-500 p-6" data-testid="estimate-empty">Nothing estimated yet. Add lines manually or from the rate guide.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-800/40 text-[10px] uppercase tracking-[0.2em] text-slate-500">
                  <th className="text-left px-4 py-2.5 font-medium">Description</th>
                  <th className="text-right px-4 py-2.5 font-medium">Qty</th>
                  <th className="text-right px-4 py-2.5 font-medium">Rate</th>
                  <th className="text-right px-4 py-2.5 font-medium">Total ex-GST</th>
                  <th className="px-2 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {lines.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-800/30 transition-colors duration-150" data-testid={`estimate-line-${l.id}`}>
                    <td className="px-4 py-2.5">
                      <p className="text-slate-200">{l.description}</p>
                      <div className="flex gap-2 mt-0.5">
                        <Badge variant="outline" className="border-slate-600 text-slate-400 uppercase tracking-wider text-[9px]">
                          {roadmapStageLabel(l.stage_key)}
                        </Badge>
                        {!l.gst_applicable && <span className="text-[10px] text-slate-500">GST-free</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-300 whitespace-nowrap">{l.quantity} {l.unit}</td>
                    <td className="px-4 py-2.5 text-right text-slate-300">{formatMoney(l.rate)}</td>
                    <td className="px-4 py-2.5 text-right font-heading font-semibold text-amber-300" data-testid={`estimate-line-total-${l.id}`}>
                      {formatMoney(l.line_total)}
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex gap-1 justify-end">
                        <button data-testid={`estimate-line-edit-${l.id}`} onClick={() => { setEditing(l); setFormOpen(true); }}
                          className="p-1.5 rounded-md text-slate-500 hover:text-amber-400 transition-colors duration-200">
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button data-testid={`estimate-line-delete-${l.id}`} onClick={() => remove(l)}
                          className="p-1.5 rounded-md text-slate-500 hover:text-red-400 transition-colors duration-200">
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="rounded-md border border-slate-700 bg-card p-5 space-y-4" data-testid="estimate-summary">
          <h4 className="text-xs uppercase tracking-[0.2em] text-amber-400 font-semibold">Estimate Summary</h4>
          <div className="space-y-2 text-sm">
            <p className="flex justify-between text-slate-300"><span>Subtotal ex-GST</span><span data-testid="estimate-subtotal">{formatMoney(summary.subtotal_ex_gst)}</span></p>
            <p className="flex justify-between text-slate-300"><span>GST (10%)</span><span data-testid="estimate-gst">{formatMoney(summary.gst)}</span></p>
            <div className="pt-2">
              <div className="flex justify-between text-slate-300 mb-2">
                <span>Contingency <span className="text-amber-400 font-semibold" data-testid="contingency-pct">{pct}%</span></span>
                <span data-testid="estimate-contingency">{formatMoney(summary.contingency_amount)}</span>
              </div>
              <Slider data-testid="contingency-slider" value={[pct ?? 12.5]} min={0} max={25} step={0.5}
                onValueChange={([v]) => setPct(v)} onValueCommit={([v]) => commitContingency(v)} />
            </div>
            <p className="flex justify-between font-heading font-bold text-slate-100 text-base border-t border-slate-700 pt-3">
              <span>Grand total</span><span className="text-amber-400" data-testid="estimate-grand-total">{formatMoney(summary.grand_total)}</span>
            </p>
            <p className="flex justify-between text-slate-400"><span>Contract value</span><span>{formatMoney(summary.contract_value)}</span></p>
            <div className={`rounded-md border px-3 py-2 mt-2 ${marginPositive ? "border-emerald-600/40 bg-emerald-600/10" : "border-red-500/40 bg-red-500/10"}`}
              data-testid="estimate-margin">
              <p className={`text-sm font-heading font-bold ${marginPositive ? "text-emerald-400" : "text-red-400"}`}>
                {marginPositive ? "Margin" : "Shortfall"}: {formatMoney(Math.abs(summary.margin))}
                {summary.margin_pct != null && ` (${Math.abs(summary.margin_pct)}%)`}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">{marginPositive ? "Estimate is under the contract value." : "Estimate exceeds the contract value."}</p>
            </div>
          </div>
        </div>
      </div>

      <EstimateLineDialog open={formOpen} onOpenChange={setFormOpen} projectId={project.id} line={editing} rates={rates} onSaved={refresh} />
    </section>
  );
};
