"use client";

import * as React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import { Hint } from "./hint";
import { Kbd } from "./kbd";

/** One part of what the tabs split, e.g. the strong band: its count and its color class. */
export interface StatPart {
  id: string;
  count: number;
  /** Background color class, e.g. "bg-strong". */
  tone: string;
}

export interface StatTabOption<T extends string> {
  value: T;
  label: string;
  /** A shorter label for phones, e.g. "All". */
  shortLabel?: string;
  count: number;
  /** Dot color class, e.g. "bg-strong". It also colors the active tab's lit edge. */
  dot?: string;
  /** The ids of the parts this tab holds. Its meter lights them. */
  covers?: string[];
  /** The key that selects this tab, shown on wide screens and in the tab's tooltip. */
  kbd?: string;
  /** One line for the tooltip, such as the score where the band starts. */
  hint?: string;
}

/**
 * A view switcher whose tabs are readouts: a label, the count set large, and a meter. Every
 * meter draws the same split of `parts` (the match bands, say) and lights the tab's own slice,
 * so reading across the tabs reads the split. A sliding plate with a lit top edge marks the
 * active tab. On phones the tabs are four equal columns.
 */
export function StatTabs<T extends string>({
  value,
  onChange,
  options,
  parts = [],
  className,
  "aria-label": ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: StatTabOption<T>[];
  parts?: StatPart[];
  className?: string;
  "aria-label"?: string;
}) {
  const id = React.useId();
  const total = parts.reduce((n, p) => n + p.count, 0);
  const spans = parts.map((p, i) => ({
    ...p,
    from: total ? parts.slice(0, i).reduce((n, q) => n + q.count, 0) / total : 0,
    size: total ? p.count / total : 0,
  }));

  return (
    <fieldset
      className={cn(
        "m-0 grid min-w-0 grid-flow-col auto-cols-fr gap-1 rounded-lg border border-line bg-black/30 p-1 shadow-hairline",
        "max-md:grid-flow-row max-md:grid-cols-4",
        className,
      )}
    >
      {ariaLabel ? <legend className="sr-only">{ariaLabel}</legend> : null}
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Hint key={o.value} label={o.label} shortcut={o.kbd} detail={o.hint} side="bottom">
            <button
              type="button"
              aria-pressed={active}
              onClick={() => onChange(o.value)}
              className={cn(
                "hud-corners group relative flex min-w-26 flex-col items-start rounded-md px-3 pt-1.5 pb-1.5 text-left outline-none transition-colors hover:hud-on max-md:min-w-0 max-md:px-2.5",
                "focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-uv-hi",
                !active && "hover:bg-surface-2",
              )}
            >
              {active ? (
                <motion.span
                  layoutId={`${id}-plate`}
                  className="absolute inset-0 rounded-md bg-surface-3 shadow-hairline ring-1 ring-line-2"
                  transition={{ type: "spring", stiffness: 560, damping: 42 }}
                >
                  <span className={cn("absolute inset-x-3 top-0 h-px", o.dot ?? "bg-brand-hi shadow-neon")} />
                </motion.span>
              ) : null}
              <span
                className={cn(
                  "hud-label relative flex w-full items-center gap-1.5 whitespace-nowrap",
                  active ? "text-fg-2" : "text-fg-3 group-hover:text-fg-2",
                )}
              >
                {o.dot ? <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", o.dot)} /> : null}
                {o.shortLabel ? (
                  <>
                    <span className="max-md:hidden">{o.label}</span>
                    <span className="md:hidden">{o.shortLabel}</span>
                  </>
                ) : (
                  o.label
                )}
                {o.kbd ? (
                  <Kbd aria-hidden className="ml-auto h-4 min-w-4 max-xl:hidden">
                    {o.kbd}
                  </Kbd>
                ) : null}
              </span>
              <span
                className={cn(
                  "relative font-display text-2xl leading-7 font-semibold tnum max-md:text-xl",
                  active ? "text-fg" : "text-fg-2 group-hover:text-fg",
                )}
              >
                {formatCount(o.count)}
              </span>
              {spans.length ? (
                <span aria-hidden className="relative mt-1 h-0.5 w-full overflow-hidden bg-line-2">
                  {spans.map((p) => (
                    <span
                      key={p.id}
                      className={cn(
                        "absolute inset-y-0 left-0 w-full origin-left transition-[transform,opacity] duration-500 ease-out-expo",
                        p.tone,
                        o.covers?.includes(p.id) ? "opacity-100" : "opacity-15",
                      )}
                      style={{ transform: `translateX(${p.from * 100}%) scaleX(${p.size})` }}
                    />
                  ))}
                </span>
              ) : null}
            </button>
          </Hint>
        );
      })}
    </fieldset>
  );
}
