import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Clock } from '../../util/clock.js';
import type { Db } from '../client.js';
import { type Run, type RunKind, runs } from '../schema.js';

export type { RunKind };

/**
 * Repository for the `runs` table — the bookkeeping row that wraps each
 * pipeline execution (ARCHITECTURE § Flows).
 */
export function runsRepo(db: Db, clock: Clock) {
  return {
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
