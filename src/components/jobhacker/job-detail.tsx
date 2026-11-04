"use client";

import {
  Archive,
  ArrowUpRight,
  Bookmark,
  CircleDashed,
  Info,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import { useReducedMotion } from "motion/react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ClosedChip, PlaceChip, RemoteChip, StateChip } from "./chips";
import { CompanyHeader, type HeaderFact } from "./company-header";
import { Collapsible, DescriptionBlocks } from "./description";
import { DimensionBreakdown } from "./dimension-breakdown";
import { Kbd } from "./kbd";
import { BAND_LABEL, BAND_TEXT, ScoreRing } from "./score";
import type { JobDetailData, TriageAction } from "./types";

function Section({
  title,
  aside,
  className,
  children,
}: {
  title: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("surface-card rounded-xl p-5 @max-md:p-4", className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-full border border-line-2 bg-surface-2 px-2 text-xs text-fg-2">
      {children}
    </span>
  );
}

/**
 * The right-hand pane of triage: everything needed to decide on one job in
 * about twenty seconds. Content re-animates gently when the job changes and
 * the score ring sweeps from the previous job's score to this one.
 */
export function JobDetail({
  job,
  onAction,
  onTune,
  onScore,
  onEditLogo,
  primary,
  className,
}: {
  job: JobDetailData;
  onAction: (action: TriageAction) => void;
  onTune?: () => void;
  onScore?: () => void;
  /** When set, the header logo is a button that opens the logo picker. */
  onEditLogo?: () => void;
  /** Replace the Shortlist button, e.g. "Prepare application" on the shortlist. */
  primary?: { label: string; icon: React.ReactNode; onClick: () => void; kbd?: string };
  className?: string;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  // biome-ignore lint/correctness/useExhaustiveDependencies: replay the entrance and reset scroll each time the job changes
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    if (reduce) return;
    bodyRef.current?.animate(
      [
        { opacity: 0.35, transform: "translateY(5px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 220, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
  }, [job.id, reduce]);

  const { score, band } = job;

  const keyOnBrand = "ml-0.5 hidden border-white/20 bg-white/10 text-white/85 shadow-none @xl:inline-flex";
  const actions = (compact: boolean) => (
    <>
      {primary ? (
        <Button size={compact ? "sm" : "default"} onClick={primary.onClick}>
          {primary.icon}
          {primary.label}
          {primary.kbd && !compact ? <Kbd className={keyOnBrand}>{primary.kbd}</Kbd> : null}
        </Button>
      ) : (
        <Button size={compact ? "sm" : "default"} onClick={() => onAction("shortlist")}>
          <Bookmark />
          Shortlist
          {compact ? null : <Kbd className={keyOnBrand}>S</Kbd>}
        </Button>
      )}
      {compact ? (
        <>
          <Button variant="ghost" size="icon-sm" aria-label="Skip" onClick={() => onAction("skip")}>
            <X />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Archive" onClick={() => onAction("archive")}>
            <Archive />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Open posting" onClick={() => onAction("open")}>
            <ArrowUpRight />
          </Button>
        </>
      ) : (
        <>
          <Button variant="secondary" onClick={() => onAction("skip")}>
            <X />
            Skip
            <Kbd className="ml-0.5 hidden @xl:inline-flex">X</Kbd>
          </Button>
          <Button variant="secondary" onClick={() => onAction("archive")}>
            <Archive />
            Archive
            <Kbd className="ml-0.5 hidden @xl:inline-flex">A</Kbd>
          </Button>
          <Button variant="ghost" className="ml-auto @max-md:ml-0" onClick={() => onAction("open")}>
            <ArrowUpRight />
            Open posting
            <Kbd className="ml-0.5 hidden @xl:inline-flex">O</Kbd>
          </Button>
        </>
      )}
    </>
  );

  const facts: HeaderFact[] = [
    {
      label: "Location",
      value: (
        <span className="truncate" title={job.location}>
          {job.location}
        </span>
      ),
    },
    {
      label: "Work",
      value: (
        <>
          <RemoteChip remote={job.remote} />
          {job.place ? <PlaceChip label={job.place.label} /> : null}
        </>
      ),
    },
    { label: "Posted", value: <span className="truncate">{job.postedLabel}</span> },
    { label: "Last confirmed", value: <span className="truncate">{job.confirmedLabel}</span> },
  ];

  return (
    <div className={cn("@container flex h-full min-h-0 flex-col", className)}>
      <div ref={scrollRef} data-detail-scroll className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <CompanyHeader
          company={job.company}
          title={job.title}
          badge={
            <>
              <StateChip state={job.state} />
              {job.closed ? <ClosedChip /> : null}
            </>
          }
          artUrl={job.logoUrl}
          coverUrl={job.logoTileUrl}
          markOnDark={job.logoSymbolOnDarkUrl}
          markOnLight={job.logoSymbolOnLightUrl}
          wordmarkOnDark={job.logoWordmarkOnDarkUrl}
          wordmarkOnLight={job.logoWordmarkOnLightUrl}
          onEditLogo={onEditLogo}
          facts={facts}
          actions={actions(false)}
          compactActions={actions(true)}
          contentClassName="mx-auto max-w-[760px]"
        >
        <div ref={bodyRef} className="mx-auto max-w-[760px] space-y-4 px-6 py-5 @max-md:px-4">
          {score != null && band != null ? (
            <section className="surface-card relative overflow-hidden rounded-xl p-5 @max-md:p-4">
              <div
                aria-hidden
                className="pointer-events-none absolute -left-16 -top-24 size-64 rounded-full opacity-40 blur-3xl"
                style={{ background: `radial-gradient(closest-side, var(--color-${band}-wash), transparent)` }}
              />
              <div className="relative flex items-center gap-5 @max-md:flex-col @max-md:items-start">
                <ScoreRing score={score} band={band} />
                <div className="min-w-0 flex-1">
                  <div className={cn("text-lg font-semibold tracking-tight", BAND_TEXT[band])}>
                    {BAND_LABEL[band]}
                  </div>
                  {job.summary ? <p className="mt-1 text-sm leading-relaxed text-fg-2">{job.summary}</p> : null}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Chip>{job.employment}</Chip>
                    <Chip>{job.compLabel ?? "Comp not listed"}</Chip>
                    {job.prescore != null ? <Chip>Prescore {job.prescore.toFixed(2)}</Chip> : null}
                  </div>
                </div>
              </div>
            </section>
          ) : (
            <section className="surface-card flex items-center gap-5 rounded-xl p-5 @max-md:flex-col @max-md:items-start">
              <div className="flex size-[108px] shrink-0 flex-col items-center justify-center rounded-full border-2 border-dashed border-line-3">
                <CircleDashed className="size-5 text-fg-3" />
                <span className="mt-1 text-2xs text-fg-3">Not scored</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-lg font-semibold tracking-tight text-fg">Waiting for a score</div>
                <p className="mt-1 text-sm leading-relaxed text-fg-2">
                  This job passed the gates but hasn't been through the model yet. Its prescore
                  {job.prescore != null ? ` of ${job.prescore.toFixed(2)}` : ""} only decides when it gets scored; it
                  never excludes it.
                </p>
                {onScore ? (
                  <Button className="mt-3" size="sm" onClick={onScore}>
                    <Sparkles />
                    Score this job
                  </Button>
                ) : null}
              </div>
            </section>
          )}

          {job.dimensions?.length ? (
            <Section
              title={
                <>
                  Why it's here
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" aria-label="How ranking works" className="text-fg-4 hover:text-fg-2">
                        <Info className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      The model scores each dimension once. Your rank is those scores times your weights, worked out on
                      this machine, so changing a weight re-ranks instantly and never calls the API.
                    </TooltipContent>
                  </Tooltip>
                </>
              }
              aside={
                onTune ? (
                  <Button size="sm" variant="ghost" onClick={onTune}>
                    <SlidersHorizontal />
                    Tune weights
                    <Kbd className="hidden @xl:inline-flex">T</Kbd>
                  </Button>
                ) : null
              }
            >
              <DimensionBreakdown rows={job.dimensions} formula={job.formula} />
              {job.prescoreNote ? <p className="mt-2 px-1 text-2xs text-fg-4">{job.prescoreNote}</p> : null}
            </Section>
          ) : null}

          {job.redFlags?.length ? (
            <section className="rounded-xl border border-danger/20 bg-danger-wash/40 p-5 @max-md:p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
                <TriangleAlert className="size-4 text-danger" />
                Red flags
                <span className="rounded-full bg-danger-wash px-1.5 text-2xs font-semibold tnum text-danger">
                  {job.redFlags.length}
                </span>
              </h3>
              <ul className="mt-2.5 space-y-1.5">
                {job.redFlags.map((f) => (
                  <li key={f} className="flex gap-2.5 text-sm leading-relaxed text-fg-2">
                    <span aria-hidden className="mt-[0.6em] size-1 shrink-0 rounded-full bg-danger" />
                    {f}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {job.description?.length ? (
            <Section title="Description">
              <Collapsible key={job.id} maxHeight={300}>
                <DescriptionBlocks blocks={job.description} />
              </Collapsible>
            </Section>
          ) : null}

          {job.model ? (
            <p className="flex flex-wrap gap-x-4 gap-y-1 px-1 pb-4 text-2xs text-fg-4">
              <span>Scored by {job.model}</span>
              {job.rubric ? <span>Rubric {job.rubric}</span> : null}
              {job.scoredLabel ? <span>{job.scoredLabel}</span> : null}
            </p>
          ) : null}
        </div>
        </CompanyHeader>
      </div>
    </div>
  );
}
