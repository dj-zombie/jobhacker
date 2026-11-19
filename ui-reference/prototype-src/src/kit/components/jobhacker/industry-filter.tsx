"use client";

import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/format";

export interface IndustryOption {
  id: string;
  label: string;
  count: number;
}

/**
 * Which industry to look at. No selection shows every company. Selecting one
 * shows suggested and confirmed companies in it. This filters the view only.
 */
export function IndustryFilter({
  options,
  value,
  onChange,
  className,
}: {
  options: IndustryOption[];
  /** Selected id. Null means every industry. */
  value: string | null;
  onChange: (id: string | null) => void;
  className?: string;
}) {
  if (options.length === 0) return null;
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
      <legend className="sr-only">Industry</legend>
      <span aria-hidden className="hud-label mr-0.5 text-fg-3">
        Industry
      </span>
      <button type="button" aria-pressed={value === null} onClick={() => onChange(null)} className={pill(value === null)}>
        All
      </button>
      {options.map((option) => {
        const on = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? null : option.id)}
            className={pill(on)}
          >
            {option.label}
            <span className={cn("font-mono text-2xs tnum", on ? "text-fg-2" : "text-fg-4")}>
              {formatCount(option.count)}
            </span>
          </button>
        );
      })}
    </fieldset>
  );
}

/** The industry on one company, and the controls that confirm, change, or clear it. */
export function IndustryMark({
  options,
  industryId,
  status,
  reason,
  disabled,
  onSet,
  onClear,
}: {
  options: { id: string; label: string }[];
  industryId: string | null;
  status: "suggested" | "confirmed" | null;
  reason?: string | null;
  disabled?: boolean;
  onSet: (id: string) => void;
  onClear: () => void;
}) {
  if (options.length === 0) return null;
  const pill = (on: boolean) =>
    cn(
      "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs outline-none transition-colors",
      "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-uv-hi",
      "disabled:opacity-50",
      on
        ? "border-brand/45 bg-brand-wash font-medium text-fg"
        : "border-line-2 bg-surface-1 text-fg-3 hover:border-uv-hi/40 hover:bg-surface-2 hover:text-fg-2",
    );
  return (
    <fieldset className="m-0 flex flex-wrap items-center gap-1.5 border-0 p-0">
      <legend className="sr-only">Industry</legend>
      <span aria-hidden className="hud-label text-fg-3">
        Industry
      </span>
      {options.map((option) => {
        const on = option.id === industryId;
        const suggested = on && status === "suggested";
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            title={suggested && reason ? reason : undefined}
            onClick={() => onSet(option.id)}
            className={pill(on)}
          >
            {option.label}
            {suggested ? <span className="font-mono text-2xs text-fg-4">suggested</span> : null}
          </button>
        );
      })}
      {industryId ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onClear}
          className="rounded-sm px-1 text-xs text-fg-3 outline-none hover:text-fg-2 hover:underline focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-uv-hi disabled:opacity-50"
        >
          Not this
        </button>
      ) : null}
    </fieldset>
  );
}
