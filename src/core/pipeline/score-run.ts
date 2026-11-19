import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { costPerScore } from '../config/staleness.js';
import type { Db } from '../db/client.js';
import { runsRepo, scoutRunIsLive } from '../db/repo/runs.js';
import { type Run, runs } from '../db/schema.js';
import type { Clock } from '../util/clock.js';
import { SCORE_CONCURRENCY, type ScorePace } from './score-format.js';
import { type ScoreDeps, type ScoreProgress, scoreNewJobs } from './score.js';

export { formatScoreDuration, formatScorePlan, type ScorePace } from './score-format.js';

/**
 * A score batch started from the app (J5): Score next on the Unscored view, or Score this job.
 * The batch runs in the server process after the request that started it returns, and writes its
 * progress to its `runs` row after every model attempt. The UI polls that row (D95), so a batch
 * never holds a server action open and triage keeps working while it runs.
 */

/**
 * A score run that hasn't written progress for this long has stopped: its process went away.
 * Progress is written after every model attempt, which takes seconds. A scout is judged by
 * its own heartbeat (`scoutRunIsLive`): the process rewrites it while the run is alive, so
 * one slow board stays live, and a stopped server does not.
 */
export const SCORE_STALLED_AFTER_MS = 15 * 60 * 1000;

/** What a batch stores in `runs.stats` while it runs, and alongside its `ScoreStats` after. */
interface Tracked {
  progress: ScoreProgress;
  first: string[];
  jobIds: number[] | null;
  /** Industry taken first, when the view had one selected. Null otherwise. */
  industry: string | null;
  /** When the run last wrote progress. */
  beatAt: string | null;
  /** Set when Kris stops the run. Calls already sent still finish. */
  stop: boolean;
  /** Model calls kept in flight. Runs from before D178 omit it and count as 1. */
  concurrency: number;
  /** Score only jobs in `first`. */
  onlyFirst: boolean;
  /** This run's cap, when one was asked for. Null uses the config cap. */
  limit: number | null;
}

const OPEN_DEFAULTS = {
  first: [] as string[],
  jobIds: null as number[] | null,
  industry: null as string | null,
  onlyFirst: false,
  limit: null as number | null,
  stop: false,
  concurrency: SCORE_CONCURRENCY,
};

function blankTracked(): Tracked {
  return { ...OPEN_DEFAULTS, progress: { done: 0, total: 0, found: 0 }, beatAt: null };
}

export interface ScoreRunState extends Tracked {
  runId: number;
  running: boolean;
  /** Null while running. */
  ok: boolean | null;
  error: string | null;
  /** True when the run stopped without finishing: the server went away mid-batch. */
  abandoned: boolean;
}

export class ScoreBusyError extends Error {
  constructor(readonly kind: Run['kind']) {
    super(
      kind === 'scout'
        ? 'A scout is running; it scores as it goes.'
        : 'A score run is already going.',
    );
    this.name = 'ScoreBusyError';
  }
}

function isLive(run: Pick<Run, 'kind' | 'startedAt' | 'finishedAt' | 'stats'>, nowMs: number) {
  if (run.finishedAt !== null) return false;
  if (run.kind === 'scout') return scoutRunIsLive(run, nowMs);
  const last = readTracked(run.stats)?.beatAt ?? run.startedAt;
  return nowMs - Date.parse(last) < SCORE_STALLED_AFTER_MS;
}

/**
 * The `onProgress` for a score run: writes the progress and a heartbeat to the run's row, so the
 * UI can follow it and a run whose process died stops counting as live.
 */
export function trackScoreRun(
  db: Db,
  clock: Clock,
  runId: number,
  opened: Omit<Tracked, 'progress' | 'beatAt'> = OPEN_DEFAULTS,
): (progress: ScoreProgress) => Tracked {
  const repo = runsRepo(db, clock);
  return (progress) => {
    const existing = readTracked(repo.get(runId)?.stats);
    const tracked: Tracked = {
      ...opened,
      progress,
      beatAt: clock.now(),
      stop: existing?.stop === true,
      concurrency: SCORE_CONCURRENCY,
    };
    repo.progress(runId, tracked);
    return tracked;
  };
}

