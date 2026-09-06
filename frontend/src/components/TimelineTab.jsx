import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  Package, Truck, AlertTriangle, CheckCircle2, Plus, Loader2, OctagonAlert, Ruler,
  Map as MapIcon, List,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BuildRoad } from "@/components/BuildRoad";
import { RoadOverview } from "@/components/RoadOverview";
import api, { formatApiErrorDetail } from "@/lib/api";
import { formatDate } from "@/lib/projectUtils";

// How urgent an order is. Sequenced items are measured off finished work, so
// they are never "late to order" — saying so would be noise every day.
const ORDER_STATE = {
  overdue: { label: "Order was due", cls: "border-red-500/50 bg-red-500/10 text-red-300", tone: "text-red-400" },
  "order-now": { label: "Order now", cls: "border-amber-500/50 bg-amber-500/10 text-amber-300", tone: "text-amber-400" },
  soon: { label: "Coming up", cls: "border-slate-600 bg-slate-800/40 text-slate-300", tone: "text-slate-300" },
  later: { label: "Later", cls: "border-slate-700 bg-slate-800/20 text-slate-400", tone: "text-slate-500" },
  sequenced: { label: "Measured on site", cls: "border-sky-500/40 bg-sky-500/[0.07] text-sky-300", tone: "text-sky-400" },
};

const STEP_STATE = {
  done: "border-l-emerald-500 text-slate-400",
  past: "border-l-slate-700 text-slate-300",
  current: "border-l-amber-500 text-slate-100",
  ahead: "border-l-slate-800 text-slate-400",
};

/** The road is for reading; the list is for checking dates. Both, switchable. */
const VIEWS = [
  ["road", "Road", MapIcon],
  ["list", "Dates", List],
];

const shortDate = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
};

const HandoverDate = ({ value, onSave, busy }) => {
  const [draft, setDraft] = useState(value || "");
  useEffect(() => { setDraft(value || ""); }, [value]);
  return (
    <label className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
      <span className="uppercase tracking-[0.15em] text-[10px] text-slate-500">Handover by</span>
      <input type="date" value={draft} disabled={busy} data-testid="timeline-target"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== (value || "") && onSave(draft || null)}
        className="bg-slate-800/60 border border-slate-600 rounded px-2 py-1 text-sm text-slate-100 focus:border-amber-500/60 outline-none" />
    </label>
  );
};

