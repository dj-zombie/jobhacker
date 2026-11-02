import { type SQL, and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Clock } from '../../util/clock.js';
import type { Db } from '../client.js';
import {
  type Dimensions,
  type Job,
  type JobScore,
  type JobStatus,
  type ScoreState,
  type Verdict,
  companies,
  jobScores,
  jobs,
} from '../schema.js';
import { inAreas } from './areas.js';

/** Everything a cached score depends on (PHASE2 D16). */
export interface ScoreKey {
  jobId: number;
  contentHash: string;
  rubricVersion: string;
  model: string;
  profileHash: string;
  preferencesHash: string;
}

export interface ScoreWrite extends ScoreKey {
  dimensions: Dimensions;
  summary: string;
  redFlags: string[];
  /** Ranked score and verdict with the weights in force now; a snapshot only. */
  score: number;
  verdict: Verdict;
}

/** Triage statuses the review queue can filter by. */
export const QUEUE_STATUSES = ['scored', 'shortlisted', 'skipped', 'archived'] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

/** Filters shared by the ranked and unscored lists. All optional, combined with AND. */
export interface ListFilters {
  /** Exact company display-name match. */
  company?: string;
  /** Keep jobs posted (or, when unknown, first seen) within this many days. */
  sinceDays?: number;
  /** Keep jobs first seen by a scout within this many hours. */
  seenWithinHours?: number;
  /** Restrict to these statuses. */
  statuses?: readonly JobStatus[];
  /** Keep jobs in any of these areas (`job_areas`). Absent or empty: anywhere. A view filter only. */
  areas?: readonly string[];
}

/** The job fields every list row carries. */
export interface ListedJob {
  jobId: number;
  company: string;
  title: string;
  locationRaw: string | null;
  remoteType: 'remote' | 'hybrid' | 'onsite' | 'unknown';
  url: string;
  compMin: number | null;
  compMax: number | null;
  compCurrency: string | null;
  status: JobStatus;
  postedAt: string | null;
  firstSeenAt: string;
  prescore: number | null;
  scoreState: ScoreState;
  /** Its `job_areas` rows, unordered. Empty: in none of Kris's places. */
  areas: string[];
}

/** A job with a dimension score for its current text: input to `rankJobs`. */
export interface ScoredRow extends ListedJob {
  dimensions: Dimensions;
  summary: string | null;
  redFlags: string[];
  rubricVersion: string;
  model: string;
  profileHash: string;
  preferencesHash: string;
  scoredAt: string;
}

/** The job-detail view: the full job, its company, and its latest score for the current text. */
export interface JobDetail {
  job: Job;
  company: string;
  score: JobScore | null;
}

/**
 * Exactly one `job_scores` row per job: the latest dimension score (highest
 * id) for the job's current content hash. v1 rows (no dimensions) never rank,
 * and a score for older text never ranks a job (Known issues [2]/[3]).
 */
const latestDimensionScore = (): SQL =>
  sql`${jobScores.id} = (select max(id) from job_scores where job_id = ${jobs.id} and content_hash = ${jobs.contentHash} and dimensions is not null)`;

const hasDimensionScore = (): SQL =>
  sql`exists (select 1 from job_scores where job_id = ${jobs.id} and content_hash = ${jobs.contentHash} and dimensions is not null)`;

/** Remote roles that name the US, or say only "remote", ahead of other countries. */
function usRemoteFirst(): SQL {
  const loc = sql`lower(coalesce(${jobs.locationRaw}, ''))`;
  return sql`case
    when ${loc} like '%canada%' or ${loc} like '%spain%' or ${loc} like '%portugal%'
      or ${loc} like '%germany%' or ${loc} like '%mexico%' or ${loc} like '%poland%'
      or ${loc} like '%france%' or ${loc} like '%sweden%' or ${loc} like '%netherlands%'
      or ${loc} like '%belgium%' or ${loc} like '%finland%' or ${loc} like '%india%'
      or ${loc} like '%brazil%' or ${loc} like '%africa%' or ${loc} like '%hong kong%'
      or ${loc} like '%united kingdom%' or ${loc} like '% uk%' or ${loc} like '%ireland%'
    then 1
    when ${jobs.remoteType} = 'remote' and (
      ${loc} like '%united states%' or ${loc} like '%u.s.%' or ${loc} like '%usa%'
      or ${loc} like '%north america%' or ${loc} like '%remote us%' or ${loc} like '%us remote%'
      or trim(${loc}) in ('remote', 'remote - us', 'us', 'remote, us')
    ) then 0
    else 1
  end`;
}

