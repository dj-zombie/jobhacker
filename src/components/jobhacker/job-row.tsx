"use client";

import type * as React from "react";
import { ArrowUpRight, Banknote, Bookmark, MapPin, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatAge, formatAgeLong } from "@/lib/format";
import { CompanyLogo } from "./company-logo";
import { Hint } from "./hint";
import { ScorePill } from "./score";
import { ClosedChip, PlaceChip, PrescoreMeter, RemoteChip, StateChip } from "./chips";
import type { Density, JobSummary, TriageAction } from "./types";

function QuickAction({
  label,
  shortcut,
  onClick,
  small = false,
  className,
  children,
}: {
  label: string;
  shortcut: string;
  onClick: () => void;
  small?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Hint label={label} shortcut={shortcut} side="top">
      <button
        type="button"
        aria-label={`${label} (${shortcut})`}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className={cn(
          "inline-flex translate-x-1.5 items-center justify-center rounded-md text-fg-2 opacity-0 [&_svg]:size-3.5",
          small ? "size-6" : "size-7",
          "transition-[background-color,color,opacity,translate] duration-150 ease-out-quint",
          "hover:bg-surface-4 hover:text-brand-hi group-row-hover:translate-x-0 group-row-hover:opacity-100",
          className,
        )}
      >
        {children}
      </button>
    </Hint>
  );
}

/** `Sep` for inline text: the line can break on either side of it. */
function Dot() {
  return <span aria-hidden className="mx-1.5 inline-block size-0.5 rounded-full bg-fg-4 align-middle" />;
}

/** The posting's pay, set apart from the rest of the meta line. */
function Pay({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-md border border-line-2 bg-surface-2 px-1.5 align-middle text-xs font-semibold whitespace-nowrap tnum text-fg",
        className,
      )}
    >
      <Banknote aria-hidden className="size-3.5 text-strong" />
      {label}
    </span>
  );
}

/**
 * One job in the triage list. Selection is drawn by the list (a highlight and a
 * target lock that glide between rows); the row only renders content, its red
 * selected bar, and hover actions. Hover lights an ultraviolet wash and left bar
 * on the row's own pseudo-element, so the virtualized list gets no extra DOM.
 * Hover uses the list's row-hover variants: nothing lights up while J and K
 * scroll rows under a resting pointer.
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
  const shell = cn(
    "group relative flex min-w-0 gap-3 overflow-hidden rounded-md px-3 transition-colors duration-150",
    "before:absolute before:inset-y-3 before:left-1 before:w-0.5 before:origin-center",
    selected
      ? "before:scale-y-100 before:bg-brand-hi before:shadow-neon"
      : "before:scale-y-0 before:bg-uv-hi row-hover:bg-surface-2/60 row-hover:row-wash row-hover:before:scale-y-100 row-hover:before:shadow-neon-uv row-hover:before:transition-transform row-hover:before:duration-200 row-hover:before:ease-out-expo",
  );
  const titleTone = selected ? "text-fg" : "text-fg/90 group-row-hover:text-fg";
  const scoreMark =
    score != null && band != null ? (
      <ScorePill score={score} band={band} size={compact ? "sm" : "md"} />
    ) : job.prescore != null ? (
      <PrescoreMeter value={job.prescore} />
    ) : null;
  const tray =
    "pointer-events-none absolute top-1/2 flex -translate-y-1/2 items-center rounded-lg border border-line-2 bg-surface-3 opacity-0 shadow-pop transition-[opacity,translate] duration-150 ease-out-quint group-row-hover:pointer-events-auto group-row-hover:translate-x-0 group-row-hover:opacity-100";
  const quickActions = (small: boolean) =>
    onAction ? (
      <>
        <QuickAction small={small} label="Shortlist" shortcut="S" onClick={() => onAction("shortlist")}>
          <Bookmark />
        </QuickAction>
        <QuickAction
          small={small}
          label="Skip"
          shortcut="X"
          onClick={() => onAction("skip")}
          className="group-row-hover:delay-30"
        >
          <X />
        </QuickAction>
        <QuickAction
          small={small}
          label="Open posting"
          shortcut="O"
          onClick={() => onAction("open")}
          className="group-row-hover:delay-60"
        >
          <ArrowUpRight />
        </QuickAction>
      </>
    ) : null;

  if (compact) {
    return (
      <div className={cn(shell, "h-10 items-center")}>
        <CompanyLogo name={job.company} src={job.logoUrl} size={22} />
        <div
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 transition-[padding] duration-150 ease-out-quint",
            onAction && "group-row-hover:pr-[100px]",
          )}
        >
          <span className={cn("truncate text-sm font-medium transition-colors", titleTone)}>{job.title}</span>
          <span className="hidden min-w-0 shrink truncate text-xs text-fg-3 @md:inline">{job.company}</span>
          <StateChip state={job.state} />
          {job.closed ? <ClosedChip /> : null}
          {job.compLabel ? <Pay label={job.compLabel} className="ml-auto hidden @sm:inline-flex" /> : null}
        </div>
        <div className="flex w-14 shrink-0 justify-end">{scoreMark}</div>
        {onAction ? <div className={cn(tray, "right-[72px] translate-x-3 gap-0.5 p-0.5")}>{quickActions(false)}</div> : null}
      </div>
    );
  }

  // Everything wraps rather than truncates, and nothing on hover changes the row's size.
  return (
    <div className={cn(shell, "items-center py-1.5")}>
      <CompanyLogo name={job.company} src={job.logoUrl} size={34} />

      <div className="min-w-0 flex-1">
        <p className={cn("text-base font-medium leading-snug text-pretty wrap-break-word transition-colors", titleTone)}>
          {job.title}
          {job.state !== "new" || job.closed ? (
            <span className="ml-2 inline-flex gap-1 align-[1px]">
              <StateChip state={job.state} />
              {job.closed ? <ClosedChip /> : null}
            </span>
          ) : null}
        </p>
        {/* Inline text, not flex items, so a long location wraps word by word and no separator is left alone on a line. */}
        <p className="mt-1 text-xs leading-4 text-fg-3 wrap-break-word">
          <span className="text-fg-2">{job.company}</span>
          <Dot />
          {job.place ? (
            <Hint label={`In your ${job.place.label} area`} side="top">
              <span className="text-fg-2">
                <MapPin aria-hidden className="mr-1 inline size-3 align-[-2px] text-brand-hi" />
                {job.location}
              </span>
            </Hint>
          ) : (
            <span>{job.location}</span>
          )}
          {job.compLabel ? <Pay label={job.compLabel} className="ml-2" /> : null}
          {job.place ? (
            <PlaceChip label={job.place.label} className="ml-2 hidden align-middle @xl:inline-flex" />
          ) : (
            <RemoteChip remote={job.remote} className="ml-2 hidden align-middle @xl:inline-flex" />
          )}
        </p>
      </div>

      <div className={cn("flex shrink-0 flex-col items-end gap-0.5", onAction ? "w-[78px]" : "w-14")}>
        <div className="flex h-6 items-center">{scoreMark}</div>
        <div className="relative flex h-6 w-full items-center justify-end">
          <Hint label={formatAgeLong(job.ageHours)} side="left">
            <span
              className={cn(
                "text-2xs tnum text-fg-4 transition-opacity duration-150",
                onAction && "group-row-hover:opacity-0",
              )}
            >
              {formatAge(job.ageHours)}
            </span>
          </Hint>
          {onAction ? <div className={cn(tray, "right-0 translate-x-2 p-px")}>{quickActions(true)}</div> : null}
        </div>
      </div>
    </div>
  );
}
