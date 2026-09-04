import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  ChevronDown, CheckCircle2, Circle, MinusCircle, OctagonAlert, ShieldAlert,
  FileCheck, Stamp, Bell, ShieldCheck, Hammer, ClipboardCheck, Loader2, Package,
  HardHat, FileText, Users, FlaskConical, NotebookPen, Plug, CalendarClock, HardHat as Hat,
  ArrowRight, UserX,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import api, { formatApiErrorDetail } from "@/lib/api";
import { formatDate } from "@/lib/projectUtils";

// What kind of thing an item is, so a permit reads differently from a job you
// just do and tick. Tone is the only colour on the row — the rest stays quiet.
const KIND = {
  hold: { icon: OctagonAlert, label: "Hold point", tone: "text-red-400" },
  permit: { icon: Stamp, label: "Permit", tone: "text-violet-400" },
  inspection: { icon: ShieldAlert, label: "Inspection", tone: "text-amber-400" },
  certificate: { icon: FileCheck, label: "Certificate", tone: "text-sky-400" },
  notification: { icon: Bell, label: "Notify", tone: "text-sky-400" },
  insurance: { icon: ShieldCheck, label: "Insurance", tone: "text-violet-400" },
  order: { icon: Package, label: "Order", tone: "text-violet-400" },
  service: { icon: Plug, label: "Service", tone: "text-sky-400" },
  safety: { icon: HardHat, label: "Safety", tone: "text-amber-400" },
  document: { icon: FileText, label: "Drawings", tone: "text-slate-400" },
  meeting: { icon: Users, label: "Meeting", tone: "text-slate-400" },
  test: { icon: FlaskConical, label: "Test", tone: "text-slate-400" },
  record: { icon: NotebookPen, label: "Record", tone: "text-slate-400" },
  site: { icon: Hammer, label: "Site", tone: "text-slate-400" },
  check: { icon: ClipboardCheck, label: "Check", tone: "text-slate-400" },
};
const kindOf = (k) => KIND[k] || KIND.check;

// How a reminder reads and how loud it is.
const SEVERITY = {
  hold: { label: "Stop work", cls: "border-red-500/50 bg-red-500/10 text-red-300" },
  overdue: { label: "Overdue", cls: "border-red-500/40 bg-red-500/[0.07] text-red-300" },
  "lead-time": { label: "Start early", cls: "border-violet-500/40 bg-violet-500/[0.07] text-violet-300" },
  "due-soon": { label: "Due soon", cls: "border-amber-500/40 bg-amber-500/[0.07] text-amber-300" },
  chase: { label: "Chase", cls: "border-slate-600 bg-slate-800/40 text-slate-300" },
};

// Tapping the circle walks the item forward the way a builder would: not done,
// done, doesn't apply to this job, back to not done.
// How a package status reads on a checklist row.
const PACKAGE_STATE = {
  draft: "not sent yet", "out-for-quote": "waiting on prices", "quotes-in": "prices in, undecided",
  awarded: "awarded", ordered: "booked", "in-progress": "on site", complete: "finished",
};

const NEXT_STATUS = { todo: "done", "in-progress": "done", done: "n-a", "n-a": "todo" };
const NEEDS_REFERENCE = new Set(["permit", "certificate", "insurance", "inspection", "hold"]);
const SETTLED = new Set(["done", "n-a"]);

const StatusButton = ({ status, onClick, busy }) => {
  const done = status === "done";
  const na = status === "n-a";
  const title = done ? "Doesn't apply to this job" : na ? "Mark not done" : "Mark done";
  return (
    <button type="button" onClick={onClick} disabled={busy} title={title} aria-label={title}
      className="shrink-0 mt-0.5 p-0.5 -m-0.5 disabled:opacity-40">
      {done ? <CheckCircle2 className="h-[18px] w-[18px] text-emerald-400" aria-hidden="true" />
        : na ? <MinusCircle className="h-[18px] w-[18px] text-slate-600" aria-hidden="true" />
          : <Circle className="h-[18px] w-[18px] text-slate-500 hover:text-amber-400 transition-colors duration-200" aria-hidden="true" />}
    </button>
  );
};

