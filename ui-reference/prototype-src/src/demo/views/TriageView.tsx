import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Archive,
  Bookmark,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  CircleDashed,
  FileText,
  Inbox,
  Menu,
  Radar,
  Rows3,
  Rows4,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  BAND_LABEL,
  EmptyState,
  FilterChip,
  JobDetail,
  JobList,
  Kbd,
  ListingsBanner,
  PageHeader,
  PlaceFilter,
  Segmented,
  TunePanel,
  toast,
  toastUndo,
  useHotkeys,
  type JobSummary,
  type TriageAction,
} from "@/components/jobhacker";
import { useDemo } from "../App";
import { openLogoPicker } from "../logo-store";
import {
  DEFAULT_WHERE,
  PLACE_OPTIONS,
  areasOf,
  bandFor,
  inWhere,
  rank,
  sameWeights,
  toDetail,
  toSummary,
  type Segment,
  type View,
} from "../model";
import type { JobSummary as Summary } from "@/components/jobhacker";
import { navigate } from "../router";

const VIEW_META: Record<View, { title: string; icon: typeof Sparkles }> = {
  top: { title: "Top matches", icon: Sparkles },
  new: { title: "New today", icon: Inbox },
  shortlist: { title: "Shortlist", icon: Bookmark },
  unscored: { title: "Unscored", icon: CircleDashed },
};

const ACTION_TO_STATE = { shortlist: "shortlisted", skip: "skipped", archive: "archived" } as const;
const ACTION_PAST = { shortlist: "Shortlisted", skip: "Skipped", archive: "Archived" } as const;

function byRank(a: JobSummary, b: JobSummary) {
  const s = (b.score ?? -1) - (a.score ?? -1);
  if (s) return s;
  const p = (b.prescore ?? 0) - (a.prescore ?? 0);
  if (p) return p;
  return a.id < b.id ? -1 : 1;
}

const LISTINGS_FRAME =
  typeof location !== "undefined" && new URLSearchParams(location.search).get("frame") === "refresh";