/** HN comments sometimes become the company name. Those are not dropdown labels. */
function isCompanyName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 40) return false;
  if (/[?>]/.test(trimmed) || /^\d/.test(trimmed)) return false;
  return trimmed.split(/\s+/).length <= 5;
}

/** Open, non-duplicate, not gated: the jobs a human should be able to see. */
const visible = (): SQL[] => [
  isNull(jobs.duplicateOf),
  isNull(jobs.closedAt),
  sql`json_extract(${jobs.gateResult}, '$.passed') = 1`,
];

const listedJobColumns = {
  jobId: jobs.id,
  company: companies.name,
  title: jobs.title,
  locationRaw: jobs.locationRaw,
  remoteType: jobs.remoteType,
  url: jobs.url,
  compMin: jobs.compMin,
  compMax: jobs.compMax,
  compCurrency: jobs.compCurrency,
  status: jobs.status,
  postedAt: jobs.postedAt,
  firstSeenAt: jobs.firstSeenAt,
  prescore: jobs.prescore,
  scoreState: jobs.scoreState,
  areas: sql<
    string[]
  >`coalesce((select group_concat(area) from job_areas where job_areas.job_id = ${jobs.id}), '')`.mapWith(
    (value: unknown) => (typeof value === 'string' && value ? value.split(',') : []),
  ),
};

