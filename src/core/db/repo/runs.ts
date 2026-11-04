import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Clock } from '../../util/clock.js';
import type { Db } from '../client.js';
import { type Run, type RunKind, runs } from '../schema.js';

export type { RunKind };

/** A run with no finish time this long after its start crashed; it is not still running. */
export const ABANDONED_AFTER_MS = 3 * 60 * 60 * 1000;

/**
 * Repository for the `runs` table — the bookkeeping row that wraps each
 * pipeline execution (ARCHITECTURE § Flows).
 */
export function runsRepo(db: Db, clock: Clock) {
  return {
    /** The scout still going, if any. An unfinished scout older than `ABANDONED_AFTER_MS` crashed. */
    liveScout(): Run | undefined {
      const open = db
        .select()
        .from(runs)
        .where(and(eq(runs.kind, 'scout'), isNull(runs.finishedAt)))
        .orderBy(desc(runs.id))
        .all();
      const now = clock.nowMs();
      return open.find((run) => now - Date.parse(run.startedAt) < ABANDONED_AFTER_MS);
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