export function TriageView({ view }: { view: View }) {
  const { state, dispatch, isMobile, openMobileNav, runScout, refreshListings } = useDemo();
  const { weights, thresholds } = state;
  const meta = VIEW_META[view];

  const postedOk = React.useCallback(
    (h: number) =>
      state.posted === "any" ? true : state.posted === "1d" ? h < 24 : state.posted === "7d" ? h < 168 : h < 720,
    [state.posted],
  );

  // Jobs in this view, before the Where filter, so each place can show its own count.
  const viewRows = React.useMemo(() => {
    return state.jobs
      .filter((j) => {
        if (view === "shortlist") return j.state === "shortlisted";
        if (j.state !== "new") return false;
        if (view === "top") return !!j.dims;
        if (view === "new") return j.ageHours < 24;
        return !j.dims;
      })
      .filter((j) => postedOk(j.ageHours))
      .map((j) => ({ job: j, s: toSummary(j, weights, thresholds) }));
  }, [state.jobs, view, weights, thresholds, postedOk]);

  const segOk = React.useCallback(
    (s: Summary) => {
      if (view !== "top") return true;
      const seg = state.segment;
      return seg === "matches"
        ? s.band !== "no"
        : seg === "strong"
          ? s.band === "strong"
          : seg === "maybe"
            ? s.band === "maybe"
            : s.band === "no";
    },
    [view, state.segment],
  );

  const placeCounts = React.useMemo(() => {
    const c: Record<string, number> = {};
    for (const { job, s } of viewRows) {
      if (!segOk(s)) continue;
      for (const a of areasOf(job)) c[a] = (c[a] ?? 0) + 1;
    }
    return c;
  }, [viewRows, segOk]);

  const base = React.useMemo(
    () => viewRows.filter(({ job }) => inWhere(job, state.where)).map(({ s }) => s),
    [viewRows, state.where],
  );

  const segCounts = React.useMemo(() => {
    const c = { strong: 0, maybe: 0, no: 0 };
    for (const s of base) if (s.band) c[s.band]++;
    return c;
  }, [base]);

  const items = React.useMemo(() => [...base.filter(segOk)].sort(byRank), [base, segOk]);

  const whereLabel = (() => {
    const labels = PLACE_OPTIONS.filter((o) => state.where.includes(o.id)).map((o) => (o.kind === "remote" ? "remote" : o.label));
    if (labels.length <= 1) return labels[0] ?? "anywhere";
    return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
  })();

  const stored = state.selected[view];
  const selId = stored && items.some((i) => i.id === stored) ? stored : (items[0]?.id ?? null);
  const selJob = selId ? state.jobs.find((j) => j.id === selId) : undefined;
  const detail = selJob ? toDetail(selJob, weights, thresholds) : null;
  const selIndex = selId ? items.findIndex((i) => i.id === selId) : -1;

  const select = (id: string | null) => dispatch({ type: "select", view, id });

  const move = (d: number) => {
    if (!items.length) return;
    const idx = selIndex < 0 ? 0 : Math.max(0, Math.min(items.length - 1, selIndex + d));
    const next = items[idx];
    if (next) select(next.id);
  };

  const prepare = (id: string) => {
    const job = state.jobs.find((j) => j.id === id);
    if (!job) return;
    const appId = `app-${id}`;
    dispatch({ type: "createApp", jobId: id, appId });
    toast("Prepared application", {
      description: `${job.title} at ${job.company}. Resume, cover note and answers are ready to review.`,
      icon: <FileText className="text-brand-hi" />,
    });
    navigate(`/applications/${appId}`);
  };

  const act = (id: string, action: TriageAction) => {
    if (state.leavingId) return;
    const job = state.jobs.find((j) => j.id === id);
    if (!job) return;
    if (action === "open") {
      toast("Opening the posting", {
        description: `${job.title} at ${job.company}. Links are switched off in the prototype.`,
        icon: <ChevronUp className="rotate-45 text-fg-2" />,
      });
      return;
    }
    if (view === "shortlist" && action === "shortlist") {
      prepare(id);
      return;
    }
    const idx = items.findIndex((i) => i.id === id);
    const next = items[idx + 1] ?? items[idx - 1] ?? null;
    dispatch({ type: "leave", id });
    window.setTimeout(() => {
      dispatch({ type: "triage", id, to: ACTION_TO_STATE[action], view, nextId: next?.id ?? null });
    }, 170);
    const Icon = action === "shortlist" ? Bookmark : action === "skip" ? X : Archive;
    toastUndo(
      ACTION_PAST[action],
      () => {
        dispatch({ type: "undo" });
      },
      {
        description: `${job.title} · ${job.company}`,
        icon: <Icon className={action === "shortlist" ? "text-brand-hi" : "text-fg-3"} />,
      },
    );
  };

  const scoreOne = () => {
    if (!selJob?.pending) return;
    dispatch({ type: "scoreOne", id: selJob.id });
    const score = rank(selJob.pending, weights);
    const band = bandFor(score, thresholds);
    toast(`Scored ${score}, ${BAND_LABEL[band].toLowerCase()}`, {
      description: `${selJob.title} at ${selJob.company}. 1 model call.`,
      icon: <Sparkles className="text-strong" />,
    });
  };

  const scoreNext = () => {
    if (state.scoring) return;
    const total = 150;
    let done = 0;
    dispatch({ type: "scoring", progress: { done, total, found: 0 } });
    const areas = state.where.length ? state.where : DEFAULT_WHERE;
    const inAreas = (j: (typeof state.jobs)[number]) => (areasOf(j).some((a) => areas.includes(a)) ? 1 : 0);
    const batch = state.jobs
      .filter((j) => !j.dims && j.pending && j.state === "new")
      .sort((a, b) => inAreas(b) - inAreas(a) || b.prescore - a.prescore)
      .slice(0, 9);
    const matches = batch.filter((j) => bandFor(rank(j.pending!, weights), thresholds) !== "no");
    const id = window.setInterval(() => {
      done = Math.min(total, done + 4);
      const found = Math.round((done / total) * matches.length);
      dispatch({ type: "scoring", progress: { done, total, found } });
      if (done >= total) {
        window.clearInterval(id);
        dispatch({ type: "scoringDone", ids: batch.map((j) => j.id), calls: total });
        toast(`Scored ${total} jobs`, {
          description: `${matches.length} new ${matches.length === 1 ? "match" : "matches"}. They're in Top matches now.`,
          icon: <Sparkles className="text-strong" />,
          action: { label: "View", onClick: () => navigate("/") },
        });
      }
    }, 60);
  };

  useHotkeys({
    j: () => move(1),
    arrowdown: () => move(1),
    k: () => move(-1),
    arrowup: () => move(-1),
    s: () => selId && act(selId, "shortlist"),
    x: () => selId && act(selId, "skip"),
    a: () => selId && act(selId, "archive"),
    o: () => selId && act(selId, "open"),
    u: () => {
      if (!state.history.length) return;
      dispatch({ type: "undo" });
      toast("Restored", { description: "The last triage action was undone." });
    },
    t: () => dispatch({ type: "tune", open: !state.tuneOpen }),
    d: () => dispatch({ type: "density", density: state.density === "compact" ? "comfortable" : "compact" }),
    "1": () => view === "top" && dispatch({ type: "segment", segment: "matches" }),
    "2": () => view === "top" && dispatch({ type: "segment", segment: "strong" }),
    "3": () => view === "top" && dispatch({ type: "segment", segment: "maybe" }),
    enter: () => isMobile && selId && dispatch({ type: "mobileDetail", open: true }),
    escape: () => {
      if (state.tuneOpen) dispatch({ type: "tune", open: false });
      else if (state.mobileDetail) dispatch({ type: "mobileDetail", open: false });
    },
  });

  const scoredForTune = React.useMemo(
    () => state.jobs.filter((j) => j.dims && j.state === "new").map((j) => rank(j.dims!, weights)),
    [state.jobs, weights],
  );
  const tuneBands = React.useMemo(() => {
    const c = { strong: 0, maybe: 0, no: 0 };
    for (const s of scoredForTune) c[bandFor(s, thresholds)]++;
    return c;
  }, [scoredForTune, thresholds]);
  const tuneDirty =
    !sameWeights(weights, state.savedWeights) ||
    thresholds.strong !== state.savedThresholds.strong ||
    thresholds.maybe !== state.savedThresholds.maybe;

  const tune = (
    <TunePanel
      weights={weights}
      onWeightsChange={(w) => dispatch({ type: "weights", weights: w })}
      thresholds={thresholds}
      onThresholdsChange={(t) => dispatch({ type: "thresholds", thresholds: t })}
      scores={scoredForTune}
      bandCounts={tuneBands}
      dirty={tuneDirty}
      apiCalls={0}
      onSave={() => {
        dispatch({ type: "saveTune" });
        toast("Saved to criteria.yaml", {
          description: "The next scout ranks with these weights too.",
          icon: <SlidersHorizontal className="text-brand-hi" />,
        });
      }}
      onReset={() => dispatch({ type: "resetTune" })}
      onClose={() => dispatch({ type: "tune", open: false })}
    />
  );

  const detailEl = detail ? (
    <JobDetail
      job={detail}
      onAction={(a) => act(detail.id, a)}
      onTune={() => dispatch({ type: "tune", open: true })}
      onEditLogo={() => openLogoPicker(detail.company)}
      onScore={detail.score == null ? scoreOne : undefined}
      primary={
        view === "shortlist"
          ? { label: "Prepare application", icon: <FileText />, onClick: () => prepare(detail.id), kbd: "S" }
          : undefined
      }
    />
  ) : null;

  const empty =
    view === "top" ? (
      <EmptyState
        icon={Sparkles}
        title={
          state.where.length && viewRows.length
            ? `No matches in ${whereLabel} yet`
            : state.segment === "matches"
              ? "No matches left to triage"
              : "Nothing in this band"
        }
        body={
          state.where.length
            ? "Score more jobs to find matches here, or look anywhere to see the rest."
            : "Score more jobs to find new matches, or loosen the bands in Tune ranking."
        }
        action={
          <div className="flex gap-2">
            <Button size="sm" onClick={() => navigate("/unscored")}>
              <Sparkles />
              Score more jobs
            </Button>
            {state.where.length ? (
              <Button size="sm" variant="secondary" onClick={() => dispatch({ type: "where", where: [] })}>
                Look anywhere
              </Button>
            ) : null}
          </div>
        }
      />
    ) : view === "shortlist" ? (
      <EmptyState
        icon={Bookmark}
        title="Nothing shortlisted yet"
        body={
          <>
            Press <Kbd>S</Kbd> on a job in Top matches to keep it here until you prepare an application.
          </>
        }
        action={
          <Button size="sm" variant="secondary" onClick={() => navigate("/")}>
            Go to Top matches
          </Button>
        }
      />
    ) : view === "new" ? (
      <EmptyState
        icon={Inbox}
        title="Nothing new in the last 24 hours"
        body="Run the scout to check all boards for new postings now."
        action={
          <Button size="sm" onClick={runScout}>
            <Radar />
            Run scout
          </Button>
        }
      />
    ) : state.where.length && viewRows.length ? (
      <EmptyState
        icon={CircleDashed}
        title={`No unscored jobs in ${whereLabel}`}
        body="The rest are elsewhere. Look anywhere to see them."
        action={
          <Button size="sm" variant="secondary" onClick={() => dispatch({ type: "where", where: [] })}>
            Look anywhere
          </Button>
        }
      />
    ) : (
      <EmptyState icon={CircleDashed} title="Everything is scored" body="New postings from the next scout will appear here." />
    );

  const tuneButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={state.tuneOpen ? "secondary" : "ghost"}
          size="sm"
          onClick={() => dispatch({ type: "tune", open: !state.tuneOpen })}
          className={cn(state.tuneOpen && "text-brand-hi")}
        >
          <SlidersHorizontal />
          <span className="max-sm:hidden">Tune</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        Tune ranking <Kbd className="ml-1">T</Kbd>
      </TooltipContent>
    </Tooltip>
  );

  const densityButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={state.density === "compact" ? "Use comfortable rows" : "Use compact rows"}
          onClick={() =>
            dispatch({ type: "density", density: state.density === "compact" ? "comfortable" : "compact" })
          }
        >
          {state.density === "compact" ? <Rows3 /> : <Rows4 />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {state.density === "compact" ? "Comfortable rows" : "Compact rows"} <Kbd className="ml-1">D</Kbd>
      </TooltipContent>
    </Tooltip>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        icon={meta.icon}
        title={meta.title}
        count={view === "top" ? undefined : formatCount(items.length)}
        leading={
          isMobile ? (
            <Button variant="ghost" size="icon-sm" aria-label="Open navigation" onClick={openMobileNav}>
              <Menu />
            </Button>
          ) : null
        }
        actions={
          <>
            {tuneButton}
            {densityButton}
          </>
        }
      >
        {view === "top" ? (
          <Segmented<Segment>
            aria-label="Match band"
            value={state.segment}
            onChange={(s) => dispatch({ type: "segment", segment: s })}
            className="max-sm:order-last max-sm:max-w-full max-sm:overflow-x-auto"
            options={[
              { value: "matches", label: "All matches", count: segCounts.strong + segCounts.maybe },
              { value: "strong", label: "Strong", count: segCounts.strong, dot: "bg-strong" },
              { value: "maybe", label: "Maybe", count: segCounts.maybe, dot: "bg-maybe" },
              { value: "weak", label: "Weak", count: segCounts.no, dot: "bg-no" },
            ]}
          />
        ) : null}
      </PageHeader>

      {LISTINGS_FRAME ? (
        <ListingsBanner checkedOn="26 Oct 2026" onRefresh={refreshListings} />
      ) : null}

      {view === "unscored" ? <UnscoredHero onScore={scoreNext} /> : null}

      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-2 max-md:px-4">
        <PlaceFilter
          value={state.where}
          onChange={(w) => dispatch({ type: "where", where: w })}
          options={PLACE_OPTIONS.map((o) => ({ ...o, count: placeCounts[o.id] ?? 0 }))}
        />
        <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-line-2 max-md:hidden" />
        <FilterChip
          label="Seen"
          value={state.posted}
          defaultValue="any"
          onChange={(v) => dispatch({ type: "posted", posted: v })}
          options={[
            { value: "any", label: "Any time" },
            { value: "1d", label: "Last 24 hours" },
            { value: "7d", label: "Last 7 days" },
            { value: "30d", label: "Last 30 days" },
          ]}
        />
        <span className="ml-auto shrink-0 text-xs text-fg-3 max-sm:hidden">
          <span className="tnum text-fg-2">{formatCount(items.length)}</span> {items.length === 1 ? "job" : "jobs"}, by{" "}
          {view === "unscored" ? "prescore" : "rank"}
        </span>
        <span className="ml-3 hidden shrink-0 items-center gap-1 text-2xs text-fg-4 xl:inline-flex">
          <Kbd>J</Kbd>
          <Kbd>K</Kbd> move
          <span className="w-1.5" />
          <Kbd>?</Kbd> shortcuts
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          className={cn(
            "min-h-0",
            isMobile ? "w-full" : "w-[44%] min-w-[340px] max-w-[600px] border-r border-line",
          )}
        >
          <JobList
            items={items}
            selectedId={selId}
            leavingId={state.leavingId}
            density={state.density}
            aria-label={meta.title}
            onSelect={(id) => {
              select(id);
              if (isMobile) dispatch({ type: "mobileDetail", open: true });
            }}
            onAction={act}
            emptyState={empty}
          />
        </div>

        {isMobile ? null : (
          <div className="relative min-h-0 min-w-0 flex-1">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={state.tuneOpen ? "tune" : "detail"}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="absolute inset-0"
              >
                {state.tuneOpen ? (
                  tune
                ) : detailEl ? (
                  detailEl
                ) : (
                  <EmptyState icon={meta.icon} title="Select a job" body="Pick a job on the left to see why it ranked where it did." />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        )}
      </div>

      {isMobile && state.tuneOpen ? (
        <div className="fixed inset-0 z-40 flex flex-col bg-panel pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] animate-sheet-in">{tune}</div>
      ) : null}

      {isMobile && state.mobileDetail && detailEl && !state.tuneOpen ? (
        <div className="fixed inset-0 z-40 flex flex-col bg-panel pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] animate-sheet-in">
          <div className="flex items-center gap-1 border-b border-line px-2 py-1.5 pr-[max(8px,env(safe-area-inset-right,0px))]">
            <Button variant="ghost" size="sm" onClick={() => dispatch({ type: "mobileDetail", open: false })}>
              <ChevronLeft />
              {meta.title}
            </Button>
            <span className="ml-auto text-xs tnum text-fg-3">
              {selIndex + 1} of {items.length}
            </span>
            <Button variant="ghost" size="icon-sm" aria-label="Previous job" onClick={() => move(-1)}>
              <ChevronUp />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Next job" onClick={() => move(1)}>
              <ChevronDown />
            </Button>
          </div>
          <div className="min-h-0 flex-1">{detailEl}</div>
        </div>
      ) : null}
    </div>
  );
}

function UnscoredHero({ onScore }: { onScore: () => void }) {
  const { state } = useDemo();
  const passed = state.scoredCount + state.unscoredCount;
  const pct = (state.scoredCount / Math.max(1, passed)) * 100;
  const s = state.scoring;
  return (
    <div className="border-b border-line px-5 py-4 max-md:px-4">
      <div className="surface-card relative overflow-hidden rounded-xl p-4 sm:flex sm:items-center sm:gap-6 sm:p-5">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full opacity-70 blur-3xl"
          style={{ background: "radial-gradient(closest-side, var(--color-brand-wash), transparent)" }}
        />
        <div className="relative min-w-0 flex-1">
          <h2 className="text-lg font-semibold tracking-tight text-fg">
            <span className="tnum">{formatCount(state.unscoredCount)}</span> jobs are waiting for a score
          </h2>
          <p className="mt-1 max-w-[62ch] text-sm text-fg-2">
            Scoring starts with jobs in Portland, Phoenix or remote, then goes by prescore, so model calls go to jobs
            you could actually take. Each batch is capped at 150.
          </p>
          <div className="mt-3.5 h-1.5 overflow-hidden rounded-full bg-surface-4">
            <div
              className="h-full rounded-full bg-linear-to-r from-brand-lo to-brand-hi transition-[width] duration-700 ease-out-expo"
              style={{ width: `${Math.max(pct, 1)}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-3">
            <span>
              <b className="font-semibold tnum text-fg">{formatCount(state.scoredCount)}</b> scored ({pct.toFixed(0)}%)
            </span>
            <span>
              <b className="font-semibold tnum text-fg">{formatCount(state.unscoredCount)}</b> waiting
            </span>
            <span>
              <b className="font-semibold tnum text-fg">241</b> removed by the four gates
            </span>
          </div>
        </div>
        <div className="relative mt-4 shrink-0 sm:mt-0 sm:w-56">
          {s ? (
            <div className="rounded-lg border border-brand/30 bg-brand-wash p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-fg">Scoring</span>
                <span className="tnum text-fg-2">
                  {s.done} of {s.total}
                </span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-4">
                <div
                  className="h-full rounded-full bg-brand-hi transition-[width] duration-100"
                  style={{ width: `${(s.done / s.total) * 100}%` }}
                />
              </div>
              <div className="mt-1.5 text-2xs text-fg-3">
                <span className="tnum text-strong">{s.found}</span> new matches so far
              </div>
            </div>
          ) : (
            <>
              <Button size="lg" className="w-full" onClick={onScore}>
                <Sparkles />
                Score next 150
              </Button>
              <p className="mt-1.5 text-center text-2xs text-fg-3">Your places first</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
