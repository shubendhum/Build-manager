import { MapPin, OctagonAlert, Flag } from "lucide-react";

/**
 * The whole journey in one strip, above the road.
 *
 * The road itself is long — you have to scroll it. This is the map on the wall
 * beside it: twenty-five segments, coloured by where you have got to, with the
 * hold points marked because those are the ones you cannot drive through.
 */
export const RoadOverview = ({ steps, currentStep, onJump }) => {
  if (!steps?.length) return null;
  const done = steps.filter((s) => s.state === "done").length;
  const current = steps.find((s) => s.n === currentStep) || steps.find((s) => s.state === "current");
  const next = current ? steps.find((s) => s.n > current.n) : steps[0];

  return (
    <div data-testid="road-overview">
      <div className="flex items-end gap-[2px] h-9" role="list" aria-label="The whole build">
        {steps.map((s) => {
          const isCurrent = s.n === current?.n;
          const tone = s.behind ? "bg-red-500"
            : isCurrent ? "bg-amber-400"
              : s.state === "done" ? "bg-emerald-500"
                : s.state === "past" ? "bg-slate-500"
                  : "bg-slate-700";
          return (
            <button key={s.n} type="button" onClick={() => onJump?.(s)} role="listitem"
              title={`${s.n}. ${s.name}`} data-testid={`overview-${s.n}`}
              aria-label={`Step ${s.n}, ${s.name}`}
              className="group relative flex-1 min-w-[6px] rounded-sm transition-all duration-200 hover:opacity-100">
              <span className={`block rounded-sm ${tone} ${isCurrent ? "h-9" : s.mandatory ? "h-6" : "h-4"}`} />
              {s.mandatory && (
                <OctagonAlert className="absolute -top-3 left-1/2 -translate-x-1/2 h-3 w-3 text-red-400"
                  aria-hidden="true" />
              )}
              {isCurrent && (
                <MapPin className="absolute -top-4 left-1/2 -translate-x-1/2 h-3.5 w-3.5 text-amber-400"
                  aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mt-2 text-xs">
        <span className="text-slate-500">
          Start · <span className="text-slate-300">{done} of {steps.length} steps done</span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-slate-500">
          <Flag className="h-3 w-3" aria-hidden="true" /> Handover
        </span>
      </div>

      {(current || next) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
          {current && (
            <p className="rounded border border-amber-500/40 bg-amber-500/[0.07] px-3 py-2 text-sm"
              data-testid="overview-current">
              <span className="block text-[10px] uppercase tracking-[0.2em] text-amber-400/80 mb-0.5">
                Where you are
              </span>
              <span className="text-slate-100 break-words">{current.n}. {current.name}</span>
            </p>
          )}
          {next && (
            <p className="rounded border border-slate-700 bg-slate-800/40 px-3 py-2 text-sm"
              data-testid="overview-next">
              <span className="block text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-0.5">
                Where you go next
              </span>
              <span className="text-slate-300 break-words">{next.n}. {next.name}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
};
