import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Ats } from '../../config/schemas.js';
import type { Db } from '../client.js';
import { type Job, type JobStatus, type ScoreState, companies, jobs } from '../schema.js';
import { inAreas } from './areas.js';
import type { ScoreKey } from './scores.js';

/** Fields scout writes. Status, first-seen, and duplicate links are managed separately. */
export interface JobWrite {
  companyId: number;
  ats: Ats;
  externalId: string;
  title: string;
  locationRaw: string | null;
  remoteType: 'remote' | 'hybrid' | 'onsite' | 'unknown';
  employmentType: string | null;
  url: string;
  applyUrl: string | null;
  descriptionText: string;
  compMin: number | null;
  compMax: number | null;
  compCurrency: string | null;
  postedAt: string | null;
  contentHash: string;
  dedupeKey: string;
  sourceKind?: 'board' | 'search';
  sourceName?: string;
  sourceQuality?: 'high' | 'medium' | 'low';
}

export interface UpsertResult {
  action: 'inserted' | 'updated';
  /** True when an existing external id was last stored under a different company. */
  companyChanged: boolean;
}

/** A job ready to be scored: the fields the scoring prompt needs, plus the hash. */
export interface ScorableJob {
  id: number;
  companyName: string;
  title: string;
  locationRaw: string | null;
  remoteType: 'remote' | 'hybrid' | 'onsite' | 'unknown';
  employmentType: string | null;
  descriptionText: string;
  compMin: number | null;
  compMax: number | null;
  compCurrency: string | null;
  postedAt: string | null;
  contentHash: string;
  prescore: number | null;
  /** In one of the areas the batch takes first (`ScorableOrder.first`). */
  inFirst: boolean;
  /** Already has a dimension score under `ScorableOrder.key`, so scoring it is a cache hit. */
  current: boolean;
}

/** How `listScorable` orders its candidates (PLACES § 6). */
export interface ScorableOrder {
  /**
   * The config half of the current cache key. A job whose only dimension score
   * is under another key is stale whatever its stored state says (D30), and
   * goes with the deferred work instead of last.
   */
  key?: Omit<ScoreKey, 'jobId' | 'contentHash'>;
  /** Areas whose jobs go first. Absent or empty: no place goes first. */
  first?: readonly string[];
  /** Only these jobs ("Score this job"). Absent: every scorable job. */
  jobIds?: readonly number[];
}

const CHUNK = 500;

/** Automated states that a content change sends back to `new`. */
const RESETTABLE_STATUSES = ['filtered_out', 'unscored', 'scored'] as const;
const SCORING_STATUSES: ReadonlySet<JobStatus> = new Set(['new', 'unscored', 'scored']);

