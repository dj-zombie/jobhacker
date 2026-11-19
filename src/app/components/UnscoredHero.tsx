'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatCount } from '@/lib/format';
import { ChevronDown, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { type ScorePace, formatScoreDuration } from '../../core/pipeline/score-format.js';
import type { ScoreRunState } from '../../core/pipeline/score-run.js';
import type { ScoringSummary } from '../../core/pipeline/triage.js';
import type { ScoreNextChoice } from '../lib/actions.js';
import { usd } from '../lib/settings-format.js';

/**
 * The Unscored view's hero (J5, frame 09; J28 adds the longer runs).
 * Score next stays one click at the config cap. The menu can score the rest of
 * the places, everything waiting, or a number, after a confirm. Stop finishes
 * calls already sent.
 */
export function UnscoredHero({
  summary,
  pace,
  run,
  firstLabel,
  placesWaiting,
  industryLabel,
  starting,
  stopping,
  onScore,
  onStop,
}: {
  summary: ScoringSummary;
  pace: ScorePace | null;
  /** A Score next batch in progress; null when none is running. */
  run: ScoreRunState | null;
  /** "Portland, Phoenix or remote": the places a batch takes first. Empty when there are none. */
  firstLabel: string;
  /** Waiting jobs on this list that sit in those places. */
  placesWaiting: number;
  /** When set, companies in this industry are scored before those places. */
  industryLabel?: string | null;
  starting: boolean;
  stopping: boolean;
  onScore: (choice?: ScoreNextChoice) => void;
  onStop: () => void;
}) {
  const passed = summary.scored + summary.waiting;
  const pct = (summary.scored / Math.max(1, passed)) * 100;
  const progress = run?.progress;
  const [menuOpen, setMenuOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const ask = (next: Confirm) => {
    setMenuOpen(false);
    setConfirm(next);
  };

  const askCustom = () => {
    const typed = Number(custom.trim());
    if (!Number.isInteger(typed) || typed < 1) return;
    const jobs = Math.min(typed, summary.waiting);
    ask({
      kind: 'custom',
      jobs,
      note:
        typed > summary.waiting
          ? `That's more than the ${formatCount(summary.waiting)} waiting, so this scores ${formatCount(jobs)}.`
          : null,
    });
  };

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
            {firstLabel ? (
              <>
                <span className="tnum">{formatCount(placesWaiting)}</span> of them{' '}
                {placesWaiting === 1 ? 'is' : 'are'} in {firstLabel}. Scoring starts there, then
                goes by prescore, so model calls go to jobs you could actually take.
              </>
            ) : (
              'Scoring goes by prescore, so model calls go to the likeliest fits first.'
            )}{' '}
            Score next is capped at {formatCount(summary.cap)}. The menu can run longer.
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
        <div className="relative mt-4 shrink-0 sm:mt-0 sm:w-64">
          {run && progress ? (
            <div className="rounded-lg border border-brand/30 bg-brand-wash p-3" aria-live="polite">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-fg">{run.stop ? 'Stopping' : 'Scoring'}</span>
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
              <div className="mt-1.5 flex items-center justify-between gap-2 text-2xs text-fg-3">
                <span>
                  <span className="tnum text-strong">{formatCount(progress.found)}</span> new{' '}
                  {progress.found === 1 ? 'match' : 'matches'} so far
                </span>
                <button
                  type="button"
                  className="font-medium text-fg-2 underline-offset-2 hover:text-fg hover:underline focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-uv-hi disabled:opacity-45"
                  onClick={onStop}
                  disabled={stopping || run.stop}
                >
                  {stopping || run.stop ? 'Stopping…' : 'Stop'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex w-full">
                <Button
                  size="lg"
                  className="min-w-0 flex-1 rounded-r-none"
                  onClick={() => onScore()}
                  disabled={starting}
                >
                  <Sparkles />
                  Score next {formatCount(summary.cap)}
                </Button>
                <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="lg"
                      className="rounded-l-none border-l border-white/25 px-2.5"
                      aria-label="More ways to score"
                      disabled={starting}
                    >
                      <ChevronDown />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-72">
                    <DropdownMenuLabel>This run</DropdownMenuLabel>
                    {firstLabel ? (
                      <DropdownMenuItem
                        disabled={placesWaiting < 1}
                        onSelect={() => ask({ kind: 'places', jobs: placesWaiting, note: null })}
                      >
                        <span className="min-w-0 flex-1">Rest of {firstLabel}</span>
                        <span className="tnum text-fg-3">{formatCount(placesWaiting)}</span>
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      disabled={summary.waiting < 1}
                      onSelect={() => ask({ kind: 'all', jobs: summary.waiting, note: null })}
                    >
                      <span className="min-w-0 flex-1">Everything waiting</span>
                      <span className="tnum text-fg-3">{formatCount(summary.waiting)}</span>
                    </DropdownMenuItem>
                    <div
                      className="mt-1 border-t border-line px-2 py-2"
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <label htmlFor="score-custom" className="hud-label text-fg-3">
                        A number
                      </label>
                      <div className="mt-1.5 flex gap-1.5">
                        <input
                          id="score-custom"
                          inputMode="numeric"
                          value={custom}
                          onChange={(event) => setCustom(event.target.value.replace(/[^\d]/g, ''))}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              askCustom();
                            }
                          }}
                          className="h-8 min-w-0 flex-1 rounded-md border border-line-2 bg-surface-1 px-2 font-mono text-sm tnum text-fg outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-uv-hi"
                          placeholder={formatCount(summary.cap)}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={custom.length === 0 || summary.waiting < 1}
                          onClick={askCustom}
                        >
                          Score
                        </Button>
                      </div>
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <p className="mt-1.5 text-center text-2xs text-fg-3">
                {industryLabel
                  ? `${industryLabel} first, then your places`
                  : firstLabel
                    ? 'Your places first'
                    : 'Best prescore first'}
              </p>
            </>
          )}
        </div>
      </div>
      <ScoreConfirm
        confirm={confirm}
        firstLabel={firstLabel}
        pace={pace}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        onConfirm={() => {
          if (!confirm) return;
          const choice =
            confirm.kind === 'places'
              ? { limit: confirm.jobs, onlyFirst: true }
              : { limit: confirm.jobs };
          setConfirm(null);
          onScore(choice);
        }}
      />
    </div>
  );
}

interface Confirm {
  kind: 'places' | 'all' | 'custom';
  jobs: number;
  note: string | null;
}

function ScoreConfirm({
  confirm,
  firstLabel,
  pace,
  onOpenChange,
  onConfirm,
}: {
  confirm: Confirm | null;
  firstLabel: string;
  pace: ScorePace | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const jobs = confirm?.jobs ?? 0;
  const estimate = estimateLine(jobs, pace);
  const lead =
    confirm?.kind === 'places'
      ? `Score ${formatCount(jobs)} ${jobs === 1 ? 'job' : 'jobs'} in ${firstLabel}.`
      : confirm?.kind === 'all'
        ? `Score all ${formatCount(jobs)} waiting ${jobs === 1 ? 'job' : 'jobs'}.`
        : `Score ${formatCount(jobs)} ${jobs === 1 ? 'job' : 'jobs'}.`;
  const tail =
    confirm?.kind === 'places'
      ? 'Jobs outside those places stay waiting.'
      : 'This keeps going if you leave the page. It stops if you quit the app or click Stop.';
  return (
    <Dialog open={confirm !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-hidden p-0">
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-wash ring-1 ring-brand/30">
            <Sparkles className="size-4 text-brand-hi" />
          </span>
          <div className="min-w-0">
            <DialogTitle className="text-md font-semibold text-fg">Score this many</DialogTitle>
            <DialogDescription className="mt-1 text-sm text-fg-2">
              {confirm?.note ? `${confirm.note} ` : null}
              {lead} {estimate ? `${estimate} ` : null}
              {tail}
            </DialogDescription>
          </div>
          <DialogClose className="ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-3 hover:bg-surface-3 hover:text-fg focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-uv-hi">
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogClose>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm}>
            Score
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function estimateLine(jobs: number, pace: ScorePace | null): string | null {
  if (!pace || jobs < 1) return null;
  const cost = pace.perScoreUsd == null ? null : `About ${usd(jobs * pace.perScoreUsd)}`;
  const time = pace.secondsEach == null ? null : formatScoreDuration(jobs * pace.secondsEach);
  if (cost && time) return `${cost}, ${time}.`;
  if (cost) return `${cost}.`;
  if (time) return `${time[0]?.toUpperCase()}${time.slice(1)}.`;
  return null;
}
