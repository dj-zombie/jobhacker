import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Clock } from '../../util/clock.js';
import type { Db } from '../client.js';
import { type Run, type RunKind, runs } from '../schema.js';

export type { RunKind };

/**
 * How often a live scout rewrites `beatAt`. A slow board, and the work after the
 * last board, still count as running for as long as this process is alive.
 */
export const SCOUT_HEARTBEAT_MS = 20_000;

/**
 * A scout with no heartbeat for this long has stopped. The process is gone.
 * One missed rewrite is not enough: the gap is several beats, so a stall in the
 * event loop during the sync tail does not look like a crash.
 */
export const SCOUT_STALLED_AFTER_MS = 3 * 60 * 1000;

/** `beatAt` on a scout's stats, when it is a parseable timestamp. */
export function scoutBeatAt(stats: unknown): string | null {
  if (!stats || typeof stats !== 'object') return null;
  const beat = (stats as { beatAt?: unknown }).beatAt;
  if (typeof beat !== 'string' || Number.isNaN(Date.parse(beat))) return null;
  return beat;
}

/**
 * An unfinished scout whose last heartbeat is still fresh. A run that never wrote
 * one is judged from its start, so a crash before the first beat still expires.
 */
export function scoutRunIsLive(
  run: { startedAt: string; finishedAt: string | null; stats: unknown },
  nowMs: number,
): boolean {
  if (run.finishedAt !== null) return false;
  const at = Date.parse(scoutBeatAt(run.stats) ?? run.startedAt);
  if (Number.isNaN(at)) return false;
  return nowMs - at < SCOUT_STALLED_AFTER_MS;
}

/**
 * Repository for the `runs` table — the bookkeeping row that wraps each
 * pipeline execution (ARCHITECTURE § Flows).
 */
export function runsRepo(db: Db, clock: Clock) {
  return {
    /** The scout still going, if any. An unfinished scout with a stale heartbeat crashed. */
    liveScout(): Run | undefined {
      const open = db
        .select()
        .from(runs)
        .where(and(eq(runs.kind, 'scout'), isNull(runs.finishedAt)))
        .orderBy(desc(runs.id))
        .all();
      const now = clock.nowMs();
      return open.find((run) => scoutRunIsLive(run, now));
    },

    /**
     * Set some keys of a finished run's stats, leaving the rest. `boards:relocate` writes its
     * result onto the scout it read, so the card shows it without a new scout.
     */
    mergeStats(id: number, patch: Record<string, unknown>): void {
      const run = db.select().from(runs).where(eq(runs.id, id)).get();
      if (!run) throw new Error(`run ${id} not found`);
      const base =
        run.stats && typeof run.stats === 'object' && !Array.isArray(run.stats)
          ? (run.stats as Record<string, unknown>)
          : {};
      db.update(runs)
        .set({ stats: { ...base, ...patch } })
        .where(eq(runs.id, id))
        .run();
    },

    /** Open a run and return its id. */
    start(kind: RunKind): number {
      const row = db
        .insert(runs)
        .values({ kind, startedAt: clock.now() })
        .returning({ id: runs.id })
        .get();
      if (!row) throw new Error('failed to create run');
      return row.id;
    },

    /** Close a run with its outcome and stats. */
    finish(id: number, result: { ok: boolean; stats?: unknown; error?: string | null }): void {
      const updated = db
        .update(runs)
        .set({
          finishedAt: clock.now(),
          ok: result.ok,
          stats: result.stats ?? null,
          error: result.error ?? null,
        })
        .where(eq(runs.id, id))
        .run();
      if (updated.changes === 0) throw new Error(`run ${id} not found`);
    },

    /** Replace an open run's stats, e.g. its progress so far. A finished run is left alone. */
    progress(id: number, stats: unknown): void {
      db.update(runs)
        .set({ stats })
        .where(and(eq(runs.id, id), isNull(runs.finishedAt)))
        .run();
    },

    get(id: number): Run | undefined {
      return db.select().from(runs).where(eq(runs.id, id)).get();
    },

    /** Most recent run of a kind, or any kind when `kind` is omitted. */
    latest(kind?: RunKind): Run | undefined {
      const base = db.select().from(runs);
      const query = kind ? base.where(eq(runs.kind, kind)) : base;
      return query.orderBy(desc(runs.startedAt), desc(runs.id)).limit(1).get();
    },
  };
}