/** Repository for `job_scores` (ARCHITECTURE § Data model). */
export function scoresRepo(db: Db, clock: Clock) {
  const filterConditions = (filters: ListFilters): SQL[] => {
    const conditions: SQL[] = [];
    if (filters.statuses) conditions.push(inArray(jobs.status, [...filters.statuses]));
    if (filters.company) conditions.push(eq(companies.name, filters.company));
    if (filters.areas && filters.areas.length > 0) conditions.push(inAreas(filters.areas));
    if (filters.sinceDays != null) {
      const cutoff = new Date(clock.nowMs() - filters.sinceDays * 86_400_000).toISOString();
      conditions.push(sql`coalesce(${jobs.postedAt}, ${jobs.firstSeenAt}) >= ${cutoff}`);
    }
    if (filters.seenWithinHours != null) {
      const cutoff = new Date(clock.nowMs() - filters.seenWithinHours * 3_600_000).toISOString();
      conditions.push(sql`${jobs.firstSeenAt} >= ${cutoff}`);
    }
    return conditions;
  };

  return {
    /** A cached dimension score for exactly this key, if any. */
    findCached(key: ScoreKey): JobScore | undefined {
      return db
        .select()
        .from(jobScores)
        .where(
          and(
            eq(jobScores.jobId, key.jobId),
            eq(jobScores.contentHash, key.contentHash),
            eq(jobScores.rubricVersion, key.rubricVersion),
            eq(jobScores.model, key.model),
            eq(jobScores.profileHash, key.profileHash),
            eq(jobScores.preferencesHash, key.preferencesHash),
            isNotNull(jobScores.dimensions),
          ),
        )
        .get();
    },

    /** Whether the job has any dimension score (current or stale key) for this text. */
    hasDimensions(jobId: number, contentHash: string): boolean {
      const row = db
        .select({ id: jobScores.id })
        .from(jobScores)
        .where(
          and(
            eq(jobScores.jobId, jobId),
            eq(jobScores.contentHash, contentHash),
            isNotNull(jobScores.dimensions),
          ),
        )
        .get();
      return row !== undefined;
    },

    insert(row: ScoreWrite): void {
      db.insert(jobScores)
        .values({
          jobId: row.jobId,
          contentHash: row.contentHash,
          rubricVersion: row.rubricVersion,
          model: row.model,
          profileHash: row.profileHash,
          preferencesHash: row.preferencesHash,
          score: row.score,
          verdict: row.verdict,
          reasons: [],
          redFlags: row.redFlags,
          dimensions: row.dimensions,
          summary: row.summary,
          createdAt: clock.now(),
        })
        .run();
    },

    /**
     * Visible jobs with a dimension score for their current text, one row per
     * job, in job-id order. Ranking (score, verdict, order) is the caller's job
     * via `rankJobs`, so it always uses the live weights.
     */
    scoredRows(filters: ListFilters = {}): ScoredRow[] {
      const rows = db
        .select({
          ...listedJobColumns,
          dimensions: jobScores.dimensions,
          summary: jobScores.summary,
          redFlags: jobScores.redFlags,
          rubricVersion: jobScores.rubricVersion,
          model: jobScores.model,
          profileHash: jobScores.profileHash,
          preferencesHash: jobScores.preferencesHash,
          scoredAt: jobScores.createdAt,
        })
        .from(jobScores)
        .innerJoin(jobs, eq(jobScores.jobId, jobs.id))
        .innerJoin(companies, eq(jobs.companyId, companies.id))
        .where(and(latestDimensionScore(), ...visible(), ...filterConditions(filters)))
        .orderBy(asc(jobs.id))
        .all();
      const out: ScoredRow[] = [];
      for (const row of rows) {
        if (row.dimensions) out.push({ ...row, dimensions: row.dimensions });
      }
      return out;
    },

    /**
     * Visible jobs with no dimension score for their current text (FR-6
     * "unscored" tab): pending, deferred by the per-run cap, or after an error.
     * Previously deferred rows go first, then lexical relevance.
     */
    unscoredRows(filters: ListFilters = {}): ListedJob[] {
      return db
        .select(listedJobColumns)
        .from(jobs)
        .innerJoin(companies, eq(jobs.companyId, companies.id))
        .where(and(sql`not ${hasDimensionScore()}`, ...visible(), ...filterConditions(filters)))
        .orderBy(
          sql`case ${jobs.scoreState}
            when 'run_cap' then 0
            when 'stale' then 0
            when 'pending' then 1
            when 'llm_error' then 2
            else 3 end`,
          sql`${jobs.prescore} is null`,
          desc(jobs.prescore),
          asc(jobs.firstSeenAt),
          asc(jobs.id),
        )
        .all();
    },

    /**
     * The default queue. Jobs with no current dimension score, so the old
     * five-company ranked list does not sit on top of a later scout.
     * Fillable boards come first, then remote, then prescore. A limit keeps
     * the page to one screen; the funnel still counts every job.
     */
    reviewRows(filters: ListFilters = {}, limit = 80): ListedJob[] {
      const rows = db
        .select(listedJobColumns)
        .from(jobs)
        .innerJoin(companies, eq(jobs.companyId, companies.id))
        .where(
          and(
            sql`not ${hasDimensionScore()}`,
            ...visible(),
            ...filterConditions(filters),
            sql`${jobs.status} not in ('skipped', 'archived')`,
          ),
        )
        .orderBy(
          sql`case when lower(${jobs.title}) like '%engineer%' or lower(${jobs.title}) like '%frontend%' or lower(${jobs.title}) like '%full stack%' or lower(${jobs.title}) like '%full-stack%' then 0 else 1 end`,
          sql`case ${companies.ats} when 'greenhouse' then 0 when 'lever' then 0 when 'ashby' then 0 else 1 end`,
          usRemoteFirst(),
          sql`case ${jobs.remoteType} when 'remote' then 0 when 'hybrid' then 1 else 2 end`,
          sql`${jobs.prescore} is null`,
          desc(jobs.prescore),
          desc(sql`coalesce(${jobs.postedAt}, ${jobs.firstSeenAt})`),
          asc(jobs.id),
        )
        .limit(Math.max(limit * 8, limit))
        .all();
      const seen = new Set<string>();
      const out: ListedJob[] = [];
      for (const row of rows) {
        const key = row.company.trim().toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(row);
        if (out.length >= limit) break;
      }
      return out;
    },

    /** Distinct company names of visible jobs, for the filter dropdown. */
    queueCompanies(): string[] {
      const rows = db
        .selectDistinct({ name: companies.name })
        .from(jobs)
        .innerJoin(companies, eq(jobs.companyId, companies.id))
        .where(and(...visible()))
        .orderBy(companies.name)
        .all();
      return rows.map((r) => r.name).filter(isCompanyName);
    },

    /** Full job detail plus its latest score for the current text (dimension rows preferred). */
    detail(jobId: number): JobDetail | undefined {
      const job = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
      if (!job) return undefined;
      const company = db
        .select({ name: companies.name })
        .from(companies)
        .where(eq(companies.id, job.companyId))
        .get();
      const score = db
        .select()
        .from(jobScores)
        .where(and(eq(jobScores.jobId, jobId), eq(jobScores.contentHash, job.contentHash)))
        .orderBy(sql`${jobScores.dimensions} is null`, desc(jobScores.id))
        .get();
      return { job, company: company?.name ?? '(unknown)', score: score ?? null };
    },
  };
}
