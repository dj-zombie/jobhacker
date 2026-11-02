"use client";

import { Globe, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
      "inline-flex h-7 max-md:min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs outline-none transition-colors",
      "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-brand-hi",
      on
        ? "border-brand/45 bg-brand-wash font-medium text-fg"
        : "border-line-2 bg-surface-1 text-fg-3 hover:bg-surface-2 hover:text-fg-2",
    );

  return (
    <fieldset
      className={cn(
        "m-0 flex min-w-0 flex-wrap items-center gap-1.5 border-0 p-0 max-md:w-full md:shrink-0",
        className,
      )}
    >
      <legend className="sr-only">Where</legend>
      <span aria-hidden className="mr-0.5 text-xs text-fg-3">
        Where
      </span>
      {options.map((o) => {
        const on = !anywhere && value.includes(o.id);
        const Icon = o.kind === "remote" ? Globe : MapPin;
        const button = (
          <button key={o.id} type="button" aria-pressed={on} onClick={() => toggle(o.id)} className={pill(on)}>
            <Icon className={cn("size-3.5", on ? "text-brand-hi" : "text-fg-4")} />
            {o.label}
            <span className={cn("tnum", on ? "text-fg-2" : "text-fg-4")}>{formatCount(o.count)}</span>
          </button>
        );
        return o.note ? (
          <Tooltip key={o.id}>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent>{o.note}</TooltipContent>
          </Tooltip>
        ) : (
          <span key={o.id}>{button}</span>
        );
      })}
      <button type="button" aria-pressed={anywhere} onClick={() => onChange([])} className={pill(anywhere)}>
        Anywhere
      </button>
    </fieldset>
  );
}
