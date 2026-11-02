"use client";

import type * as React from "react";
import { ArrowUpRight, Bookmark, MapPin, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatAge } from "@/lib/format";
import { CompanyLogo } from "./company-logo";
import { ScorePill } from "./score";
import { PlaceChip, PrescoreMeter, RemoteChip, Sep, StateChip } from "./chips";
import type { Density, JobSummary, TriageAction } from "./types";

function QuickAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="inline-flex size-7 items-center justify-center rounded-md text-fg-2 transition-colors hover:bg-surface-4 hover:text-fg [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}

/**
 * One job in the triage list. Selection is drawn by the list (a highlight that
 * glides between rows); the row only renders content and hover actions.
 */
export function JobRow({
  job,
  selected = false,
  density = "comfortable",
  onAction,
}: {
  job: JobSummary;
  selected?: boolean;
  density?: Density;
  onAction?: (action: TriageAction) => void;
}) {
  const compact = density === "compact";
  const { score, band } = job;

  return (
    <div
      className={cn(
        "group relative flex h-full min-w-0 items-center gap-3 overflow-hidden rounded-lg px-3 transition-colors duration-150",
        !selected && "hover:bg-surface-2",
      )}
    >
      <CompanyLogo name={job.company} src={job.logoUrl} size={compact ? 22 : 34} />

      <div
        className={cn(
          "min-w-0 flex-1 transition-[padding] duration-150 ease-out-quint",
          onAction && "group-hover:pr-[100px]",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "truncate font-medium transition-colors",
              compact ? "text-sm" : "text-base",
              selected ? "text-fg" : "text-fg/90",
            )}
          >
            {job.title}
          </span>
          {compact ? <span className="hidden min-w-0 shrink truncate text-xs text-fg-3 @md:inline">{job.company}</span> : null}
          <StateChip state={job.state} />
        </div>
        {compact ? null : (
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-fg-3">
            <span className="min-w-0 truncate text-fg-2">{job.company}</span>
            <Sep />
            {job.place ? (
              <span className="flex min-w-0 items-center gap-1 text-fg-2" title={`In your ${job.place.label} area`}>
                <MapPin className="size-3 shrink-0 text-brand-hi" />
                <span className="truncate">{job.location}</span>
              </span>
            ) : (
              <span className="truncate">{job.location}</span>
            )}
            {job.compLabel ? (
              <>
                <Sep />
                <span className="shrink-0 tnum text-fg-2">{job.compLabel}</span>
              </>
            ) : null}
          </div>
        )}
      </div>

      {compact ? null : job.place ? (
        <PlaceChip label={job.place.label} className="hidden @xl:inline-flex group-hover:hidden" />
      ) : (
        <RemoteChip remote={job.remote} className="hidden @xl:inline-flex group-hover:hidden" />
      )}

      <div className="flex w-14 shrink-0 flex-col items-end gap-1">
        {score != null && band != null ? (
          <ScorePill score={score} band={band} size={compact ? "sm" : "md"} />
        ) : job.prescore != null ? (
          <PrescoreMeter value={job.prescore} />
        ) : null}
        {compact ? null : <span className="text-2xs tnum text-fg-4">{formatAge(job.ageHours)}</span>}
      </div>

      {onAction ? (
        <div
          className={cn(
            "pointer-events-none absolute right-[72px] top-1/2 flex -translate-y-1/2 items-center gap-0.5",
            "rounded-lg border border-line-2 bg-surface-3 p-0.5 opacity-0 shadow-pop",
            "transition-[opacity,translate] duration-150 ease-out-quint group-hover:pointer-events-auto group-hover:opacity-100",
          )}
        >
          <QuickAction label="Shortlist (S)" onClick={() => onAction("shortlist")}>
            <Bookmark />
          </QuickAction>
          <QuickAction label="Skip (X)" onClick={() => onAction("skip")}>
            <X />
          </QuickAction>
          <QuickAction label="Open posting (O)" onClick={() => onAction("open")}>
            <ArrowUpRight />
          </QuickAction>
        </div>
      ) : null}
    </div>
  );
}
