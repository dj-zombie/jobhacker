"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Band } from "./types";

const BINS = 10;
const TOP = 22;
const BOTTOM = 20;

function barPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

function bandOf(mid: number, t: { strong: number; maybe: number }): Band {
  return mid >= t.strong ? "strong" : mid >= t.maybe ? "maybe" : "no";
}

/**
 * How ranked scores are spread across 0–100, with the band thresholds drawn
 * in. Bars rise in one after another on mount, then redraw as weights change
 * so a tuning move is visible in aggregate.
 */
export function ScoreHistogram({
  scores,
  thresholds,
  height = 140,
}: {
  scores: number[];
  thresholds: { strong: number; maybe: number };
  height?: number;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(320);
  const [hover, setHover] = React.useState<number | null>(null);
  const reduce = useReducedMotion();

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.max(200, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const counts = React.useMemo(() => {
    const c = new Array<number>(BINS).fill(0);
    for (const s of scores) {
      const i = Math.min(BINS - 1, Math.max(0, Math.floor(s / 10)));
      c[i] = (c[i] ?? 0) + 1;
    }
    return c;
  }, [scores]);

  const max = Math.max(1, ...counts);
  const plotH = height - TOP - BOTTOM;
  const bw = width / BINS;
  const x = (score: number) => (score / 100) * width;
  const baseline = TOP + plotH;

  const marks = [
    { key: "maybe" as const, value: thresholds.maybe, label: `Maybe ${thresholds.maybe}` },
    { key: "strong" as const, value: thresholds.strong, label: `Strong ${thresholds.strong}` },
  ];

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    setHover(Math.max(0, Math.min(BINS - 1, Math.floor(x / bw))));
  };

  return (
    <div ref={ref} className="relative w-full" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <svg width={width} height={height} className="block overflow-visible" role="img" aria-label="Score distribution">
        {[0.5, 1].map((f) => (
          <line
            key={f}
            x1={0}
            x2={width}
            y1={baseline - plotH * f}
            y2={baseline - plotH * f}
            stroke="var(--color-line)"
            strokeDasharray="2 4"
          />
        ))}

        {counts.map((n, i) => {
          const h = (n / max) * plotH;
          const band = bandOf(i * 10 + 5, thresholds);
          const d = barPath(i * bw + 1, baseline - h, bw - 2, h, 4);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: a bin's index is its identity (0–9, 10–19, …)
            <g key={i} className="origin-bottom animate-bar-rise [transform-box:fill-box]" style={{ animationDelay: `${i * 40}ms` }}>
              <motion.path
                initial={false}
                animate={{ d }}
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 30 }}
                fill={`var(--color-${band})`}
                fillOpacity={hover === null || hover === i ? 0.9 : 0.45}
                style={{ transition: "fill-opacity 150ms ease, fill 200ms ease" }}
              />
            </g>
          );
        })}

        <line x1={0} x2={width} y1={baseline} y2={baseline} stroke="var(--color-line-3)" />

        {marks.map((m, idx) => {
          const mx = x(m.value);
          const anchor = mx > width - 60 ? "end" : mx < 60 ? "start" : "middle";
          const tooClose = Math.abs(x(thresholds.strong) - x(thresholds.maybe)) < 70;
          const ly = tooClose && idx === 0 ? 20 : 10;
          return (
            <g key={m.key} style={{ transition: "transform 200ms ease" }}>
              <line
                x1={mx}
                x2={mx}
                y1={ly + 4}
                y2={baseline}
                stroke={`var(--color-${m.key})`}
                strokeOpacity={0.7}
                strokeDasharray="3 3"
              />
              <text x={mx} y={ly} textAnchor={anchor} fontSize={10} fill="var(--color-fg-2)" className="font-mono tnum uppercase tracking-wider">
                {m.label}
              </text>
            </g>
          );
        })}

        {[0, 25, 50, 75, 100].map((t) => (
          <text
            key={t}
            x={x(t)}
            y={height - 4}
            textAnchor={t === 0 ? "start" : t === 100 ? "end" : "middle"}
            fontSize={10}
            fill="var(--color-fg-4)"
            className="font-mono tnum"
          >
            {t}
          </text>
        ))}
      </svg>

      {hover !== null ? (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-line-2 border-l-brand-hi bg-surface-3 px-2 py-1 font-mono text-2xs whitespace-nowrap text-fg shadow-pop"
          style={{
            left: Math.min(width - 40, Math.max(40, hover * bw + bw / 2)),
            top: Math.max(0, baseline - ((counts[hover] ?? 0) / max) * plotH - 30),
          }}
        >
          <span className="tnum text-fg-3">
            {hover * 10}–{hover === BINS - 1 ? 100 : hover * 10 + 9}
          </span>
          <span className="ml-1.5 font-medium tnum">{counts[hover]} jobs</span>
        </div>
      ) : null}

      <table className="sr-only">
        <caption>Number of jobs in each score range</caption>
        <tbody>
          {counts.map((n, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a bin's index is its identity
            <tr key={i}>
              <th scope="row">
                {i * 10}–{i * 10 + 9}
              </th>
              <td>{n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
