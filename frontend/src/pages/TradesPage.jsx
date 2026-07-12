import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TradeCard } from "@/components/TradeCard";
import { TradeFormDialog } from "@/components/TradeFormDialog";
import api, { formatApiErrorDetail } from "@/lib/api";

export default function TradesPage() {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const fetchTrades = useCallback(async () => {
    try {
      const { data } = await api.get("/trades");
      setTrades(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTrades(); }, [fetchTrades]);

  const remove = async (trade) => {
    try {
      await api.delete(`/trades/${trade.id}`);
      toast.success("Trade deleted");
      fetchTrades();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Failed to delete trade.");
    }
  };

  return (
    <main className="max-w-7xl mx-auto px-6 py-12" data-testid="trades-page">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-10">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-amber-400 font-semibold mb-2">Subcontractors</p>
          <h1 className="font-heading text-4xl font-bold tracking-tight text-slate-100">Trades Directory</h1>
          <p className="text-sm text-slate-400 mt-2">Global directory — assign trades to projects and link them to roadmap tasks.</p>
        </div>
        <Button data-testid="add-trade-button" onClick={() => { setEditing(null); setFormOpen(true); }}
          className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
          <Plus className="h-4 w-4" aria-hidden="true" /> Add Trade
        </Button>
      </div>

      {loading && <p className="text-sm text-slate-400">Loading trades…</p>}
      {!loading && trades.length === 0 && (
        <div data-testid="trades-empty" className="rounded-md border border-slate-700 bg-slate-800/30 p-10 text-center">
          <p className="text-sm text-slate-400">No trades yet. Add your first subcontractor.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 items-start">
        {trades.map((t, idx) => (
          <motion.div key={t.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: Math.min(idx * 0.05, 0.35) }}>
            <TradeCard
              trade={t}
              actions={
                <>
                  <button data-testid={`trade-edit-${t.id}`} onClick={() => { setEditing(t); setFormOpen(true); }}
                    className="p-1.5 rounded-md text-slate-500 hover:text-amber-400 transition-colors duration-200">
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button data-testid={`trade-delete-${t.id}`} onClick={() => remove(t)}
                    className="p-1.5 rounded-md text-slate-500 hover:text-red-400 transition-colors duration-200">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </>
              }
            />
          </motion.div>
        ))}
      </div>

      <TradeFormDialog open={formOpen} onOpenChange={setFormOpen} trade={editing} onSaved={fetchTrades} />
    </main>
  );
}
