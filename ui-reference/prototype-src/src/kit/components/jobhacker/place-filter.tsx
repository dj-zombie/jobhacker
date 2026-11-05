"use client";

import { Globe, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import { Hint } from "./hint";

export interface PlaceOption {
  id: string;
  label: string;
  count: number;
  /** e.g. "Hybrid only". Shown in a tooltip. */
  note?: string;
  kind: "place" | "remote";
}

/**
 * Where to look: toggle any of the user's places on or off. No selection
 * means Anywhere. Clicking a place while on Anywhere shows just that place.
 * This filters the view only; nothing is excluded from storage or scoring.
 */
export function PlaceFilter({
  options,
  value,
  onChange,
  className,
}: {
  options: PlaceOption[];
  /** Selected ids. Empty means Anywhere. */
  value: string[];
  onChange: (ids: string[]) => void;
  className?: string;
}) {
  const anywhere = value.length === 0;
  const toggle = (id: string) => {
    if (anywhere) return onChange([id]);
    const next = value.includes(id) ? value.filter((v) => v !== id) : [...value, id];
    onChange(options.map((o) => o.id).filter((o) => next.includes(o)));
  };

  const pill = (on: boolean) =>
    cn(
      "hud-corners relative inline-flex h-7 max-md:min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs outline-none transition-colors hover:hud-on",
      "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-uv-hi",
      on
        ? "border-brand/45 bg-brand-wash font-medium text-fg"
        : "border-line-2 bg-surface-1 text-fg-3 hover:border-uv-hi/40 hover:bg-surface-2 hover:text-fg-2",
    );

  return (
    <fieldset
      className={cn(
        "m-0 flex shrink-0 flex-wrap items-center gap-1.5 border-0 p-0 max-md:flex-nowrap",
        className,
      )}
    >
      <legend className="sr-only">Where</legend>
      <span aria-hidden className="hud-label mr-0.5 text-fg-3">
        Where
      </span>
      {options.map((o) => {
        const on = !anywhere && value.includes(o.id);
        const Icon = o.kind === "remote" ? Globe : MapPin;
        const button = (
          <button key={o.id} type="button" aria-pressed={on} onClick={() => toggle(o.id)} className={pill(on)}>
            <Icon className={cn("size-3.5", on ? "text-brand-hi" : "text-fg-4")} />
            {o.label}
            <span className={cn("font-mono text-2xs tnum", on ? "text-fg-2" : "text-fg-4")}>{formatCount(o.count)}</span>
          </button>
        );
        return o.note ? (
          <Hint key={o.id} label={o.label} detail={o.note}>
            {button}
          </Hint>
        ) : (
          <span key={o.id}>{button}</span>
        );
      })}
      <Hint label="Anywhere" detail="No place selected. This only changes the view.">
        <button type="button" aria-pressed={anywhere} onClick={() => onChange([])} className={pill(anywhere)}>
          Anywhere
        </button>
      </Hint>
    </fieldset>
  );
}
