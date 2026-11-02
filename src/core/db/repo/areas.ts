import { type SQL, eq, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { jobAreas, jobs } from '../schema.js';

/** `jobs` rows in any of these areas (PLACES § 4). Callers pass a non-empty list. */
export function inAreas(areas: readonly string[]): SQL {
  const list = sql.join(
    areas.map((area) => sql`${area}`),
    sql`, `,
  );
  return sql`exists (select 1 from job_areas where job_areas.job_id = ${jobs.id} and job_areas.area in (${list}))`;
}

/** Repository for `job_areas`: which of Kris's areas each job is in. */
export function areasRepo(db: Db) {
  return {
    forJob(jobId: number): string[] {
      return db
        .select({ area: jobAreas.area })
        .from(jobAreas)
        .where(eq(jobAreas.jobId, jobId))
        .all()
        .map((row) => row.area);
    },

    /** Every stored row, grouped by job. Jobs with no rows are absent. */
    all(): Map<number, string[]> {
      const out = new Map<number, string[]>();
      for (const row of db.select().from(jobAreas).all()) {
        const list = out.get(row.jobId);
        if (list) list.push(row.area);
        else out.set(row.jobId, [row.area]);
      }
      return out;
    },

    /** Replace the rows of each listed job, in one transaction. */
    replace(changes: readonly { jobId: number; areas: readonly string[] }[]): void {
      if (changes.length === 0) return;
      db.transaction((tx) => {
        for (const change of changes) {
          tx.delete(jobAreas).where(eq(jobAreas.jobId, change.jobId)).run();
          if (change.areas.length > 0) {
            tx.insert(jobAreas)
              .values(change.areas.map((area) => ({ jobId: change.jobId, area })))
              .run();
          }
        }
      });
    },
  };
}
