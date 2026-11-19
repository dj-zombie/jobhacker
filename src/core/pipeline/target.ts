import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { companies, jobs } from '../db/schema.js';
import { companyOnList } from '../util/company-match.js';

/** What Settings shows under the company list (J27). */
export interface TargetCompanyReport {
  /** Open, non-duplicate jobs whose company matches a name on the list. */
  openJobs: number;
  /** Of those, jobs with no dimension score for their current text. */
  unscoredJobs: number;
  /** Typed names that match no company stored at all. */
  unseen: string[];
}

/**
 * Match the list against stored company names. A company with only closed
 * jobs still counts as seen. Jobs are counted once even when two list entries
 * match the same company.
 */
export function targetCompanyReport(db: Db, names: readonly string[]): TargetCompanyReport {
  if (names.length === 0) return { openJobs: 0, unscoredJobs: 0, unseen: [] };
  const stored = db.select({ name: companies.name }).from(companies).all();
  const matched = names.filter((name) => stored.some((row) => companyOnList(row.name, [name])));
  const matchedSet = new Set(matched);
  const open = db
    .select({
      name: companies.name,
      unscored: sql<number>`case when not exists (
        select 1 from job_scores
        where job_scores.job_id = ${jobs.id}
          and job_scores.content_hash = ${jobs.contentHash}
          and job_scores.dimensions is not null
      ) then 1 else 0 end`.mapWith(Number),
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(and(isNull(jobs.closedAt), isNull(jobs.duplicateOf)))
    .all();
  let openJobs = 0;
  let unscoredJobs = 0;
  for (const row of open) {
    if (companyOnList(row.name, names) === null) continue;
    openJobs += 1;
    unscoredJobs += row.unscored;
  }
  return {
    openJobs,
    unscoredJobs,
    unseen: names.filter((name) => !matchedSet.has(name)),
  };
}
