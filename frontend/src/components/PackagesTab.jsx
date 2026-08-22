import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Send, PackageOpen, TrendingUp, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { PackageFormDialog } from "@/components/PackageFormDialog";
import { SendRfqDialog } from "@/components/SendRfqDialog";
import api, { formatApiErrorDetail } from "@/lib/api";
import { formatMoney, roadmapStageLabel } from "@/lib/projectUtils";
import { tradeTypeLabel, packageStatusLabel, PACKAGE_STATUS_STYLES } from "@/lib/tradeUtils";

const CoverageStrip = ({ coverage }) => {
  if (!coverage || coverage.package_count === 0) return null;
  const unquoted = coverage.unquoted.length;
  return (
    <section className="rounded-md border border-slate-700 bg-card p-5 mb-6" data-testid="package-coverage">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Priced</span>
            <span className="font-heading font-bold text-amber-400" data-testid="coverage-priced-pct">{coverage.priced_pct}%</span>
          </div>
          <Progress value={coverage.priced_pct} className="h-2.5 bg-slate-700" />
          <p className="text-xs text-slate-500 mt-1.5">
            {coverage.priced_count} of {coverage.package_count} packages have a live quote
          </p>
        </div>
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Committed</span>
            <span className="font-heading font-bold text-emerald-400" data-testid="coverage-committed-pct">{coverage.committed_pct}%</span>
          </div>
          <Progress value={coverage.committed_pct} className="h-2.5 bg-slate-700" />
          <p className="text-xs text-slate-500 mt-1.5">
            {formatMoney(coverage.committed_total)} awarded of {formatMoney(coverage.estimate_total)} estimated
          </p>
        </div>
      </div>
      {unquoted > 0 && (
        <p className="text-xs text-amber-400 mt-4 pt-3 border-t border-slate-700/70" data-testid="coverage-unquoted">
          {unquoted} package{unquoted === 1 ? " has" : "s have"} never been sent to anyone:{" "}
          <span className="text-slate-300">{coverage.unquoted.map((p) => p.title).join(", ")}</span>
        </p>
      )}
    </section>
  );
};

