import {
  type AnySQLiteColumn,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { ATS_VALUES, type Dimension } from '../config/schemas.js';

/** The four hard gates (invariant 8), in the order they are checked. */
export const GATE_NAMES = ['closed', 'duplicate', 'blocklist', 'age'] as const;
export type GateName = (typeof GATE_NAMES)[number];

/** `jobs.gate_result`: which gate (if any) excluded the job, and a human-readable detail. */
export interface GateResult {
  passed: boolean;
  gate: GateName | null;
  detail: string | null;
}

/** One scored dimension: 0–5, or null when the posting genuinely doesn't say. */
export interface DimensionScore {
  score: number | null;
  reason: string;
}

/** `job_scores.dimensions`: the six dimensions with their reasons (FR-5). */
export type Dimensions = Record<Dimension, DimensionScore>;

export const VERDICTS = ['strong', 'maybe', 'no'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const JOB_STATUSES = [
  'new',
  'filtered_out',
  'unscored',
  'scored',
  'shortlisted',
  'skipped',
  'archived',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Why a gate-passed job is current or still waiting for a current-key dimension score. */
export const SCORE_STATES = ['pending', 'current', 'stale', 'run_cap', 'llm_error'] as const;
export type ScoreState = (typeof SCORE_STATES)[number];

/**
 * The full data model (ARCHITECTURE § Data model). Timestamps are ISO-8601
 * strings in UTC. JSON columns use Drizzle's `{ mode: 'json' }`.
 *
 * `id` columns are autoincrementing integer primary keys.
 */

export const companies = sqliteTable(
  'companies',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    ats: text('ats', { enum: ATS_VALUES }).notNull(),
    token: text('token').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default([]),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    atsToken: uniqueIndex('companies_ats_token_unique').on(t.ats, t.token),
  }),
);

export const jobs = sqliteTable(
  'jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    ats: text('ats', { enum: ATS_VALUES }).notNull(),
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    locationRaw: text('location_raw'),
    remoteType: text('remote_type', {
      enum: ['remote', 'hybrid', 'onsite', 'unknown'],
    })
      .notNull()
      .default('unknown'),
    employmentType: text('employment_type'),
    url: text('url').notNull(),
    applyUrl: text('apply_url'),
    descriptionText: text('description_text').notNull().default(''),
    compMin: integer('comp_min'),
    compMax: integer('comp_max'),
    compCurrency: text('comp_currency'),
    postedAt: text('posted_at'),
    firstSeenAt: text('first_seen_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    closedAt: text('closed_at'),
    contentHash: text('content_hash').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    /** `board` for an ATS fetch, `search` for JSearch / HN. */
    sourceKind: text('source_kind', { enum: ['board', 'search'] })
      .notNull()
      .default('board'),
    /** Adapter name: an ATS id, `jsearch`, or `hn`. */
    sourceName: text('source_name').notNull().default(''),
    /** `high` ATS board, `medium` aggregator, `low` HN and other free feeds. */
    sourceQuality: text('source_quality', { enum: ['high', 'medium', 'low'] })
      .notNull()
      .default('high'),
    duplicateOf: integer('duplicate_of').references((): AnySQLiteColumn => jobs.id, {
      onDelete: 'set null',
    }),
    status: text('status', { enum: JOB_STATUSES }).notNull().default('new'),
    /** Superseded by `gate_result` (PHASE2); kept, no longer written except to clear it. */
    filterReason: text('filter_reason'),
    gateResult: text('gate_result', { mode: 'json' }).$type<GateResult>(),
    /** Lexical relevance to preferences.md, 0–1; null until computed or when gated. */
    prescore: real('prescore'),
    /** Current scoring outcome; triage status is deliberately independent. */
    scoreState: text('score_state', { enum: SCORE_STATES }).notNull().default('pending'),
  },
  (t) => ({
    atsExternal: uniqueIndex('jobs_ats_external_unique').on(t.ats, t.externalId),
    statusIdx: index('jobs_status_idx').on(t.status),
    scoreStateIdx: index('jobs_score_state_idx').on(t.scoreState),
    dedupeIdx: index('jobs_dedupe_idx').on(t.dedupeKey),
    companyIdx: index('jobs_company_idx').on(t.companyId),
  }),
);

/**
 * Which of Kris's areas (a `places` id or `remote`) each job is in (PLACES § 4).
 * A view filter and a scoring order, never a gate: a job with no rows is
 * "elsewhere" and still visible under Anywhere. No evidence is kept; `why`
 * re-classifies live.
 */
export const jobAreas = sqliteTable(
  'job_areas',
  {
    jobId: integer('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    area: text('area').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.jobId, t.area] }),
    areaIdx: index('job_areas_area_idx').on(t.area),
  }),
);

export const jobScores = sqliteTable(
  'job_scores',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: integer('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    contentHash: text('content_hash').notNull(),
    rubricVersion: text('rubric_version').notNull(),
    model: text('model').notNull(),
    /**
     * Ranked score and verdict computed with the weights in force when the row
     * was written. A snapshot only: the queue always re-ranks from `dimensions`.
     */
    score: integer('score').notNull(),
    verdict: text('verdict', { enum: VERDICTS }).notNull(),
    reasons: text('reasons', { mode: 'json' }).$type<string[]>().notNull().default([]),
    redFlags: text('red_flags', { mode: 'json' }).$type<string[]>().notNull().default([]),
    /** Null on v1 rows (single-score rubric); those rows are never ranked. */
    dimensions: text('dimensions', { mode: 'json' }).$type<Dimensions>(),
    /** The model's one-line description of the job. */
    summary: text('summary'),
    profileHash: text('profile_hash').notNull().default(''),
    preferencesHash: text('preferences_hash').notNull().default(''),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    unique: uniqueIndex('job_scores_unique').on(
      t.jobId,
      t.contentHash,
      t.rubricVersion,
      t.model,
      t.profileHash,
      t.preferencesHash,
    ),
  }),
);

