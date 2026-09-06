import { useState, useEffect, useRef, useMemo } from "react";
import {
  CheckCircle2, OctagonAlert, Flag, MapPin, Truck, Ruler, HardHat,
} from "lucide-react";

/**
 * The build drawn as a road you travel down.
 *
 * A list of dates tells you what is planned. It does not tell you where you
 * are, and that is the question a builder actually has. So the sequence is a
 * road: what you have driven is sealed behind you, where you stand is marked,
 * and what is ahead is still unmade. Distance down the page is time, which is
 * what makes the material signposts work — a truss order sits on the road at
 * the date it has to be placed, and if that marker is behind you, you are late
 * and can see it without reading a single number.
 *
 * The road winds on a wide screen because a straight line reads as a list. On a
 * phone it straightens into a single rail and every card sits to its right,
 * since there is no room to wind and a builder is holding the thing one-handed.
 */

// Room per step: long steps get more road, but never so little that two markers
// collide or so much that the frame scrolls forever.
const PX_PER_DAY = 7;
const MIN_ROW = 92;
const MAX_ROW = 168;
const TOP_PAD = 28;
const BOTTOM_PAD = 44;

const ROAD_W = 30;          // the sealed road
const NODE_R = 15;          // milestone marker
const CARD_H = 30;          // half-height a milestone card claims
const SIGN_H = 20;          // half-height a signpost claims

const shortDate = (iso) => new Date(`${iso}T00:00:00`)
  .toLocaleDateString("en-AU", { day: "numeric", month: "short" });

const STATE = {
  done: { road: "#10b981", node: "#10b981", ring: "#10b981", text: "text-slate-400" },
  past: { road: "#334155", node: "#475569", ring: "#475569", text: "text-slate-300" },
  current: { road: "#f59e0b", node: "#f59e0b", ring: "#f59e0b", text: "text-slate-100" },
  ahead: { road: "#1e293b", node: "#0f172a", ring: "#334155", text: "text-slate-400" },
};

