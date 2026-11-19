"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import type { DimensionRow } from "./types";

/**
 * A 0–5 bar with a chamfered tip. The fill is full width and slides in from the
 * left (transform only), so the tip keeps its shape at every value.
 */
function Meter({ value, index }: { value: number | null; index: number }) {
  const reduce = useReducedMotion();
  if (value == null) {
    return (
      <div className="flex h-1.5 items-center">
        <div className="h-px w-full border-t border-dashed border-line-3" />
      </div>
    );
  }
  return (
    <div className="h-1.5 overflow-hidden bg-surface-4">
      <motion.div
        className="h-full bg-linear-to-r from-brand-lo to-brand-hi [clip-path:polygon(0_0,100%_0,calc(100%-6px)_100%,0_100%)]"
        initial={{ x: "-100%" }}
        animate={{ x: `${(value / 5 - 1) * 100}%` }}
        transition={reduce ? { duration: 0 } : { duration: 0.64, ease: [0.16, 1, 0.3, 1], delay: index * 0.04 }}
      />
    </div>
  );
}

/**
 * The "why it's here" table: each dimension's 0–5 score, its weight, the
 * points it contributed, and the model's reason in full. Below 448px wide it drops
 * the weight column and the header row.
 * Bars slide in one after another; a hovered row locks corner brackets on.
 */
export function DimensionBreakdown({
  rows,
  formula,
  className,
}: {
  rows: DimensionRow[];
  formula?: string;
  className?: string;
}) {
  return (
    <div className={cn("@container", className)}>
      <div className="hud-label mb-1 hidden grid-cols-[96px_1fr_44px_40px_48px] gap-3 px-1 tracking-wide text-fg-4 @md:grid">
        <span>Dimension</span>
        <span>Fit</span>
        <span>Score</span>
        <span>Weight</span>
        <span className="text-right">Points</span>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((row, index) => {
          return (
            <li key={row.key}>
              <div className="group hud-corners relative w-full rounded-md px-1 py-2.5 transition-colors hover:hud-on hover:bg-surface-2/60 hover:row-wash [--hud-x:-2px] [--hud-y:0px]">
                <div className="grid grid-cols-[76px_minmax(0,1fr)_32px_36px] items-center gap-2.5 @md:grid-cols-[96px_1fr_44px_40px_48px] @md:gap-3">
                  <span className="text-sm font-medium text-fg-2">{row.label}</span>
                  <Meter value={row.score} index={index} />
                  <span className="text-sm tnum text-fg">
                    {row.score ?? "—"}
                    <span className="text-fg-4">/5</span>
                  </span>
                  <span className="hidden text-xs tnum text-fg-3 @md:block">×{row.weight}</span>
                  <span
                    className={cn(
                      "text-right text-sm font-medium tnum",
                      row.points == null ? "text-fg-4" : "text-fg",
                    )}
                  >
                    {row.points == null ? "n/a" : `+${row.points}`}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-pretty text-fg-3 @md:pl-[108px]">{row.reason}</p>
              </div>
            </li>
          );
        })}
      </ul>
      {formula ? <p className="mt-3 border-t border-line px-1 pt-3 text-xs tnum text-fg-3">{formula}</p> : null}
    </div>
  );
}