/** Ask a live score run to stop starting calls. Returns false when there is nothing to stop. */
export function requestScoreStop(db: Db, clock: Clock, runId: number): boolean {
  const repo = runsRepo(db, clock);
  const run = repo.get(runId);
  if (!run || run.kind !== 'score' || run.finishedAt !== null) return false;
  const tracked = readTracked(run.stats) ?? blankTracked();
  repo.progress(runId, { ...tracked, stop: true, beatAt: clock.now() });
  return true;
}

/** Dollars and wall-clock seconds for one more scoring call, from runs already finished. */
export function scorePace(db: Db, clock: Clock, model: string): ScorePace {
  const basis = costPerScore(db, clock, model);
  const recent = db
    .select()
    .from(runs)
    .where(and(eq(runs.kind, 'score'), eq(runs.ok, true)))
    .orderBy(desc(runs.id))
    .limit(40)
    .all();
  let secondsEach: number | null = null;
  for (const run of recent) {
    if (run.finishedAt === null) continue;
    const scored = scoredOf(run.stats);
    if (scored === null || scored <= 0) continue;
    const duration = (Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000;
    if (!Number.isFinite(duration) || duration <= 0) continue;
    // A one-job run still records `SCORE_CONCURRENCY`, but it only filled one slot.
    // Scale by the jobs that actually overlapped, or a later estimate counts that
    // one call as six and the confirm runs long.
    const filled = Math.min(concurrencyOf(run.stats), scored);
    secondsEach = (duration / scored) * (filled / SCORE_CONCURRENCY);
    break;
  }
  return { perScoreUsd: basis?.perScoreUsd ?? null, secondsEach };
}

/** The scout or score run still going, if any. Both call the model, so only one runs at a time. */
export function liveScoringRun(db: Db, clock: Clock): Run | undefined {
  const open = db
    .select()
    .from(runs)
    .where(and(inArray(runs.kind, ['scout', 'score']), isNull(runs.finishedAt)))
    .orderBy(desc(runs.id))
    .all();
  return open.find((run) => isLive(run, clock.nowMs()));
}

/** Open a score run for a batch. Throws `ScoreBusyError` while a scout or another batch is live. */
export function startScoreRun(
  db: Db,
  clock: Clock,
  options: {
    first: readonly string[];
    jobIds?: readonly number[];
    industry?: string;
    /** Absent: the config cap. Present: this run's cap, even above it. */
    limit?: number;
    onlyFirst?: boolean;
  },
): number {
  const tx = db.$client.transaction((): number => {
    const live = liveScoringRun(db, clock);
    if (live) throw new ScoreBusyError(live.kind);
    const id = runsRepo(db, clock).start('score');
    trackScoreRun(db, clock, id, {
      first: [...options.first],
      jobIds: options.jobIds ? [...options.jobIds] : null,
      industry: options.industry ?? null,
      onlyFirst: options.onlyFirst === true,
      limit: options.limit ?? null,
      stop: false,
      concurrency: SCORE_CONCURRENCY,
    })({ done: 0, total: 0, found: 0 });
    return id;
  });
  return tx.immediate();
}

/** Run an opened batch to the end. Never throws: a failure is recorded on the run. */
export async function runScoreBatch(
  runId: number,
  deps: Omit<ScoreDeps, 'first' | 'jobIds' | 'onProgress'> & {
    /** Called after the run row is updated. The CLI prints its plan from the first one. */
    onProgress?: ScoreDeps['onProgress'];
  },
): Promise<void> {
  const repo = runsRepo(deps.db, deps.clock);
  let tracked: Tracked = readTracked(repo.get(runId)?.stats) ?? blankTracked();
  const track = trackScoreRun(deps.db, deps.clock, runId, tracked);
  try {
    const { stats } = await scoreNewJobs({
      ...deps,
      first: tracked.first,
      ...(tracked.industry ? { industry: tracked.industry } : {}),
      ...(tracked.jobIds ? { jobIds: tracked.jobIds } : {}),
      ...(tracked.limit != null ? { limit: tracked.limit } : {}),
      ...(tracked.onlyFirst ? { onlyFirst: true } : {}),
      shouldStop: () => readTracked(repo.get(runId)?.stats)?.stop === true,
      onProgress: (progress) => {
        tracked = track(progress);
        deps.onProgress?.(progress);
      },
    });
    const stopped = readTracked(repo.get(runId)?.stats)?.stop === true || tracked.stop;
    tracked = { ...tracked, stop: stopped };
    repo.finish(runId, { ok: true, stats: { ...stats, ...tracked } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.log.error({ runId, err: message }, 'score batch failed');
    repo.finish(runId, { ok: false, error: message, stats: tracked });
  }
}

/** A batch's state for the UI, or undefined when the id isn't a score run. */
export function scoreRunState(db: Db, clock: Clock, runId: number): ScoreRunState | undefined {
  const run = runsRepo(db, clock).get(runId);
  if (!run || run.kind !== 'score') return undefined;
  const tracked = readTracked(run.stats) ?? blankTracked();
  const running = isLive(run, clock.nowMs());
  return {
    runId,
    ...tracked,
    running,
    ok: run.finishedAt === null ? null : run.ok,
    error: run.error,
    abandoned: run.finishedAt === null && !running,
  };
}

/**
 * Close a score run and keep the progress the heartbeat wrote. `pnpm cli score` used to replace
 * `stats` with the score summary alone, so a page watching the run toasted "Scored 0 jobs".
 */
export function finishWithProgress(
  db: Db,
  clock: Clock,
  runId: number,
  result: { ok: boolean; stats: object; error?: string | null },
): void {
  const repo = runsRepo(db, clock);
  const tracked = readTracked(repo.get(runId)?.stats);
  const stats = tracked
    ? {
        ...result.stats,
        progress: tracked.progress,
        beatAt: tracked.beatAt,
        stop: tracked.stop,
        concurrency: tracked.concurrency,
        onlyFirst: tracked.onlyFirst,
        limit: tracked.limit,
      }
    : result.stats;
  repo.finish(runId, { ok: result.ok, stats, error: result.error ?? null });
}

function readTracked(stats: unknown): Tracked | null {
  if (!stats || typeof stats !== 'object') return null;
  const s = stats as Record<string, unknown>;
  const p = s.progress as Record<string, unknown> | undefined;
  if (!p || typeof p !== 'object') return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const first = Array.isArray(s.first)
    ? s.first.filter((a): a is string => typeof a === 'string')
    : [];
  const jobIds = Array.isArray(s.jobIds)
    ? s.jobIds.filter((id): id is number => typeof id === 'number')
    : null;
  return {
    progress: { done: num(p.done), total: num(p.total), found: num(p.found) },
    first,
    jobIds,
    industry: typeof s.industry === 'string' ? s.industry : null,
    beatAt: typeof s.beatAt === 'string' ? s.beatAt : null,
    stop: s.stop === true,
    concurrency: num(s.concurrency) > 0 ? num(s.concurrency) : 1,
    onlyFirst: s.onlyFirst === true,
    limit: typeof s.limit === 'number' && Number.isFinite(s.limit) ? s.limit : null,
  };
}

function scoredOf(stats: unknown): number | null {
  if (!stats || typeof stats !== 'object') return null;
  const scored = (stats as { scored?: unknown }).scored;
  return typeof scored === 'number' && Number.isFinite(scored) ? scored : null;
}

function concurrencyOf(stats: unknown): number {
  if (!stats || typeof stats !== 'object') return 1;
  const concurrency = (stats as { concurrency?: unknown }).concurrency;
  return typeof concurrency === 'number' && concurrency > 0 ? concurrency : 1;
}
