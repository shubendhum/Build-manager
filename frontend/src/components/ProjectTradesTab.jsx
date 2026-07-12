import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { UserMinus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TradeCard } from "@/components/TradeCard";
import api, { formatApiErrorDetail } from "@/lib/api";

export const ProjectTradesTab = ({ projectId }) => {
  const [assigned, setAssigned] = useState([]);
  const [allTrades, setAllTrades] = useState([]);
  const [selectValue, setSelectValue] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [a, all] = await Promise.all([api.get(`/projects/${projectId}/trades`), api.get("/trades")]);
      setAssigned(a.data);
      setAllTrades(all.data);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const assignedIds = new Set(assigned.map((t) => t.id));
  const available = allTrades.filter((t) => !assignedIds.has(t.id));

  const assign = async () => {
    if (!selectValue) return;
    try {
      await api.post(`/projects/${projectId}/trades`, { trade_id: selectValue });
      toast.success("Trade assigned to project");
      setSelectValue("");
      fetchData();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Failed to assign trade.");
    }
  };

  const unassign = async (trade) => {
    try {
      await api.delete(`/projects/${projectId}/trades/${trade.id}`);
      toast.success("Trade unassigned");
      fetchData();
    } catch (e) {
      toast.error("Failed to unassign trade.");
    }
  };

  return (
    <div data-testid="project-trades-tab">
      <div className="rounded-md border border-slate-700 bg-card p-5 mb-6 flex flex-wrap items-end gap-4">
        <div className="flex-1 min-w-[240px] space-y-1.5">
          <p className="text-xs uppercase tracking-[0.15em] text-slate-400 font-semibold">Assign a trade from the directory</p>
          <Select value={selectValue} onValueChange={setSelectValue}>
            <SelectTrigger data-testid="assign-trade-select" className="bg-slate-800/50 border-slate-600">
              <SelectValue placeholder={available.length ? "Select a trade…" : "All trades assigned"} />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              {available.map((t) => (
                <SelectItem key={t.id} value={t.id} data-testid={`assign-trade-option-${t.id}`}>{t.business_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button data-testid="assign-trade-button" onClick={assign} disabled={!selectValue}
          className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
          <UserPlus className="h-4 w-4" aria-hidden="true" /> Assign
        </Button>
      </div>

      {loading && <p className="text-sm text-slate-400">Loading trades…</p>}
      {!loading && assigned.length === 0 && (
        <p className="text-sm text-slate-500" data-testid="project-trades-empty">No trades assigned to this project yet.</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 items-start">
        {assigned.map((t) => (
          <TradeCard key={t.id} trade={t}
            actions={
              <button data-testid={`unassign-trade-${t.id}`} onClick={() => unassign(t)}
                className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-red-400 transition-colors duration-200">
                <UserMinus className="h-3.5 w-3.5" aria-hidden="true" /> Unassign
              </button>
            }
          />
        ))}
      </div>
    </div>
  );
};