const ItemRow = ({ item, onSet, busy, highlight, onGoToBoard }) => {
  const k = kindOf(item.kind);
  const Icon = k.icon;
  const settled = SETTLED.has(item.status);
  const [ref, setRef] = useState(item.reference || "");
  useEffect(() => { setRef(item.reference || ""); }, [item.reference]);

  return (
    <div id={`item-${item.action_key}`} data-testid={`item-${item.action_key}`}
      className={`px-3 sm:px-4 py-3 scroll-mt-24 ${highlight ? "bg-amber-500/10" : ""}`}>
      <div className="flex items-start gap-2.5">
        <StatusButton status={item.status} busy={busy}
          onClick={() => onSet(item.action_key, { status: NEXT_STATUS[item.status] || "done" })} />

        <span className="text-[11px] tabular-nums text-slate-600 mt-0.5 w-7 shrink-0 text-right">
          {item.n}
        </span>

        <div className="min-w-0 flex-1">
          <p className={`text-sm break-words ${
            item.status === "done" ? "text-slate-400 line-through"
              : item.status === "n-a" ? "text-slate-600 line-through" : "text-slate-100"}`}>
            {item.name}
          </p>

          {item.sub?.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {item.sub.map((s) => (
                <li key={s} className="text-xs text-slate-400 break-words pl-3 relative">
                  <span className="absolute left-0 top-[7px] h-1 w-1 rounded-full bg-slate-600" />
                  {s}
                </li>
              ))}
            </ul>
          )}

          {item.note && (
            <p className="mt-1.5 text-xs text-amber-400/90 break-words">{item.note}</p>
          )}

          {/* A trade does this. You confirm it here; you act on it from the
              board, so the row is shown but not operated. */}
          {item.trade && (
            <p className="mt-1.5" data-testid={`trade-${item.action_key}`}>
              {item.trade.package ? (
                <button type="button" onClick={() => onGoToBoard(item.trade.package.id)}
                  className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-amber-400 transition-colors duration-200">
                  <Hat className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="break-words">{item.trade.package.title}</span>
                  <span className="text-slate-600">·</span>
                  <span>{PACKAGE_STATE[item.trade.package.status] || item.trade.package.status}</span>
                  <ArrowRight className="h-3 w-3 shrink-0" aria-hidden="true" />
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs text-red-400">
                  <UserX className="h-3 w-3 shrink-0" aria-hidden="true" />
                  {item.trade.work} — nobody booked
                </span>
              )}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider ${k.tone}`}>
              <Icon className="h-3 w-3" aria-hidden="true" /> {k.label}
            </span>

            {!settled && (
              <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
                <CalendarClock className="h-3 w-3" aria-hidden="true" />
                <span className="sr-only">Due date for {item.name}</span>
                <input type="date" value={item.due_date || ""}
                  data-testid={`due-${item.action_key}`}
                  onChange={(e) => onSet(item.action_key, { due_date: e.target.value })}
                  className="bg-slate-800/50 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-slate-300 focus:border-amber-500/60 outline-none" />
              </label>
            )}

            {NEEDS_REFERENCE.has(item.kind) && (
              <Input value={ref} onChange={(e) => setRef(e.target.value)}
                onBlur={() => ref !== (item.reference || "") && onSet(item.action_key, { reference: ref })}
                placeholder="Number / reference"
                aria-label={`Reference number for ${item.name}`}
                data-testid={`ref-${item.action_key}`}
                className="h-7 w-full sm:w-44 bg-slate-800/50 border-slate-600 text-xs" />
            )}

            {item.completed_at && (
              <span className="text-[11px] text-slate-500">done {formatDate(item.completed_at)}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const PhaseCard = ({ phase, onSet, busy, highlight, openAll, onGoToBoard }) => {
  const { current, hold } = phase;
  const [open, setOpen] = useState(current || hold);
  useEffect(() => { if (openAll !== null) setOpen(openAll); }, [openAll]);
  // The phase you are up to opens itself, so the screen lands where you work.
  useEffect(() => { if (current) setOpen(true); }, [current]);

  const border = phase.hold ? "border-red-500/50 bg-red-500/[0.04]"
    : phase.current ? "border-amber-500/60 bg-amber-500/[0.04]"
      : "border-slate-700 bg-card";

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className={`rounded-md border overflow-hidden ${border}`} data-testid={`phase-${phase.key}`}>
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center gap-3 px-3 sm:px-4 py-3 text-left hover:bg-slate-800/40 transition-colors duration-200">
            <ChevronDown className={`h-4 w-4 text-slate-500 shrink-0 transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
              aria-hidden="true" />
            <span className={`font-heading text-lg font-bold w-6 shrink-0 text-center ${
              phase.hold ? "text-red-400"
                : phase.complete ? "text-emerald-400"
                  : phase.current ? "text-amber-400" : "text-slate-500"}`}>
              {phase.letter}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-slate-100 break-words">{phase.name}</span>
              <span className="block text-xs text-slate-500">
                {phase.done}/{phase.total} done
                {phase.trades.length > 0 && ` · ${phase.trades.length - phase.unbooked}/${phase.trades.length} trades on the board`}
              </span>
            </span>
            {phase.unbooked > 0 && (
              <Badge variant="outline"
                className="shrink-0 bg-red-500/15 text-red-400 border-red-500/50 uppercase tracking-wider text-[10px]">
                {phase.unbooked} not booked
              </Badge>
            )}
            {phase.current && (
              <Badge className="shrink-0 bg-amber-500 text-slate-950 hover:bg-amber-500 uppercase tracking-wider text-[10px]">
                You are here
              </Badge>
            )}
            {phase.complete && !phase.current && (
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" aria-hidden="true" />
            )}
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t border-slate-800">
            <p className="px-3 sm:px-4 py-2.5 text-xs text-slate-400 break-words">{phase.detail}</p>
            {phase.trades.length > 0 && (
              <div className="px-3 sm:px-4 pb-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-1.5">
                  Trades this phase needs
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {phase.trades.map((t) => (
                    t.package ? (
                      <button key={t.key} type="button" onClick={() => onGoToBoard(t.package.id)}
                        data-testid={`phase-trade-${t.key}`}
                        className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-800/40 px-2 py-1 text-xs text-slate-300 hover:border-amber-500/50 hover:text-amber-400 transition-colors duration-200">
                        <Hat className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span className="break-words">{t.work}</span>
                      </button>
                    ) : (
                      <span key={t.key} data-testid={`phase-trade-${t.key}`}
                        className="inline-flex items-center gap-1.5 rounded border border-red-500/40 bg-red-500/[0.07] px-2 py-1 text-xs text-red-400">
                        <UserX className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span className="break-words">{t.work}</span>
                      </span>
                    )
                  ))}
                </div>
              </div>
            )}
            <div className="divide-y divide-slate-800 border-t border-slate-800">
              {phase.items.map((i) => (
                <ItemRow key={i.action_key} item={i} onSet={onSet} busy={busy}
                  highlight={highlight === i.action_key} onGoToBoard={onGoToBoard} />
              ))}
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
};

/**
 * The supervisor's checklist, phase A to O. Everything on a build that has no
 * tradie behind it — permits, consents, the checks before something is covered
 * up, the mandatory hold points, the certificates collected on the way out.
 */
export const BuildStepsTab = ({ projectId, onGoToBoard }) => {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [highlight, setHighlight] = useState(null);
  const [openAll, setOpenAll] = useState(null);

  const fetchSteps = useCallback(async () => {
    try {
      const { data: d } = await api.get(`/projects/${projectId}/steps`);
      setData(d);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Could not load the checklist.");
    }
  }, [projectId]);

  useEffect(() => { fetchSteps(); }, [fetchSteps]);

  const set = async (actionKey, patch) => {
    setBusy(true);
    try {
      const { data: d } = await api.put(`/projects/${projectId}/steps/${actionKey}`, patch);
      setData(d);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Could not save that.");
    } finally {
      setBusy(false);
    }
  };

  // Tapping a reminder opens its phase and walks you to the row.
  const jumpTo = (r) => {
    setOpenAll(true);
    setHighlight(r.action_key);
    setTimeout(() => {
      document.getElementById(`item-${r.action_key}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
    setTimeout(() => setHighlight(null), 2500);
  };

  if (!data) return <p className="text-sm text-slate-400">Loading the checklist…</p>;
  const pct = data.items_total ? Math.round((data.items_done / data.items_total) * 100) : 0;
  const holds = data.hold_points || [];

  return (
    <div data-testid="build-steps-tab">
      {holds.length > 0 && (
        <section className="rounded-md border border-red-500/50 bg-red-500/10 p-4 mb-4"
          data-testid="hold-point-banner">
          <p className="flex items-center gap-2 font-heading text-sm font-bold text-red-300 uppercase tracking-wider mb-2">
            <OctagonAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            Mandatory hold point — do not proceed
          </p>
          {holds.map((h) => (
            <button key={h.action_key} onClick={() => jumpTo(h)}
              data-testid={`hold-${h.action_key}`}
              className="block w-full text-left text-sm text-red-200 hover:text-white break-words py-0.5 transition-colors duration-200">
              {h.n}. {h.name}
            </button>
          ))}
        </section>
      )}

      <section className="rounded-md border border-slate-700 bg-card p-4 sm:p-5 mb-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-0.5">Your checklist</p>
            <h2 className="font-heading text-lg font-bold text-slate-100 break-words">
              {data.current_phase_name || "All phases complete"}
            </h2>
          </div>
          <span className="font-heading font-bold text-amber-400 tabular-nums shrink-0">
            {data.items_done}/{data.items_total}
          </span>
        </div>
        <Progress value={pct} className="h-2.5 bg-slate-700" />
        <p className="text-xs text-slate-500 mt-2">
          Everything here is a confirmation — you tick it. The work itself is actioned on the board,
          and each item that a trade delivers shows the row it belongs to. Your stamped permit
          drawings and the inspection schedule on the permit take priority over anything here.
        </p>

        {data.unbooked_trades?.length > 0 && (
          <div className="mt-4 pt-3 border-t border-slate-700/70" data-testid="unbooked-summary">
            <p className="flex flex-wrap items-center gap-2 text-sm text-red-300 mb-2">
              <UserX className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                <b className="font-heading">{data.unbooked_trades.length}</b> pieces of trade work
                have nobody booked
              </span>
            </p>
            <p className="text-xs text-slate-400 mb-2 break-words">
              {data.unbooked_trades.map((u) => u.work).join(" · ")}
            </p>
            <button type="button" onClick={() => onGoToBoard()}
              data-testid="go-book-trades"
              className="inline-flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 transition-colors duration-200">
              Add them on the board <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}
      </section>

      {data.reminders?.length > 0 && (
        <section className="rounded-md border border-slate-700 bg-card p-4 sm:p-5 mb-4"
          data-testid="reminders">
          <div className="flex items-baseline justify-between gap-2 mb-3">
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Act on today</p>
            {data.reminder_count > data.reminders.length && (
              <span className="text-[11px] text-slate-500">
                showing {data.reminders.length} of {data.reminder_count}
              </span>
            )}
          </div>
          <div className="space-y-1.5">
            {data.reminders.map((r) => {
              const sev = SEVERITY[r.severity] || SEVERITY.chase;
              const Icon = kindOf(r.kind).icon;
              return (
                <button key={r.action_key} onClick={() => jumpTo(r)}
                  data-testid={`reminder-${r.action_key}`}
                  className={`w-full flex flex-wrap items-center gap-2 rounded border px-2.5 py-2 text-left transition-colors duration-200 hover:border-amber-500/50 ${sev.cls}`}>
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="text-[10px] uppercase tracking-wider font-bold shrink-0 w-[68px]">
                    {sev.label}
                  </span>
                  <span className="min-w-0 flex-1 text-xs text-slate-200 break-words">
                    {r.n}. {r.name}
                  </span>
                  <span className="text-[11px] opacity-80 shrink-0 w-full sm:w-auto sm:text-right">
                    {r.why}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">The whole build, A to O</p>
        <div className="flex items-center gap-3">
          {busy && (
            <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <Loader2 className="h-3 w-3 animate-spin text-amber-400" aria-hidden="true" /> Saving
            </span>
          )}
          <button data-testid="toggle-all" onClick={() => setOpenAll(openAll === true ? false : true)}
            className="text-[11px] text-slate-400 hover:text-amber-400 transition-colors duration-200">
            {openAll === true ? "Collapse all" : "Expand all"}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {data.phases.map((p) => (
          <PhaseCard key={p.key} phase={p} onSet={set} busy={busy}
            highlight={highlight} openAll={openAll} onGoToBoard={onGoToBoard} />
        ))}
      </div>

      <section className="rounded-md border border-slate-700 bg-card p-4 sm:p-5 mt-4"
        data-testid="ongoing-practices">
        <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-1">Every day, every stage</p>
        <p className="text-xs text-slate-400 mb-3">
          These run for the whole job, so there is nothing to tick — just things to keep doing.
        </p>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {data.ongoing?.map((o) => (
            <li key={o} className="text-xs text-slate-300 break-words pl-3 relative">
              <span className="absolute left-0 top-[7px] h-1 w-1 rounded-full bg-amber-500/70" />
              {o}
            </li>
          ))}
        </ul>
        {data.footnote && (
          <p className="text-xs text-slate-500 mt-3 pt-3 border-t border-slate-800 break-words">
            {data.footnote}
          </p>
        )}
      </section>
    </div>
  );
};