const OrderRow = ({ order, onRaise, busy }) => {
  const s = ORDER_STATE[order.status] || ORDER_STATE.later;
  return (
    <div className={`rounded-md border px-3 py-2.5 ${s.cls}`} data-testid={`order-${order.key}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-heading text-sm font-bold text-slate-100 min-w-0 flex-1 break-words">
          {order.name}
        </span>
        <span className="text-[10px] uppercase tracking-wider font-bold shrink-0">{s.label}</span>
      </div>

      <p className="text-xs mt-1">
        {order.measured_on_site ? (
          <span className="inline-flex items-center gap-1.5">
            <Ruler className="h-3 w-3 shrink-0" aria-hidden="true" />
            Templated on site around {shortDate(order.order_by)}, then about {order.lead_weeks} weeks
          </span>
        ) : (
          <>
            <b className="font-heading">Order by {formatDate(order.order_by)}</b>
            <span className="text-slate-400">
              {" · "}{order.lead_weeks} weeks' notice · on site for {order.needed_step_name.toLowerCase()}
              {" "}by {shortDate(order.needed_by)}
              {order.days_left < 0
                ? ` · ${Math.abs(order.days_left)} days ago`
                : order.days_left <= 28 ? ` · in ${order.days_left} days` : ""}
            </span>
          </>
        )}
      </p>

      <p className="text-[11px] text-slate-400 mt-1.5 break-words">{order.note}</p>

      <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-slate-700/50">
        {order.supply_package ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400">
            <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
            Supply quote on the board
          </span>
        ) : order.installer_package ? (
          <span className="text-[11px] text-slate-400 break-words">
            Usually supplied by <b className="text-slate-300">{order.installer_package.title}</b>
          </span>
        ) : (
          <span className="text-[11px] text-red-400 break-words">
            {order.installer_work} isn't on the board either
          </span>
        )}
        <span className="flex-1" />
        {!order.supply_package && (
          <button type="button" disabled={busy} onClick={() => onRaise(order.key)}
            data-testid={`raise-supply-${order.key}`}
            className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-amber-400 transition-colors duration-200 disabled:opacity-40">
            <Plus className="h-3 w-3 shrink-0" aria-hidden="true" /> Price it separately
          </button>
        )}
      </div>
    </div>
  );
};

/**
 * The build laid out against dates, worked backwards from the day it has to be
 * finished. Read-only except for the handover date and raising a supply quote —
 * this is for seeing whether the job is on track, not for running it.
 */
export const TimelineTab = ({ project, onChanged }) => {
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState("road");

  const fetchPlan = useCallback(async () => {
    try {
      const { data } = await api.get(`/projects/${project.id}/timeline`);
      setPlan(data);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Could not work out the timeline.");
    }
  }, [project.id]);

  useEffect(() => { fetchPlan(); }, [fetchPlan]);

  const saveTarget = async (value) => {
    setBusy(true);
    try {
      await api.put(`/projects/${project.id}`, { target_completion: value });
      await fetchPlan();
      onChanged?.();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Could not save that date.");
    } finally {
      setBusy(false);
    }
  };

  const raiseSupply = async (key) => {
    setBusy(true);
    try {
      const { data } = await api.post(`/projects/${project.id}/material-orders`, { keys: [key] });
      toast.success(`${data.created[0].title} added to the board`);
      await fetchPlan();
      onChanged?.();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Could not add that to the board.");
    } finally {
      setBusy(false);
    }
  };

  if (!plan) return <p className="text-sm text-slate-400">Working out the timeline…</p>;

  const urgent = plan.orders.filter((o) => ["overdue", "order-now"].includes(o.status));
  const rest = plan.orders.filter((o) => !["overdue", "order-now"].includes(o.status));

  return (
    <div data-testid="timeline-tab">
      <section className="rounded-md border border-slate-700 bg-card p-4 sm:p-5 mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-0.5">Timeline</p>
            <h2 className="font-heading text-lg font-bold text-slate-100">
              {formatDate(plan.planned_start)} — {formatDate(plan.planned_finish)}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {plan.build_weeks} weeks on site, planned {plan.basis}
            </p>
          </div>
          <HandoverDate value={plan.target_completion} onSave={saveTarget} busy={busy} />
        </div>

        {!plan.target_completion && (
          <p className="text-xs text-slate-400" data-testid="timeline-no-target">
            Set a handover date and every step and every order gets worked backwards from it.
            Until then this is just the shape of a job of this size.
          </p>
        )}

        {plan.start_has_passed && (
          <p className="flex items-start gap-2 rounded border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-300"
            data-testid="timeline-impossible">
            <OctagonAlert className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              To hand over on {formatDate(plan.target_completion)} this job needed to start on{" "}
              {formatDate(plan.planned_start)}, which has passed. Either the date moves or the
              programme has to compress.
            </span>
          </p>
        )}

        {plan.target_completion && !plan.start_has_passed && (
          <p className={`flex items-center gap-2 text-sm ${plan.on_track ? "text-emerald-400" : "text-amber-400"}`}
            data-testid="timeline-on-track">
            {plan.on_track
              ? <><CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" /> On track</>
              : <><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {plan.steps_behind > 0 && `${plan.steps_behind} step${plan.steps_behind === 1 ? "" : "s"} behind`}
                  {plan.steps_behind > 0 && plan.orders_overdue > 0 && " · "}
                  {plan.orders_overdue > 0 && `${plan.orders_overdue} order${plan.orders_overdue === 1 ? "" : "s"} past their date`}
                </>}
          </p>
        )}
      </section>

      {urgent.length > 0 && (
        <section className="mb-5" data-testid="orders-urgent">
          <p className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-2">
            <Truck className="h-3.5 w-3.5" aria-hidden="true" /> Order these now
          </p>
          <div className="space-y-2">
            {urgent.map((o) => <OrderRow key={o.key} order={o} onRaise={raiseSupply} busy={busy} />)}
          </div>
        </section>
      )}

      <section className="rounded-md border border-slate-700 bg-card p-4 sm:p-5 mb-5"
        data-testid="build-timeline">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
            The whole build, start to handover
          </p>
          <div className="flex rounded-md border border-slate-700 overflow-hidden" role="group">
            {VIEWS.map(([key, label, Icon]) => (
              <button key={key} type="button" onClick={() => setView(key)}
                data-testid={`timeline-view-${key}`} aria-pressed={view === key}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors duration-200 ${
                  view === key ? "bg-amber-500 text-slate-950 font-bold"
                    : "text-slate-400 hover:text-slate-100"}`}>
                <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {label}
              </button>
            ))}
          </div>
        </div>

        <RoadOverview steps={plan.steps} currentStep={plan.current_step}
          onJump={(s) => {
            setView("road");
            setTimeout(() => document.querySelector(`[data-testid="road-node-${s.n}"]`)
              ?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
          }} />

        <div className="mt-6">
          {view === "road" ? (
            <BuildRoad steps={plan.steps} orders={plan.orders} today={plan.today} />
          ) : (
            <div className="rounded-md border border-slate-700 divide-y divide-slate-800">
              {plan.steps.map((s) => (
                <div key={s.n}
                  className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 sm:px-4 py-2.5 border-l-2 ${
                    STEP_STATE[s.state] || STEP_STATE.ahead} ${s.behind ? "bg-red-500/[0.06]" : ""}`}
                  data-testid={`timeline-step-${s.n}`}>
                  <span className="text-[11px] tabular-nums text-slate-600 w-6 shrink-0 text-right">{s.n}</span>
                  <span className="min-w-0 flex-1 text-sm break-words">
                    {s.name}
                    {s.parallel && (
                      <span className="text-[11px] text-slate-500 ml-2">runs alongside the step before</span>
                    )}
                    {s.packages.length > 0 && (
                      <span className="block text-[11px] text-slate-500 break-words">
                        {s.packages.map((p) => p.title).join(", ")}
                      </span>
                    )}
                  </span>
                  {s.mandatory && (
                    <span className="shrink-0 rounded border border-amber-500/50 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-400">
                      Hold point
                    </span>
                  )}
                  {s.behind && (
                    <span className="shrink-0 rounded border border-red-500/50 bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-400">
                      Behind
                    </span>
                  )}
                  <span className="text-xs tabular-nums text-slate-400 shrink-0 w-[8.5rem] text-right">
                    {shortDate(s.start)} – {shortDate(s.finish)}
                  </span>
                  <span className="text-[11px] tabular-nums text-slate-600 shrink-0 w-8 text-right">{s.days}d</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {view === "road" && (
          <p className="text-xs text-slate-500 mt-5 pt-4 border-t border-slate-800">
            Distance down the road is time. The sealed road behind you is what has passed; the
            dashed road ahead has not happened yet. Signposts sit at the date an order has to be
            placed — one behind you is one you have missed.
          </p>
        )}
      </section>

      <section data-testid="orders-all">
        <p className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-2">
          <Package className="h-3.5 w-3.5" aria-hidden="true" /> Everything to order, by date
        </p>
        <div className="space-y-2">
          {rest.map((o) => <OrderRow key={o.key} order={o} onRaise={raiseSupply} busy={busy} />)}
        </div>
        <p className="text-xs text-slate-500 mt-3">
          Lead times are current Australian supplier ranges taken at the pessimistic end, because a
          build is held up by the slowest one rather than the average. Confirm the real date with
          your supplier before you plan around it — bricks in particular have run far longer than
          this in tight markets.
        </p>
      </section>

      {busy && (
        <p className="flex items-center gap-2 text-xs text-slate-400 mt-3">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" aria-hidden="true" /> Saving…
        </p>
      )}
    </div>
  );
};