export const applications = sqliteTable('applications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  jobId: integer('job_id')
    .notNull()
    .unique()
    .references(() => jobs.id, { onDelete: 'cascade' }),
  status: text('status', {
    enum: ['prepped', 'submitted', 'interviewing', 'offer', 'rejected', 'withdrawn', 'ghosted'],
  })
    .notNull()
    .default('prepped'),
  resumeHtml: text('resume_html'),
  resumePdfPath: text('resume_pdf_path'),
  coverNote: text('cover_note'),
  answers: text('answers', { mode: 'json' }).$type<Record<string, string>>(),
  fillReport: text('fill_report', { mode: 'json' }).$type<unknown>(),
  submittedAt: text('submitted_at'),
  followUpAt: text('follow_up_at'),
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    applicationId: integer('application_id').references(() => applications.id, {
      onDelete: 'cascade',
    }),
    jobId: integer('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payload: text('payload', { mode: 'json' }).$type<unknown>(),
    at: text('at').notNull(),
  },
  (t) => ({
    typeIdx: index('events_type_idx').on(t.type),
    atIdx: index('events_at_idx').on(t.at),
  }),
);

export const sourceUsage = sqliteTable(
  'source_usage',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceName: text('source_name').notNull(),
    day: text('day').notNull(),
    calls: integer('calls').notNull().default(0),
    estCostUsd: real('est_cost_usd').notNull().default(0),
  },
  (t) => ({
    sourceDay: uniqueIndex('source_usage_source_day_unique').on(t.sourceName, t.day),
  }),
);

export const RUN_KINDS = ['scout', 'score', 'prep', 'fill'] as const;
export type RunKind = (typeof RUN_KINDS)[number];

export const runs = sqliteTable(
  'runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    kind: text('kind', { enum: RUN_KINDS }).notNull(),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at'),
    ok: integer('ok', { mode: 'boolean' }),
    stats: text('stats', { mode: 'json' }).$type<unknown>(),
    error: text('error'),
  },
  (t) => ({
    kindIdx: index('runs_kind_idx').on(t.kind),
  }),
);

/** Where a company domain came from. `found` is the only state J9 writes. */
export const DOMAIN_STATES = ['found', 'confirmed', 'none'] as const;
export type DomainState = (typeof DOMAIN_STATES)[number];

/**
 * One registrable domain per normalized company name (J9). Display only.
 * Nothing automatic overwrites `confirmed` or `none`.
 */
export const companyDomains = sqliteTable('company_domains', {
  companyKey: text('company_key').primaryKey(),
  name: text('name').notNull(),
  domain: text('domain'),
  state: text('state', { enum: DOMAIN_STATES }).notNull(),
  source: text('source').notNull(),
  brandId: text('brand_id'),
  /** https icon on `domain`, set only for a typed domain. Null uses Brandfetch, or a letter when source is typed. */
  markUrl: text('mark_url'),
  updatedAt: text('updated_at').notNull(),
});

export const schema = {
  companies,
  jobs,
  jobAreas,
  jobScores,
  applications,
  events,
  runs,
  companyDomains,
};

/** Ordered list of table names, for row-count reporting (`db:info`). */
export const tableNames = [
  'companies',
  'jobs',
  'job_areas',
  'job_scores',
  'applications',
  'events',
  'runs',
  'company_domains',
] as const;

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type JobScore = typeof jobScores.$inferSelect;
export type NewJobScore = typeof jobScores.$inferInsert;
export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;
export type EventRow = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
