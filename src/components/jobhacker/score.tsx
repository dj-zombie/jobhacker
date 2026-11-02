"use client";

import * as React from "react";
import { animate, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import type { Band } from "./types";

export const BAND_LABEL: Record<Band, string> = {
  strong: "Strong match",
  maybe: "Possible match",
  no: "Weak match",
};

export const BAND_SHORT: Record<Band, string> = { strong: "Strong", maybe: "Maybe", no: "Weak" };

const PILL: Record<Band, string> = {
  strong: "bg-strong-wash text-strong ring-strong/20",
  maybe: "bg-maybe-wash text-maybe ring-maybe/20",
  no: "bg-no-wash text-no ring-no/15",
};
const DOT: Record<Band, string> = { strong: "bg-strong", maybe: "bg-maybe", no: "bg-no" };
export const BAND_TEXT: Record<Band, string> = { strong: "text-strong", maybe: "text-maybe", no: "text-no" };

/** Compact score readout for rows and lists. */
export function ScorePill({
  score,
  band,
  size = "md",
  className,
}: {
  score: number;
  band: Band;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      title={`${score} · ${BAND_LABEL[band]}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-semibold tnum ring-1 ring-inset",
        size === "sm" ? "h-5 px-1.5 text-2xs" : "h-6 px-2 text-xs",
        PILL[band],
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", DOT[band])} />
      {score}
    </span>
  );
}

export function BandDot({ band, className }: { band: Band; className?: string }) {
  return <span className={cn("inline-block size-2 rounded-full", DOT[band], className)} />;
}

/**
 * Counts from the previous value to the new one. Starts from `startFrom` on
 * first mount (pass 0 for a count-up), otherwise from the current value.
 */
export function AnimatedNumber({
  value,
  startFrom,
  className,
  format = (n: number) => String(Math.round(n)),
}: {
  value: number;
  startFrom?: number;
  className?: string;
  format?: (n: number) => string;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const from = React.useRef(startFrom ?? value);
  const reduce = useReducedMotion();
  const initialText = React.useRef(format(from.current));
  const fmt = React.useRef(format);
  fmt.current = format;

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce || from.current === value) {
      el.textContent = fmt.current(value);
      from.current = value;
      return;
    }
    const controls = animate(from.current, value, {
      duration: 0.7,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        el.textContent = fmt.current(v);
      },
    });
    from.current = value;
    return () => controls.stop();
  }, [value, reduce]);

  return (
    <span ref={ref} className={className}>
      {initialText.current}
    </span>
  );
}

/** The score as a ring. Draws in on mount and sweeps to each new value. */
export function ScoreRing({
  score,
  band,
  size = 108,
  stroke = 8,
  className,
}: {
  score: number;
  band: Band;
  size?: number;
  stroke?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, score));
  const offset = c * (1 - clamped / 100);
  const color = `var(--color-${band})`;

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Score ${score} of 100, ${BAND_LABEL[band]}`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-surface-4)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: offset }}
          transition={reduce ? { duration: 0 } : { duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          style={{
            filter: `drop-shadow(0 0 7px color-mix(in oklab, ${color} 45%, transparent))`,
            transition: "stroke 300ms ease",
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <AnimatedNumber
          value={score}
          startFrom={0}
          className="text-3xl font-semibold leading-none tracking-tighter tnum text-fg"
        />
        <span className="mt-1 text-2xs text-fg-3">of 100</span>
      </div>
    </div>
  );
}
