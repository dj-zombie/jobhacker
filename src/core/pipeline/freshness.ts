import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { type CloseReport, jobsRepo } from '../db/repo/jobs.js';
import { jobs } from '../db/schema.js';
import { searchSinceIso } from '../sources/query-gen.js';

/**
 * Close search jobs a successful scout can prove are gone (J12). Not a gate:
 * `closed_at` is the existing closed gate, and a human status is left alone.
 * A failure, a skip, or a budget stop closes nothing. Call this after search
 * ingest and before dedupe. A later sighting reopens a job: `upsert` clears
 * `closed_at`.
 */

export interface SearchPasses {
  /** A successful HN fetch, and the external ids in that response. */
  hn: { ok: true; seen: ReadonlySet<string> } | { ok: false };
  /** A JSearch pass that finished every query, with no throw and no budget skip. */
  jsearchOk: boolean;
  /** A JobsPipe pass where every area call succeeded: no throw, budget stop, or 402. */
  jobspipeOk: boolean;
}

/**
 * HN: missing from a successful fetch. JSearch and JobsPipe: older than the
 * one search window. A miss inside that window is not a close.
 */
export function closeSearchListings(db: Db, now: string, passes: SearchPasses): CloseReport {
  const hn = passes.hn.ok ? closeHnMissing(db, passes.hn.seen, now) : none();
  const jsearch = passes.jsearchOk ? closeSearchOlder(db, now, 'jsearch') : none();
  const jobspipe = passes.jobspipeOk ? closeSearchOlder(db, now, 'jobspipe') : none();
  return {
    closed: hn.closed + jsearch.closed + jobspipe.closed,
    shortlisted: hn.shortlisted + jsearch.shortlisted + jobspipe.shortlisted,
  };
}

/**
 * Close open HN jobs whose external id was not in the response. HN jobs sit on
 * many company rows, so this is not `closeMissing` for the companies the
 * response happened to mention.
 */
export function closeHnMissing(db: Db, seen: ReadonlySet<string>, now: string): CloseReport {
  const open = db
    .select({ id: jobs.id, externalId: jobs.externalId, status: jobs.status })
    .from(jobs)
    .where(and(eq(jobs.ats, 'hn'), eq(jobs.sourceKind, 'search'), isNull(jobs.closedAt)))
    .all();
  const missing = open.filter((job) => !seen.has(job.externalId));
  return jobsRepo(db).closeJobs(missing, now);
}

/**
 * Close open jobs from one search source whose `posted_at` (or `first_seen_at`,
 * when the posting has no date) is older than `SEARCH_SINCE_DAYS`. A job the
 * run did not return stays open when it is still inside that window. One page
 * is not the full result, so a job's absence proves nothing.
 */
export function closeSearchOlder(db: Db, now: string, ats: 'jsearch' | 'jobspipe'): CloseReport {
  const cutoff = searchSinceIso(now);
  const old = db
    .select({ id: jobs.id, status: jobs.status })
    .from(jobs)
    .where(
      and(
        eq(jobs.ats, ats),
        eq(jobs.sourceKind, 'search'),
        isNull(jobs.closedAt),
        sql`coalesce(${jobs.postedAt}, ${jobs.firstSeenAt}) < ${cutoff}`,
      ),
    )
    .all();
  return jobsRepo(db).closeJobs(old, now);
}

function none(): CloseReport {
  return { closed: 0, shortlisted: 0 };
}
