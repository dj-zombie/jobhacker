"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";
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
 * points it contributed, and the model's reason (click a row to expand it).
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
  const [open, setOpen] = React.useState<string | null>(null);

  return (
    <div className={className}>
      <div className="hud-label mb-1 hidden grid-cols-[96px_1fr_44px_40px_48px] gap-3 px-1 tracking-wide text-fg-4 sm:grid">
        <span>Dimension</span>
        <span>Fit</span>
        <span>Score</span>
        <span>Weight</span>
        <span className="text-right">Points</span>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((row, index) => {
          const expanded = open === row.key;
          return (
            <li key={row.key}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : row.key)}
                className="group hud-corners relative w-full rounded-md px-1 py-2.5 text-left transition-colors hover:hud-on hover:bg-surface-2/60 hover:row-wash [--hud-x:-2px] [--hud-y:0px]"
              >
                <div className="grid grid-cols-[88px_1fr_40px] items-center gap-3 sm:grid-cols-[96px_1fr_44px_40px_48px]">
                  <span className="flex items-center gap-1 text-sm font-medium text-fg-2">
                    {row.label}
                    <ChevronDown
                      className={cn(
                        "size-3 text-fg-4 transition-transform duration-200",
                        expanded && "rotate-180 text-fg-3",
                      )}
                    />
                  </span>
                  <Meter value={row.score} index={index} />
                  <span className="text-sm tnum text-fg">
                    {row.score ?? "—"}
                    <span className="text-fg-4">/5</span>
                  </span>
                  <span className="hidden text-xs tnum text-fg-3 sm:block">×{row.weight}</span>
                  <span
                    className={cn(
                      "hidden text-right text-sm font-medium tnum sm:block",
                      row.points == null ? "text-fg-4" : "text-fg",
                    )}
                  >
                    {row.points == null ? "n/a" : `+${row.points}`}
                  </span>
                </div>
                <p
                  className={cn(
                    "mt-1.5 text-xs leading-relaxed text-fg-3 sm:pl-[108px]",
                    expanded ? "text-fg-2" : "line-clamp-1",
                  )}
                >
                  {row.reason}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
      {formula ? <p className="mt-3 border-t border-line px-1 pt-3 text-xs tnum text-fg-3">{formula}</p> : null}
    </div>
  );
}
