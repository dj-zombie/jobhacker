import { and, desc, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { runsRepo } from '../db/repo/runs.js';
import { type Run, runs } from '../db/schema.js';
import type { Clock } from '../util/clock.js';
import { type ScoreDeps, type ScoreProgress, scoreNewJobs } from './score.js';
import { ABANDONED_AFTER_MS } from './scout-card.js';

/**
 * A score batch started from the app (J5): Score next on the Unscored view, or Score this job.
 * The batch runs in the server process after the request that started it returns, and writes its
 * progress to its `runs` row after every model attempt. The UI polls that row (D95), so a batch
 * never holds a server action open and triage keeps working while it runs.
 */

/**
 * A score run that hasn't written progress for this long has stopped: its process went away.
 * Progress is written after every model attempt, which takes seconds. A scout also writes
 * progress (J8), and still keeps the longer `ABANDONED_AFTER_MS`: one slow board must not
 * make a live scout look abandoned.
 */
export const SCORE_STALLED_AFTER_MS = 15 * 60 * 1000;

/** What a batch stores in `runs.stats` while it runs, and alongside its `ScoreStats` after. */
interface Tracked {
  progress: ScoreProgress;
  first: string[];
  jobIds: number[] | null;
  /** When the run last wrote progress. */
  beatAt: string | null;
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
  if (run.kind !== 'score') return nowMs - Date.parse(run.startedAt) < ABANDONED_AFTER_MS;
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
  opened: Omit<Tracked, 'progress' | 'beatAt'> = { first: [], jobIds: null },
): (progress: ScoreProgress) => Tracked {
  const repo = runsRepo(db, clock);
  return (progress) => {
    const tracked: Tracked = { ...opened, progress, beatAt: clock.now() };
    repo.progress(runId, tracked);
    return tracked;
  };
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
  options: { first: readonly string[]; jobIds?: readonly number[] },
): number {
  const tx = db.$client.transaction((): number => {
    const live = liveScoringRun(db, clock);
    if (live) throw new ScoreBusyError(live.kind);
    const id = runsRepo(db, clock).start('score');
    trackScoreRun(db, clock, id, {
      first: [...options.first],
      jobIds: options.jobIds ? [...options.jobIds] : null,
    })({ done: 0, total: 0, found: 0 });
    return id;
  });
  return tx.immediate();
}

/** Run an opened batch to the end. Never throws: a failure is recorded on the run. */
export async function runScoreBatch(
  runId: number,
  deps: Omit<ScoreDeps, 'first' | 'jobIds' | 'onProgress'>,
): Promise<void> {
  const repo = runsRepo(deps.db, deps.clock);
  let tracked: Tracked = readTracked(repo.get(runId)?.stats) ?? {
    progress: { done: 0, total: 0, found: 0 },
    first: [],
    jobIds: null,
    beatAt: null,
  };
  const track = trackScoreRun(deps.db, deps.clock, runId, tracked);
  try {
    const { stats } = await scoreNewJobs({
      ...deps,
      first: tracked.first,
      ...(tracked.jobIds ? { jobIds: tracked.jobIds } : {}),
      onProgress: (progress) => {
        tracked = track(progress);
      },
    });
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
  const tracked = readTracked(run.stats) ?? {
    progress: { done: 0, total: 0, found: 0 },
    first: [],
    jobIds: null,
    beatAt: null,
  };
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
    ? { ...result.stats, progress: tracked.progress, beatAt: tracked.beatAt }
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
    beatAt: typeof s.beatAt === 'string' ? s.beatAt : null,
  };
}
