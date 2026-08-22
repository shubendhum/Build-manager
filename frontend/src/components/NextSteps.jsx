import { AlertTriangle, CircleDot, ArrowRight, Check, ListChecks } from "lucide-react";

const SEVERITY = {
  urgent: {
    icon: AlertTriangle,
    tone: "text-red-400",
    border: "border-red-500/40 hover:border-red-500/70",
    label: "Needs attention",
  },
  decision: {
    icon: CircleDot,
    tone: "text-amber-400",
    border: "border-amber-500/40 hover:border-amber-500/70",
    label: "Your call",
  },
  todo: {
    icon: CircleDot,
    tone: "text-sky-400",
    border: "border-slate-700 hover:border-sky-500/60",
    label: "Next step",
  },
};

const ActionRow = ({ action, onGo }) => {
  const s = SEVERITY[action.severity] || SEVERITY.todo;
  const Icon = s.icon;
  return (
    <button type="button" data-testid={`next-step-${action.id}`} onClick={() => onGo(action.tab)}
      className={`w-full text-left flex items-start gap-3 rounded-md border bg-slate-800/40 px-4 py-3 transition-colors duration-200 ${s.border}`}>
      <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${s.tone}`} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-100">{action.title}</span>
        {action.detail && <span className="block text-xs text-slate-400 mt-0.5">{action.detail}</span>}
      </span>
      <span className="shrink-0 inline-flex items-center gap-1 text-xs text-slate-500 mt-0.5">
        <span className="hidden sm:inline uppercase tracking-wider text-[10px]">{s.label}</span>
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </span>
    </button>
  );
};

export const NextSteps = ({ data, onGo }) => {
  if (!data) return null;
  const { actions = [], done = [] } = data;

  return (
    <section className="rounded-md border border-slate-700 bg-card p-5 mb-6" data-testid="next-steps">
      <div className="flex items-center gap-2 mb-4">
        <ListChecks className="h-4 w-4 text-amber-400" aria-hidden="true" />
        <h2 className="font-heading text-lg font-bold uppercase tracking-wider text-slate-100">
          What to do next
        </h2>
        {actions.length > 0 && (
          <span className="text-xs text-slate-500" data-testid="next-steps-count">{actions.length}</span>
        )}
      </div>

      {actions.length === 0 ? (
        <p className="text-sm text-slate-400 py-2" data-testid="next-steps-clear">
          Nothing waiting on you right now.
        </p>
      ) : (
        <div className="space-y-2">
          {actions.map((a) => <ActionRow key={a.id} action={a} onGo={onGo} />)}
        </div>
      )}

      {done.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-4 pt-3 border-t border-slate-700/70"
          data-testid="next-steps-done">
          {done.map((d) => (
            <span key={d} className="inline-flex items-center gap-1.5 text-xs text-slate-500">
              <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" /> {d}
            </span>
          ))}
        </div>
      )}
    </section>
  );
};