const PackageRow = ({ pkg, onRequest, onEdit, onDelete }) => {
  const variance = pkg.variance_vs_estimate;
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3.5" data-testid={`package-row-${pkg.id}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-slate-200 truncate">{pkg.title}</p>
          <Badge variant="outline" className={`uppercase tracking-wider text-[10px] shrink-0 ${PACKAGE_STATUS_STYLES[pkg.status]}`}
            data-testid={`package-status-${pkg.id}`}>
            {packageStatusLabel(pkg.status)}
          </Badge>
        </div>
        <p className="text-xs text-slate-500 truncate mt-0.5">
          {tradeTypeLabel(pkg.trade_type)} · {roadmapStageLabel(pkg.stage_key)}
          {pkg.invited_count > 0 && <> · {pkg.responded_count}/{pkg.invited_count} responded</>}
          {pkg.quote_count > 0 && <> · {pkg.quote_count} quote{pkg.quote_count === 1 ? "" : "s"}</>}
        </p>
      </div>

      <div className="text-right shrink-0 min-w-[7.5rem]">
        {pkg.awarded_amount ? (
          <p className="font-heading font-bold text-emerald-400 text-sm" data-testid={`package-awarded-${pkg.id}`}>
            {formatMoney(pkg.awarded_amount)}
          </p>
        ) : pkg.lowest_quote ? (
          <p className="font-heading font-bold text-amber-400 text-sm" data-testid={`package-lowest-${pkg.id}`}>
            {formatMoney(pkg.lowest_quote)}
          </p>
        ) : (
          <p className="text-xs text-slate-600">No quotes</p>
        )}
        {pkg.estimate_total > 0 && (
          <p className="text-[11px] text-slate-500">est {formatMoney(pkg.estimate_total)}</p>
        )}
        {variance != null && variance !== 0 && (
          <p className={`text-[11px] inline-flex items-center gap-0.5 ${variance > 0 ? "text-red-400" : "text-emerald-400"}`}>
            {variance > 0 ? <TrendingUp className="h-3 w-3" aria-hidden="true" /> : <TrendingDown className="h-3 w-3" aria-hidden="true" />}
            {formatMoney(Math.abs(variance))}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <Button size="sm" variant="outline" data-testid={`package-request-${pkg.id}`} onClick={() => onRequest(pkg)}
          className="border-amber-500/50 bg-transparent text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 text-xs h-8">
          <Send className="h-3.5 w-3.5" aria-hidden="true" /> Request Quotes
        </Button>
        <button data-testid={`package-edit-${pkg.id}`} onClick={() => onEdit(pkg)}
          className="p-1.5 rounded-md text-slate-500 hover:text-amber-400 transition-colors duration-200">
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button data-testid={`package-delete-${pkg.id}`}
              className="p-1.5 rounded-md text-slate-500 hover:text-red-400 transition-colors duration-200" title="Delete" aria-label="Delete">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
          </AlertDialogTrigger>
          <AlertDialogContent className="bg-card border-slate-700">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-slate-100">Delete "{pkg.title}"?</AlertDialogTitle>
              <AlertDialogDescription className="text-slate-400">
                Estimate lines pointing at this package will be unlinked but kept. A package that already has
                quotes or quote requests against it can't be deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-slate-600 text-slate-300">Cancel</AlertDialogCancel>
              <AlertDialogAction data-testid={`package-delete-confirm-${pkg.id}`} onClick={() => onDelete(pkg)}
                className="bg-red-600 text-white hover:bg-red-500">Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
};

export const PackagesTab = ({ projectId }) => {
  const [packages, setPackages] = useState([]);
  const [coverage, setCoverage] = useState(null);
  const [trades, setTrades] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendPkg, setSendPkg] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const [p, c, t, d] = await Promise.all([
        api.get(`/projects/${projectId}/packages`),
        api.get(`/projects/${projectId}/packages/coverage`),
        api.get("/trades"),
        api.get(`/projects/${projectId}/documents`),
      ]);
      setPackages(p.data);
      setCoverage(c.data);
      setTrades(t.data);
      setDocuments(d.data);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const remove = async (pkg) => {
    try {
      await api.delete(`/packages/${pkg.id}`);
      toast.success("Package deleted");
      fetchData();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Failed to delete package.");
    }
  };

  const requestQuotes = (pkg) => { setSendPkg(pkg); setSendOpen(true); };

  // Grouped by status so the board reads as a pipeline, not a flat list.
  const groups = packages.reduce((m, p) => {
    (m[p.status] = m[p.status] || []).push(p);
    return m;
  }, {});
  const groupOrder = ["draft", "out-for-quote", "quotes-in", "awarded", "ordered", "in-progress", "complete"]
    .filter((s) => groups[s]?.length);

  return (
    <div data-testid="packages-tab">
      <div className="flex flex-wrap justify-end gap-3 mb-6">
        <Button data-testid="add-package-button" onClick={() => { setEditing(null); setFormOpen(true); }}
          className="bg-amber-500 text-slate-950 font-heading font-bold uppercase tracking-wider hover:bg-amber-400 transition-colors duration-200">
          <Plus className="h-4 w-4" aria-hidden="true" /> New Package
        </Button>
      </div>

      {loading && <p className="text-sm text-slate-400">Loading packages…</p>}
      {!loading && <CoverageStrip coverage={coverage} />}

      {!loading && packages.length === 0 && (
        <div className="rounded-md border border-slate-700 bg-slate-800/30 p-10 text-center" data-testid="packages-empty">
          <PackageOpen className="h-8 w-8 text-slate-600 mx-auto mb-3" aria-hidden="true" />
          <p className="text-sm text-slate-400 mb-1">No work packages yet.</p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            A package is one scope you can send out for quotes — "Plumbing", "Roof &amp; gutters", "Electrical
            rough-in". Create them here, or let the AI Planner propose them from your drawings.
          </p>
        </div>
      )}

      <div className="space-y-8">
        {groupOrder.map((status) => (
          <section key={status} data-testid={`package-group-${status}`}>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <h3 className="font-heading text-lg font-bold uppercase tracking-wider text-slate-100">
                {packageStatusLabel(status)}
              </h3>
              <span className="text-xs text-slate-500">{groups[status].length}</span>
            </div>
            <div className="rounded-md border border-slate-700 bg-card divide-y divide-slate-800">
              {groups[status].map((pkg) => (
                <PackageRow key={pkg.id} pkg={pkg} onRequest={requestQuotes} onDelete={remove}
                  onEdit={(p) => { setEditing(p); setFormOpen(true); }} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <PackageFormDialog open={formOpen} onOpenChange={setFormOpen} projectId={projectId} pkg={editing} onSaved={fetchData} />
      <SendRfqDialog open={sendOpen} onOpenChange={setSendOpen} projectId={projectId} pkg={sendPkg}
        trades={trades} documents={documents} onSaved={fetchData} />
    </div>
  );
};