export function jobsRepo(db: Db) {
  return {
    upsert(row: JobWrite, now: string): UpsertResult {
      const existing = db
        .select({
          id: jobs.id,
          companyId: jobs.companyId,
          contentHash: jobs.contentHash,
          status: jobs.status,
        })
        .from(jobs)
        .where(and(eq(jobs.ats, row.ats), eq(jobs.externalId, row.externalId)))
        .get();

      const sourceKind = row.sourceKind ?? 'board';
      const sourceName = row.sourceName ?? row.ats;
      const sourceQuality = row.sourceQuality ?? 'high';

      if (!existing) {
        db.insert(jobs)
          .values({
            ...row,
            sourceKind,
            sourceName,
            sourceQuality,
            firstSeenAt: now,
            lastSeenAt: now,
            closedAt: null,
          })
          .run();
        return { action: 'inserted', companyChanged: false };
      }

      // If the posting text changed (new content hash), an automated state is
      // stale. Reset it to `new` so the next gate/prescore/score pass
      // re-evaluates the job. Human triage states (shortlisted/skipped/archived)
      // and `new` are left untouched (Known issue [2]).
      const hashChanged = existing.contentHash !== row.contentHash;
      const resettable = (RESETTABLE_STATUSES as readonly string[]).includes(existing.status);
      const statusPatch =
        hashChanged && resettable ? { status: 'new' as const, filterReason: null } : {};
      const scorePatch = hashChanged ? { scoreState: 'pending' as const } : {};

      db.update(jobs)
        .set({
          companyId: row.companyId,
          title: row.title,
          locationRaw: row.locationRaw,
          remoteType: row.remoteType,
          employmentType: row.employmentType,
          url: row.url,
          applyUrl: row.applyUrl,
          descriptionText: row.descriptionText,
          compMin: row.compMin,
          compMax: row.compMax,
          compCurrency: row.compCurrency,
          postedAt: row.postedAt,
          contentHash: row.contentHash,
          dedupeKey: row.dedupeKey,
          sourceKind,
          sourceName,
          sourceQuality,
          lastSeenAt: now,
          closedAt: null,
          ...statusPatch,
          ...scorePatch,
        })
        .where(eq(jobs.id, existing.id))
        .run();
      return { action: 'updated', companyChanged: existing.companyId !== row.companyId };
    },

    find(ats: Ats, externalId: string): Job | undefined {
      return db
        .select()
        .from(jobs)
        .where(and(eq(jobs.ats, ats), eq(jobs.externalId, externalId)))
        .get();
    },

    /**
     * Candidates for scoring: every open, non-duplicate job that passed the
     * gates, regardless of human triage status (D46). Jobs in `order.first`
     * go before the rest; it orders, never skips (invariant 8). Within each
     * group, previously deferred and stale jobs go before newly pending work so
     * a stream of new high-prescore jobs cannot starve them (D50); prescore
     * orders within each tier.
     */
    listScorable(order: ScorableOrder = {}): ScorableJob[] {
      const first = order.first ?? [];
      const inFirst = first.length > 0 ? sql`(${inAreas(first)})` : sql`0`;
      const key = order.key;
      const staleByKey = key
        ? sql`not exists (select 1 from job_scores s where s.job_id = ${jobs.id}
            and s.content_hash = ${jobs.contentHash} and s.rubric_version = ${key.rubricVersion}
            and s.model = ${key.model} and s.profile_hash = ${key.profileHash}
            and s.preferences_hash = ${key.preferencesHash} and s.dimensions is not null)`
        : sql`0`;
      const current = key ? sql`not (${staleByKey})` : sql`0`;
      const only = order.jobIds ? [inArray(jobs.id, [...order.jobIds])] : [];
      return db
        .select({
          id: jobs.id,
          companyName: companies.name,
          title: jobs.title,
          locationRaw: jobs.locationRaw,
          remoteType: jobs.remoteType,
          employmentType: jobs.employmentType,
          descriptionText: jobs.descriptionText,
          compMin: jobs.compMin,
          compMax: jobs.compMax,
          compCurrency: jobs.compCurrency,
          postedAt: jobs.postedAt,
          contentHash: jobs.contentHash,
          prescore: jobs.prescore,
          inFirst: sql<boolean>`${inFirst}`.mapWith((value) => value === 1),
          current: sql<boolean>`${current}`.mapWith((value) => value === 1),
        })
        .from(jobs)
        .innerJoin(companies, eq(jobs.companyId, companies.id))
        .where(
          and(
            isNull(jobs.duplicateOf),
            isNull(jobs.closedAt),
            sql`json_extract(${jobs.gateResult}, '$.passed') = 1`,
            ...only,
          ),
        )
        .orderBy(
          ...(first.length > 0 ? [sql`${inFirst} desc`] : []),
          sql`case
            when ${jobs.scoreState} in ('run_cap', 'stale') then 0
            when ${jobs.scoreState} = 'pending' then 1
            when ${jobs.scoreState} = 'llm_error' then 2
            when ${staleByKey} then 0
            else 3 end`,
          sql`${jobs.prescore} is null`,
          desc(jobs.prescore),
          asc(jobs.firstSeenAt),
          asc(jobs.id),
        )
        .all();
    },

    /**
     * Store the exact scoring outcome. Automated statuses mirror whether a
     * dimension row exists; human triage statuses are never overwritten.
     */
    setScoreState(jobId: number, scoreState: ScoreState, hasDimensions: boolean): void {
      const row = db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId)).get();
      if (!row) return;
      const patch: Partial<typeof jobs.$inferInsert> = { scoreState };
      if (SCORING_STATUSES.has(row.status)) {
        patch.status = hasDimensions ? 'scored' : 'unscored';
      }
      db.update(jobs).set(patch).where(eq(jobs.id, jobId)).run();
    },

    /**
     * Set `closed_at` on this company's still-open jobs whose external id was
     * not in the board response. Already-closed jobs keep their original time.
     */
    closeMissing(companyId: number, seen: ReadonlySet<string>, closedAt: string): number {
      const open = db
        .select({ id: jobs.id, externalId: jobs.externalId })
        .from(jobs)
        .where(and(eq(jobs.companyId, companyId), isNull(jobs.closedAt)))
        .all();
      const ids = open.filter((job) => !seen.has(job.externalId)).map((job) => job.id);
      if (ids.length === 0) return 0;

      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        db.update(jobs).set({ closedAt }).where(inArray(jobs.id, chunk)).run();
      }
      return ids.length;
    },
  };
}