const ORDER_TONE = {
  overdue: { dot: "#ef4444", cls: "border-red-500/50 bg-red-500/10 text-red-300" },
  "order-now": { dot: "#f59e0b", cls: "border-amber-500/50 bg-amber-500/10 text-amber-300" },
  soon: { dot: "#a78bfa", cls: "border-violet-500/40 bg-violet-500/10 text-violet-300" },
  later: { dot: "#475569", cls: "border-slate-700 bg-slate-800/40 text-slate-400" },
  sequenced: { dot: "#38bdf8", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
};

/** Measure the container, because the road is drawn in real pixels. */
function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    setW(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** A smooth road through the milestone points, not a zig-zag between them. */
function roadPath(points) {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y - TOP_PAD}`;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (i === 0) { d += ` L ${p.x} ${p.y}`; continue; }
    const q = points[i - 1];
    const mid = (q.y + p.y) / 2;
    d += ` C ${q.x} ${mid}, ${p.x} ${mid}, ${p.x} ${p.y}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y + BOTTOM_PAD}`;
  return d;
}

export const BuildRoad = ({ steps, orders, today, onStepClick }) => {
  const [ref, measured] = useWidth();
  const width = measured || 720;                 // a sane frame before measuring
  const narrow = width < 640;

  const rowFor = (s) => Math.min(MAX_ROW, Math.max(MIN_ROW, s.days * PX_PER_DAY));

  const layout = useMemo(() => {
    // On a phone there is one column, so an order cannot sit beside the road —
    // it takes its own place in the queue instead, which reads the way the job
    // runs: order the trusses, then later, put the frame up.
    if (narrow) {
      // Steps stay in sequence order — a step that runs alongside another
      // starts later than the one after it, and renumbering 22, 23, 21 reads
      // as a fault. Orders slot in ahead of the first step they precede.
      const queue = [...orders].sort((a, b) => a.order_by.localeCompare(b.order_by));
      const merged = [];
      for (const step of steps) {
        while (queue.length && queue[0].order_by <= step.start) {
          merged.push({ kind: "order", order: queue.shift() });
        }
        merged.push({ kind: "step", step });
      }
      for (const order of queue) merged.push({ kind: "order", order });

      let y = TOP_PAD;
      const rows = merged.map((m) => {
        const h = m.kind === "step" ? rowFor(m.step) : 44;
        const row = { ...m, top: y, height: h, y: y + h / 2, x: 30 };
        y += h;
        return row;
      });
      const nodes = rows.filter((r) => r.kind === "step")
        .map((r, i) => ({ ...r, i }));
      const inline = rows.filter((r) => r.kind === "order")
        .map((r) => ({ order: r.order, y: r.y, side: "right", at: { x: 30 } }));
      return { nodes, inline, total: y, cx: 30, narrow };
    }

    const cx = width / 2;
    const amp = Math.min(130, width * 0.17);
    let y = TOP_PAD;
    const nodes = steps.map((step, i) => {
      const h = rowFor(step);
      const top = y;
      const centre = y + h / 2;
      y += h;
      return {
        step, i, top, height: h, y: centre,
        x: Math.round(cx + amp * Math.sin(i * 0.55)),
      };
    });
    return { nodes, inline: null, total: y, cx, narrow };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, orders, width, narrow]);

  const { nodes, total } = layout;

  // Distance down the road is time, so any date can be placed on it.
  const yForDate = useMemo(() => (iso) => {
    const t = Date.parse(`${iso}T00:00:00`);
    if (Number.isNaN(t)) return null;
    for (const n of nodes) {
      const a = Date.parse(`${n.step.start}T00:00:00`);
      const b = Date.parse(`${n.step.finish}T00:00:00`);
      if (t <= b) {
        if (t <= a) return n.top;
        return n.top + ((t - a) / Math.max(1, b - a)) * n.height;
      }
    }
    return total;
  }, [nodes, total]);

  const sideOf = (n) => (narrow ? "right" : n.x < layout.cx ? "right" : "left");

  // Signposts sit on the road at the date the order has to be placed, which is
  // the whole point of them — but two orders a week apart, or an order beside a
  // milestone card, would land on top of each other. So each one is nudged to
  // the nearest free slot, preferring the side away from the card next to it,
  // and falling back to the other side before it moves far from its date.
  const signs = useMemo(() => {
    if (layout.inline) return layout.inline;      // already in the queue
    const taken = { left: [], right: [] };
    for (const n of nodes) {
      taken[sideOf(n)].push([n.y - CARD_H, n.y + CARD_H]);
    }
    const free = (side, y) =>
      !taken[side].some(([a, b]) => y + SIGN_H > a && y - SIGN_H < b);

    const placed = [];
    for (const o of [...orders].sort((a, b) => a.order_by.localeCompare(b.order_by))) {
      const ideal = yForDate(o.order_by);
      if (ideal == null) continue;
      const at = nodes.find((n) => ideal >= n.top && ideal < n.top + n.height) || nodes[0];
      const first = narrow ? "right" : sideOf(at) === "right" ? "left" : "right";
      const sides = narrow ? ["right"] : [first, first === "left" ? "right" : "left"];

      let put = null;
      for (const side of sides) {
        for (let d = 0; d <= 120 && !put; d += 6) {
          for (const y of d === 0 ? [ideal] : [ideal + d, ideal - d]) {
            if (y >= 0 && y <= total && free(side, y)) { put = { side, y }; break; }
          }
        }
        if (put) break;
      }
      // Nowhere clean: sit it below everything rather than on top of something.
      if (!put) {
        const side = sides[0];
        const lowest = Math.max(ideal, ...taken[side].map(([, b]) => b));
        put = { side, y: lowest + SIGN_H + 4 };
      }
      taken[put.side].push([put.y - SIGN_H, put.y + SIGN_H]);
      placed.push({ order: o, y: put.y, side: put.side, at });
    }
    return placed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, yForDate, nodes, narrow, total, layout.cx, layout.inline]);

  const todayY = yForDate(today);
  const path = roadPath(nodes);
  if (!nodes.length) return null;

  /** How much room there is beside the road at x, on the given side. */
  const roomBeside = (x, right) =>
    Math.max(120, (right ? width - x : x) - NODE_R - 22);

  return (
    <div ref={ref} className="relative w-full" style={{ height: total + BOTTOM_PAD }}
      data-testid="build-road">
      <svg width={width} height={total + BOTTOM_PAD} className="absolute inset-0"
        aria-hidden="true">
        <defs>
          {/* The road ahead is unmade: same line, drawn hollow. */}
          <linearGradient id="road-done" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.55" />
          </linearGradient>
        </defs>

        {/* Unmade road: the whole route, faint. */}
        <path d={path} fill="none" stroke="#1e293b" strokeWidth={ROAD_W}
          strokeLinecap="round" />
        <path d={path} fill="none" stroke="#0f172a" strokeWidth={ROAD_W - 6}
          strokeLinecap="round" />
        <path d={path} fill="none" stroke="#334155" strokeWidth="2"
          strokeLinecap="round" strokeDasharray="9 13" opacity="0.8" />

        {/* Sealed road: everything up to where you stand. */}
        {todayY != null && (
          <>
            <clipPath id="road-behind">
              <rect x="0" y="0" width={width} height={Math.max(0, todayY)} />
            </clipPath>
            <g clipPath="url(#road-behind)">
              <path d={path} fill="none" stroke="url(#road-done)" strokeWidth={ROAD_W}
                strokeLinecap="round" />
              <path d={path} fill="none" stroke="#0f172a" strokeWidth="2"
                strokeLinecap="round" strokeDasharray="10 12" opacity="0.7" />
            </g>
          </>
        )}

        {/* Leader lines out to each milestone's card. */}
        {nodes.map((n) => {
          const right = sideOf(n) === "right";
          const to = right ? n.x + NODE_R + 14 : n.x - NODE_R - 14;
          return (
            <line key={`l${n.step.n}`} x1={right ? n.x + NODE_R : n.x - NODE_R} y1={n.y}
              x2={to} y2={n.y} stroke="#334155" strokeWidth="1.5" />
          );
        })}

        {/* Where you are, drawn across the road. */}
        {todayY != null && todayY > 0 && todayY < total && (
          <line x1="0" y1={todayY} x2={width} y2={todayY}
            stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="5 5" opacity="0.65" />
        )}
      </svg>

      {/* ---- milestones ------------------------------------------------- */}
      {nodes.map((n) => {
        const s = n.step;
        const tone = STATE[s.state] || STATE.ahead;
        const right = sideOf(n) === "right";
        const hold = s.mandatory;
        const finish = n.i === nodes.length - 1;
        return (
          <div key={s.n}>
            {/* the marker on the road */}
            <button type="button" onClick={() => onStepClick?.(s)}
              data-testid={`road-node-${s.n}`}
              title={`${s.name} · ${shortDate(s.start)} – ${shortDate(s.finish)}`}
              style={{ left: n.x, top: n.y }}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full flex items-center justify-center
                         font-heading text-[11px] font-bold tabular-nums transition-transform duration-200
                         hover:scale-110 focus:outline-none focus:ring-2 focus:ring-amber-400"
              aria-label={`Step ${s.n}, ${s.name}`}>
              <span className={`flex items-center justify-center rounded-full border-2 ${
                s.behind ? "border-red-500 bg-red-950 text-red-300"
                  : hold ? "border-red-500/80 bg-slate-950 text-red-300"
                    : s.state === "done" ? "border-emerald-500 bg-emerald-950 text-emerald-300"
                      : s.state === "current" ? "border-amber-400 bg-amber-950 text-amber-300"
                        : "border-slate-600 bg-slate-900 text-slate-400"}`}
                style={{ width: NODE_R * 2, height: NODE_R * 2 }}>
                {finish ? <Flag className="h-4 w-4" aria-hidden="true" />
                  : hold ? <OctagonAlert className="h-4 w-4" aria-hidden="true" />
                    : s.state === "done" ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      : s.n}
              </span>
              {s.state === "current" && (
                <span className="absolute inset-0 rounded-full border-2 border-amber-400/60 animate-ping"
                  aria-hidden="true" />
              )}
            </button>

            {/* the card beside it */}
            <div style={{
              top: n.y,
              left: right ? n.x + NODE_R + 14 : undefined,
              right: right ? undefined : width - (n.x - NODE_R - 14),
              maxWidth: roomBeside(n.x, right),
            }}
              className={`absolute -translate-y-1/2 rounded bg-card px-1 ${right ? "" : "text-right"}`}>
              <p className={`text-sm font-medium leading-tight break-words ${tone.text}`}>
                {s.name}
              </p>
              <p className="text-[11px] text-slate-500 tabular-nums">
                {shortDate(s.start)} – {shortDate(s.finish)} · {s.days}d
                {s.parallel && " · alongside"}
              </p>
              {s.state === "current" && (
                <span className="inline-flex items-center gap-1 mt-1 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-950">
                  <MapPin className="h-3 w-3" aria-hidden="true" /> You are here
                </span>
              )}
              {s.behind && s.state !== "current" && (
                <span className="inline-block mt-1 rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-300">
                  Behind
                </span>
              )}
              {hold && (
                <span className="inline-block mt-1 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-300">
                  Hold point
                </span>
              )}
              {s.packages.length > 0 && (
                <p className="text-[11px] text-slate-500 break-words mt-0.5">
                  <HardHat className="h-3 w-3 inline mr-1 -mt-0.5" aria-hidden="true" />
                  {s.packages.map((p) => p.title).join(", ")}
                </p>
              )}
            </div>
          </div>
        );
      })}

      {/* ---- material signposts, on the road at their order-by date ------ */}
      {signs.map(({ order: o, y, side, at }) => {
        const tone = ORDER_TONE[o.status] || ORDER_TONE.later;
        const right = side === "right";
        const Icon = o.measured_on_site ? Ruler : Truck;
        return (
          <div key={o.key} style={{
            top: y,
            left: right ? at.x + NODE_R + 14 : undefined,
            right: right ? undefined : width - (at.x - NODE_R - 14),
            maxWidth: Math.min(narrow ? 999 : 220, roomBeside(at.x, right)),
          }}
            data-testid={`road-order-${o.key}`}
            className="absolute -translate-y-1/2 rounded bg-card">
            <span className={`flex max-w-full items-center gap-1.5 rounded border px-1.5 py-1 text-[11px] leading-tight ${tone.cls}`}>
              <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">
                {o.measured_on_site ? "Measure" : "Order"} {o.name}
              </span>
              <span className="opacity-70 tabular-nums shrink-0">{shortDate(o.order_by)}</span>
            </span>
          </div>
        );
      })}

      {/* ---- today ------------------------------------------------------- */}
      {todayY != null && todayY > 0 && todayY < total && (
        <span style={{ top: todayY, left: narrow ? 8 : 4 }}
          data-testid="road-today"
          className="absolute -translate-y-1/2 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-950">
          Today
        </span>
      )}
    </div>
  );
};
