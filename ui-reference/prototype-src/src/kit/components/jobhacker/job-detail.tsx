"use client";

import {
  Archive,
  ArrowUpRight,
  Banknote,
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
import { cn } from "@/lib/utils";
import { ClosedChip, PlaceChip, RemoteChip, StateChip } from "./chips";
import { Hint } from "./hint";
import { CompanyHeader, type HeaderFact, type HeaderHud } from "./company-header";
import { DescriptionBlocks } from "./description";
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
    <section className={cn("surface-card chamfer relative min-w-0 rounded-xl p-5 @max-md:p-4", className)}>
      <div className="mb-3 flex items-center justify-between gap-4">
        <h3 className="hud-label hud-rule min-w-0 flex-1 text-fg-2">
          <span aria-hidden className="-mr-1 h-px w-2.5 bg-brand-hi" />
          <span className="flex items-center gap-2">{title}</span>
        </h3>
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

/** One bar of a loading placeholder, the height of a line of small text. */
function Bone({ className }: { className?: string }) {
  return <span aria-hidden className={cn("skeleton block h-2.5 rounded-sm", className)} />;
}

/** Two paragraphs of bars where the description will be. */
function DescriptionSkeleton() {
  return (
    <div className="max-w-[80ch] space-y-6 py-1 animate-skeleton">
      <span className="sr-only">Loading the description</span>
      <div className="space-y-3">
        <Bone className="h-3 w-28" />
        <Bone className="w-full" />
        <Bone className="w-full" />
        <Bone className="w-11/12" />
        <Bone className="w-3/5" />
      </div>
      <div className="space-y-3">
        <Bone className="h-3 w-24" />
        <Bone className="w-full" />
        <Bone className="w-10/12" />
        <Bone className="w-full" />
        <Bone className="w-2/5" />
      </div>
    </div>
  );
}

const BREAKDOWN_BONES = [
  { key: "role", label: "w-10", reason: "w-3/4" },
  { key: "tech", label: "w-12", reason: "w-2/3" },
  { key: "domain", label: "w-14", reason: "w-4/5" },
  { key: "seniority", label: "w-16", reason: "w-3/5" },
  { key: "logistics", label: "w-14", reason: "w-2/3" },
  { key: "comp", label: "w-10", reason: "w-1/2" },
] as const;

/** The breakdown's six rows as bars, laid out like `DimensionBreakdown`'s. */
function BreakdownSkeleton() {
  return (
    <div className="@container animate-skeleton">
      <span className="sr-only">Loading the breakdown</span>
      <ul className="divide-y divide-line">
        {BREAKDOWN_BONES.map((b) => (
          <li key={b.key} className="px-1 py-2.5">
            <div className="grid grid-cols-[76px_minmax(0,1fr)_32px] items-center gap-2.5 @md:grid-cols-[96px_1fr_44px] @md:gap-3">
              <Bone className={b.label} />
              <Bone className="h-1.5 w-full rounded-none" />
              <Bone className="w-6" />
            </div>
            <Bone className={cn("mt-2.5 h-2 @md:ml-[108px]", b.reason)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The right-hand pane of triage: everything needed to decide on one job in
 * about twenty seconds. Content re-animates gently when the job changes, the
 * score ring sweeps from the previous job's score to this one, and a scanline
 * runs down the breakdown when the header acquires the job.
 */
export function JobDetail({
  job,
  loading = false,
  onAction,
  onTune,
  onScore,
  onEditLogo,
  primary,
  industry,
  context,
  className,
}: {
  job: JobDetailData;
  /**
   * The job's own details are still on their way: the description, the breakdown, the dates and
   * the employment type show placeholders in their places, so nothing moves when they arrive.
   */
  loading?: boolean;
  /** Where the job is being looked at, for the header's readout: the view, and the job's place in it. */
  context?: Omit<HeaderHud, "level">;
  onAction: (action: TriageAction) => void;
  onTune?: () => void;
  onScore?: () => void;
  /** When set, the header logo is a button that opens the logo picker. */
  onEditLogo?: () => void;
  /** Replace the Shortlist button, e.g. "Prepare application" on the shortlist. */
  primary?: { label: string; icon: React.ReactNode; onClick: () => void; kbd?: string };
  /** The company's industry, on its own row above the triage actions. */
  industry?: React.ReactNode;
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
  // A narrow pane hides the key caps, so every action's tooltip names its key.
  const actions = (compact: boolean) => (
    <>
      {!compact && industry ? <div className="flex basis-full">{industry}</div> : null}
      {primary ? (
        <Hint label={primary.label} shortcut={primary.kbd} side={compact ? "bottom" : undefined}>
          <Button size={compact ? "sm" : "default"} onClick={primary.onClick}>
            {primary.icon}
            {primary.label}
            {primary.kbd && !compact ? <Kbd className={keyOnBrand}>{primary.kbd}</Kbd> : null}
          </Button>
        </Hint>
      ) : (
        <Hint label="Shortlist" shortcut="S" side={compact ? "bottom" : undefined}>
          <Button size={compact ? "sm" : "default"} onClick={() => onAction("shortlist")}>
            <Bookmark />
            Shortlist
            {compact ? null : <Kbd className={keyOnBrand}>S</Kbd>}
          </Button>
        </Hint>
      )}
      {compact ? (
        <>
          <Hint label="Skip" shortcut="X" side="bottom">
            <Button variant="ghost" size="icon-sm" aria-label="Skip" onClick={() => onAction("skip")}>
              <X />
            </Button>
          </Hint>
          <Hint label="Archive" shortcut="A" side="bottom">
            <Button variant="ghost" size="icon-sm" aria-label="Archive" onClick={() => onAction("archive")}>
              <Archive />
            </Button>
          </Hint>
          <Hint label="Open posting" shortcut="O" side="bottom">
            <Button variant="ghost" size="icon-sm" aria-label="Open posting" onClick={() => onAction("open")}>
              <ArrowUpRight />
            </Button>
          </Hint>
        </>
      ) : (
        <>
          <Hint label="Skip" shortcut="X">
            <Button variant="secondary" onClick={() => onAction("skip")}>
              <X />
              Skip
              <Kbd className="ml-0.5 hidden @xl:inline-flex">X</Kbd>
            </Button>
          </Hint>
          <Hint label="Archive" shortcut="A">
            <Button variant="secondary" onClick={() => onAction("archive")}>
              <Archive />
              Archive
              <Kbd className="ml-0.5 hidden @xl:inline-flex">A</Kbd>
            </Button>
          </Hint>
          <Hint label="Open posting" shortcut="O">
            <Button variant="ghost" className="ml-auto @max-md:ml-0" onClick={() => onAction("open")}>
              <ArrowUpRight />
              Open posting
              <Kbd className="ml-0.5 hidden @xl:inline-flex">O</Kbd>
            </Button>
          </Hint>
        </>
      )}
    </>
  );

  const facts: HeaderFact[] = [
    {
      label: "Pay",
      value: job.compLabel ? (
        <span className="inline-flex items-center gap-1.5 font-display text-xl leading-6 font-semibold whitespace-nowrap tnum text-fg @max-md:text-lg">
          <Banknote aria-hidden className="size-4.5 shrink-0 text-strong" />
          {job.compLabel}
        </span>
      ) : (
        <span className="text-fg-3">Not listed</span>
      ),
    },
    {
      label: "Location",
      value: <span className="text-pretty">{job.location}</span>,
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
    {
      label: "Posted",
      value: loading ? (
        <Bone className="my-[5px] w-20 animate-skeleton" />
      ) : (
        <span className="truncate">{job.postedLabel}</span>
      ),
    },
    {
      label: "Last confirmed",
      value: loading ? (
        <Bone className="my-[5px] w-16 animate-skeleton" />
      ) : (
        <Hint label="Last confirmed" detail="When a scout last saw this posting.">
          <span className="truncate">{job.confirmedLabel}</span>
        </Hint>
      ),
    },
  ];

  // The verdict lays out by its own width, since a wide pane puts it in the side column. Narrow, the
  // band sits beside the ring and the summary runs underneath both.
  const verdict = score != null && band != null ? (
    <section className="@container surface-card chamfer relative overflow-hidden rounded-xl p-5 @max-md:p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute -left-16 -top-24 size-64 rounded-full opacity-40 blur-3xl"
        style={{ background: `radial-gradient(closest-side, var(--color-${band}-wash), transparent)` }}
      />
      <div className="relative grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-5 gap-y-2 @max-sm:gap-x-4 @max-sm:gap-y-3">
        <ScoreRing score={score} band={band} className="row-span-3 @max-sm:row-span-1" />
        <div
          className={cn(
            "self-end font-display text-[15px] font-semibold uppercase tracking-[0.03em] @max-sm:self-center",
            BAND_TEXT[band],
          )}
        >
          {BAND_LABEL[band]}
        </div>
        {job.summary ? (
          <p className="text-sm leading-relaxed text-fg-2 @max-sm:col-span-2">{job.summary}</p>
        ) : null}
        <div className="col-start-2 flex flex-wrap gap-1.5 self-start @max-sm:col-span-2 @max-sm:col-start-1">
          {loading ? (
            <Bone className="h-6 w-18 rounded-full animate-skeleton" />
          ) : (
            <Chip>{job.employment}</Chip>
          )}
          {job.prescore != null ? (
            <Hint
              label={`Prescore ${job.prescore.toFixed(2)}`}
              detail="Decides when this job gets scored. It never excludes it."
            >
              <span>
                <Chip>Prescore {job.prescore.toFixed(2)}</Chip>
              </span>
            </Hint>
          ) : null}
        </div>
      </div>
    </section>
  ) : (
    <section className="@container surface-card chamfer relative rounded-xl p-5 @max-md:p-4">
      <div className="flex items-center gap-5 @max-sm:flex-col @max-sm:items-start">
        <div className="flex size-[108px] shrink-0 flex-col items-center justify-center rounded-full border-2 border-dashed border-line-3">
          <CircleDashed className="size-5 text-fg-3" />
          <span className="hud-label mt-1 text-fg-3">Not scored</span>
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
      </div>
    </section>
  );

  const whyTitle = (
    <>
      Why it's here
      <Hint
        label="How ranking works"
        detail="The model scores each dimension once. Your rank is those scores times your weights, worked out on this machine, so changing a weight re-ranks instantly and never calls the API."
      >
        <button type="button" aria-label="How ranking works" className="text-fg-4 hover:text-fg-2">
          <Info className="size-3.5" />
        </button>
      </Hint>
    </>
  );
  const whyAside = onTune ? (
    <Hint label="Tune weights" shortcut="T">
      <Button size="sm" variant="ghost" onClick={onTune}>
        <SlidersHorizontal />
        Tune weights
        <Kbd className="hidden @xl:inline-flex">T</Kbd>
      </Button>
    </Hint>
  ) : null;

  const why = job.dimensions?.length ? (
    <Section title={whyTitle} aside={whyAside}>
      <DimensionBreakdown rows={job.dimensions} formula={job.formula} />
      {job.prescoreNote ? <p className="mt-2 px-1 text-2xs text-fg-4">{job.prescoreNote}</p> : null}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
        <div data-replay className="absolute inset-0 opacity-0 animate-scan-down [animation-delay:160ms]">
          <div className="h-0.5 bg-brand-hi/70 shadow-[0_0_12px_2px_rgb(255_46_79/0.45)]" />
          <div className="h-10 bg-linear-to-t from-brand/12 to-transparent -translate-y-10.5" />
        </div>
      </div>
    </Section>
  ) : loading && score != null ? (
    <Section title={whyTitle} aside={whyAside}>
      <BreakdownSkeleton />
    </Section>
  ) : null;

  const flags = job.redFlags?.length ? (
    <section className="min-w-0 rounded-xl border border-danger/20 bg-danger-wash/40 p-5 @max-md:p-4">
      <h3 className="hud-label flex items-center gap-2 text-fg-2">
        <TriangleAlert className="size-4 text-danger" />
        Red flags
        <span className="rounded-full bg-danger-wash px-1.5 font-semibold tnum text-danger">
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
  ) : null;

  const description = job.description?.length ? (
    <Section title="Description">
      <DescriptionBlocks blocks={job.description} />
    </Section>
  ) : loading ? (
    <Section title="Description">
      <DescriptionSkeleton />
    </Section>
  ) : null;

  const scoredBy = job.model ? (
    <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 px-1 pb-4 font-mono text-2xs text-fg-4">
      <span>Scored by {job.model}</span>
      {job.rubric ? <span>Rubric {job.rubric}</span> : null}
      {job.scoredLabel ? <span>{job.scoredLabel}</span> : null}
    </p>
  ) : null;

  return (
    <div className={cn("@container flex h-full min-h-0 flex-col", className)}>
      <div
        ref={scrollRef}
        data-detail-scroll
        aria-busy={loading || undefined}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      >
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
          hud={context ? { ...context, level: score == null ? null : score / 100 } : undefined}
        >
        <div ref={bodyRef} className="px-6 py-5 @max-md:px-4">
          {/* One column reads verdict, red flags, description, breakdown. From an 896px pane the
              description and breakdown are the main column, and the verdict and red flags stay
              beside them as the description scrolls (top-17 clears the compact bar). */}
          <div className="grid gap-4 @4xl:grid-cols-12 @4xl:items-start">
            <div
              className={cn(
                "contents @4xl:sticky @4xl:top-17 @4xl:row-start-1 @4xl:grid @4xl:min-w-0 @4xl:gap-4",
                description || why ? "@4xl:col-span-4 @4xl:col-start-9" : "@4xl:col-span-12",
              )}
            >
              {verdict}
              {flags}
            </div>
            {description || why ? (
              <div className="contents @4xl:col-span-8 @4xl:col-start-1 @4xl:row-start-1 @4xl:grid @4xl:min-w-0 @4xl:gap-4">
                {description}
                {why}
              </div>
            ) : null}
          </div>
          {scoredBy}
        </div>
        </CompanyHeader>
      </div>
    </div>
  );
}
