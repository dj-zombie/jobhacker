'use client';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatCount } from '@/lib/format';
import { ChevronDown, Sparkles } from 'lucide-react';
import type { ScoreRunState } from '../../core/pipeline/score-run.js';
import type { ScoringSummary } from '../../core/pipeline/triage.js';

/**
 * The Unscored view's hero (J5, frame 09): how much is scored, waiting and gated, and Score next N.
 * The gated count opens the per-gate breakdown `pnpm cli funnel` prints.
 */
export function UnscoredHero({
  summary,
  run,
  firstLabel,
  starting,
  onScore,
}: {
  summary: ScoringSummary;
  /** A Score next batch in progress; null when none is running. */
  run: ScoreRunState | null;
  /** "Portland, Phoenix or remote": the places a batch takes first. Empty when there are none. */
  firstLabel: string;
  starting: boolean;
  onScore: () => void;
}) {
  const passed = summary.scored + summary.waiting;
  const pct = (summary.scored / Math.max(1, passed)) * 100;
  const progress = run?.progress;
  return (
    <div className="border-b border-line px-5 py-4 max-md:px-4">
      <div className="surface-card relative overflow-hidden rounded-xl p-4 sm:flex sm:items-center sm:gap-6 sm:p-5">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full opacity-70 blur-3xl"
          style={{
            background: 'radial-gradient(closest-side, var(--color-brand-wash), transparent)',
          }}
        />
        <div className="relative min-w-0 flex-1">
          <h2 className="text-lg font-semibold tracking-tight text-fg">
            <span className="tnum">{formatCount(summary.waiting)}</span>{' '}
            {summary.waiting === 1 ? 'job is' : 'jobs are'} waiting for a score
          </h2>
          <p className="mt-1 max-w-[62ch] text-sm text-fg-2">
            {firstLabel
              ? `Scoring starts with jobs in ${firstLabel}, then goes by prescore, so model calls go to jobs you could actually take.`
              : 'Scoring goes by prescore, so model calls go to the likeliest fits first.'}{' '}
            Each batch is capped at {formatCount(summary.cap)}.
          </p>
          <div className="mt-3.5 h-1.5 overflow-hidden bg-surface-4" aria-hidden>
            <div
              className="h-full bg-linear-to-r from-brand-lo to-brand-hi transition-[width] duration-700 ease-out-expo [clip-path:polygon(0_0,100%_0,calc(100%-6px)_100%,0_100%)]"
              style={{ width: `${Math.max(pct, 1)}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-3">
            <span>
              <b className="font-semibold tnum text-fg">{formatCount(summary.scored)}</b> scored (
              {pct.toFixed(0)}%)
            </span>
            <span>
              <b className="font-semibold tnum text-fg">{formatCount(summary.waiting)}</b> waiting
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-sm outline-none hover:text-fg-2 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-uv-hi">
                <b className="font-semibold tnum text-fg">{formatCount(summary.gated)}</b> removed
                by the four gates
                <ChevronDown aria-hidden className="size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuLabel>Removed by the gates</DropdownMenuLabel>
                <ul className="px-2 pb-1.5 text-xs">
                  {summary.gates.map((g) => (
                    <li key={g.gate} className="flex items-baseline justify-between gap-3 py-1">
                      <span className="text-fg-2">{g.label}</span>
                      <span className="tnum text-fg">{formatCount(g.count)}</span>
                    </li>
                  ))}
                  {summary.notYetGated > 0 ? (
                    <li className="flex items-baseline justify-between gap-3 py-1">
                      <span className="text-fg-2">not yet gated</span>
                      <span className="tnum text-fg">{formatCount(summary.notYetGated)}</span>
                    </li>
                  ) : null}
                </ul>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="relative mt-4 shrink-0 sm:mt-0 sm:w-56">
          {run && progress ? (
            <div className="rounded-lg border border-brand/30 bg-brand-wash p-3" aria-live="polite">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-fg">Scoring</span>
                <span className="tnum text-fg-2">
                  {formatCount(progress.done)} of {formatCount(progress.total)}
                </span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-4">
                <div
                  className="h-full rounded-full bg-brand-hi transition-[width] duration-500"
                  style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
                />
              </div>
              <div className="mt-1.5 text-2xs text-fg-3">
                <span className="tnum text-strong">{formatCount(progress.found)}</span> new{' '}
                {progress.found === 1 ? 'match' : 'matches'} so far
              </div>
            </div>
          ) : (
            <>
              <Button size="lg" className="w-full" onClick={onScore} disabled={starting}>
                <Sparkles />
                Score next {formatCount(summary.cap)}
              </Button>
              <p className="mt-1.5 text-center text-2xs text-fg-3">
                {firstLabel ? 'Your places first' : 'Best prescore first'}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
