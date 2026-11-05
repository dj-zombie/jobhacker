"use client";

import * as React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/format";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  count?: number;
  /** Optional dot color class, e.g. "bg-strong". */
  dot?: string;
}

/** Pill-style view switcher with a sliding active background and its lit underline. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  "aria-label": ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegmentOption<T>[];
  className?: string;
  "aria-label"?: string;
}) {
  const id = React.useId();
  return (
    <fieldset
      className={cn(
        "m-0 flex h-auto min-w-0 max-w-full flex-wrap items-center gap-0.5 rounded-lg border border-line bg-surface-1 p-0.5",
        className,
      )}
    >
      {ariaLabel ? <legend className="sr-only">{ariaLabel}</legend> : null}
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative inline-flex h-8 max-md:min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-medium outline-none transition-colors",
              "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-uv-hi",
              active ? "text-fg" : "text-fg-3 hover:text-fg-2",
            )}
          >
            {active ? (
              <motion.span
                layoutId={`${id}-seg`}
                className="absolute inset-0 rounded-md bg-surface-3 shadow-hairline ring-1 ring-line-2"
                transition={{ type: "spring", stiffness: 560, damping: 42 }}
              >
                <span className="absolute inset-x-2.5 bottom-0 h-px bg-brand-hi shadow-neon" />
              </motion.span>
            ) : null}
            {o.dot ? <span className={cn("relative size-1.5 rounded-full", o.dot)} /> : null}
            <span className="relative">{o.label}</span>
            {o.count != null ? (
              <span className={cn("relative font-mono text-2xs tnum", active ? "text-fg-2" : "text-fg-4")}>
                {formatCount(o.count)}
              </span>
            ) : null}
          </button>
        );
      })}
    </fieldset>
  );
}
