import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Plus, Pencil, Trash2, RotateCcw, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { RateFormDialog } from "@/components/RateFormDialog";
import api from "@/lib/api";
import { tradeTypeLabel } from "@/lib/tradeUtils";

const BENCHMARKS = [
  { label: "Standard build", value: "$1,400–2,500 /m²", note: "Regional west VIC, 2025" },
  { label: "Custom build", value: "$2,500–3,800 /m²", note: "Architectural / high spec" },
  { label: "Cost split", value: "50 / 35 / 15", note: "Materials ~50% · Labour ~35% · Fees & permits ~15%" },
  { label: "Contingency", value: "10–15%", note: "Recommended allowance" },
];

const fmtRange = (low, high) => {
  const f = (v) => `$${Number(v).toLocaleString("en-AU")}`;
  if (low == null && high == null) return "—";
  if (low != null && high != null) return `${f(low)}–${f(high)}`;
  return low != null ? `${f(low)}+` : `up to ${f(high)}`;
};

export const RateGuide = () => {
  const [rates, setRates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const fetchRates = useCallback(async () => {
    try {
      const { data } = await api.get("/rates");
      setRates(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRates(); }, [fetchRates]);

  const reset = async () => {
    try {
      const { data } = await api.post("/rates/reset");
      setRates(data);
      toast.success("Rate guide reset to 2025 reference defaults");
    } catch (e) {
      toast.error("Could not reset the prices.");
    }
  };

  const remove = async (rate) => {
    try {
      await api.delete(`/rates/${rate.id}`);
      toast.success("Rate item deleted");
      fetchRates();
    } catch (e) {
      toast.error("Could not delete that price.");
    }
  };

  return (
    <section data-testid="rate-guide">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h2 className="font-heading text-lg font-bold uppercase tracking-wider text-slate-100">Prices</h2>
          <p className="text-xs text-slate-500 mt-1">
            The rates the estimate lines are priced from. Western Victoria, 2025, ex-GST.
          </p>
        </div>
        <div className="flex gap-3">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" data-testid="reset-rates-button"
                className="border-slate-600 text-slate-300 hover:text-amber-400 hover:border-amber-500/50 hover:bg-transparent">
                <RotateCcw className="h-4 w-4" aria-hidden="true" /> Reset to Defaults
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-card border-slate-700">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-slate-100">Reset the rate guide?</AlertDialogTitle>
                <AlertDialogDescription className="text-slate-400">
                  All edits and custom items will be replaced with the 2025 Victoria reference defaults.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="reset-rates-cancel" className="border-slate-600 text-slate-300">Cancel</AlertDialogCancel>
                <AlertDialogAction data-testid="reset-rates-confirm" onClick={reset}
                  className="bg-amber-500 text-slate-950 hover:bg-amber-400">Reset</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button data-testid="add-rate-button" onClick={() => { setEditing(null); setFormOpen(true); }}
            className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
            <Plus className="h-4 w-4" aria-hidden="true" /> Add Item
          </Button>
        </div>
      </div>

      <p className="flex items-center gap-2 text-xs text-slate-400 border border-slate-700 bg-slate-800/40 rounded-md px-4 py-2.5 mb-8" data-testid="rate-guide-disclaimer">
        <Info className="h-4 w-4 text-amber-400 shrink-0" aria-hidden="true" />
        Market reference rates for western Victoria, 2025. Ex-GST. Always confirm with current quotes.
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        {BENCHMARKS.map((b, i) => (
          <motion.div key={b.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: i * 0.06 }}
            className="rounded-md border border-slate-700 bg-card p-4" data-testid={`benchmark-${b.label.replace(/\s+/g, "-").toLowerCase()}`}>
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-1">{b.label}</p>
            <p className="font-heading text-lg font-bold text-amber-400">{b.value}</p>
            <p className="text-xs text-slate-500 mt-1">{b.note}</p>
          </motion.div>
        ))}
      </div>

      {loading && <p className="text-sm text-slate-400">Loading rates…</p>}

      <div className="rounded-md border border-slate-700 bg-card overflow-x-auto">
        <table className="w-full text-sm" data-testid="rates-table">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-800/40 text-[10px] uppercase tracking-[0.2em] text-slate-500">
              <th className="text-left px-4 py-2.5 font-medium">Work item</th>
              <th className="text-left px-4 py-2.5 font-medium">Trade</th>
              <th className="text-left px-4 py-2.5 font-medium">Unit</th>
              <th className="text-right px-4 py-2.5 font-medium">Labour</th>
              <th className="text-right px-4 py-2.5 font-medium">Supply &amp; Install</th>
              <th className="text-left px-4 py-2.5 font-medium hidden lg:table-cell">Notes</th>
              <th className="px-2 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rates.map((r) => (
              <tr key={r.id} className="hover:bg-slate-800/30 transition-colors duration-150" data-testid={`rate-row-${r.id}`}>
                <td className="px-4 py-2.5 text-slate-200 font-medium">
                  {r.work_item}
                  {!r.is_reference && (
                    <Badge variant="outline" className="ml-2 border-slate-600 text-slate-400 uppercase tracking-wider text-[9px]">Custom</Badge>
                  )}
                </td>
                <td className="px-4 py-2.5 text-slate-400">{tradeTypeLabel(r.trade_type)}</td>
                <td className="px-4 py-2.5 text-slate-400">{r.unit}</td>
                <td className="px-4 py-2.5 text-right text-slate-300">{fmtRange(r.labour_low, r.labour_high)}</td>
                <td className="px-4 py-2.5 text-right text-amber-300">{fmtRange(r.supply_install_low, r.supply_install_high)}</td>
                <td className="px-4 py-2.5 text-slate-500 text-xs hidden lg:table-cell">{r.notes}</td>
                <td className="px-2 py-2.5">
                  <div className="flex gap-1 justify-end">
                    <button data-testid={`rate-edit-${r.id}`} onClick={() => { setEditing(r); setFormOpen(true); }}
                      className="p-1.5 rounded-md text-slate-500 hover:text-amber-400 transition-colors duration-200">
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button data-testid={`rate-delete-${r.id}`} onClick={() => remove(r)}
                      className="p-1.5 rounded-md text-slate-500 hover:text-red-400 transition-colors duration-200">
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <RateFormDialog open={formOpen} onOpenChange={setFormOpen} rate={editing} onSaved={fetchRates} />
    </section>
  );
}
