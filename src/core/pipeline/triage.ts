import { sql } from 'drizzle-orm';
import type { Bands, Weights } from '../config/schemas.js';
import type { Db } from '../db/client.js';
import type { ApplicationStatus } from '../db/repo/applications.js';
import { type ListFilters, type ListedJob, type ScoredRow, scoresRepo } from '../db/repo/scores.js';
import type { Dimensions, Job } from '../db/schema.js';
import type { Clock } from '../util/clock.js';
import { type Funnel, gateLines } from './funnel.js';
import { rankJobs } from './rank.js';
import { isStale } from './ranked.js';
import type { ScoringKey } from './score.js';
import {
  type DimScores,
  NEW_WITHIN_HOURS,
  type TriageView,
  UNTRIAGED,
  dimScores,
  inView,
  inWhere,
  newSince,
  toDimensions,
} from './triage-view.js';

/**
 * The four triage views (J5): Top matches, New today, Shortlist and Unscored. One reader for the
 * rows of each view, for the sidebar's counts and for one job's detail, so a count can never
 * disagree with its list (D88). Read-only; never calls the model.
 *
 * Only a score under the current cache key counts: a job whose only score is stale is unscored in
 * every view. Where is not applied here. Rows carry their areas, and the caller filters, because
 * the Where filter shows a count for every place.
 */

export interface TriageRow extends ListedJob {
  /** Scores under the current cache key; null while unscored or stale. */
  dims: DimScores | null;
  /** Has a dimension score for this text, but only under an older key. */
  stale: boolean;
}

/** Jobs that have an application row. They leave triage for the applications views. */
function jobsWithApplication(db: Db): Set<number> {
  const rows = db.all<{ job_id: number }>(sql`select job_id from applications`);
  return new Set(rows.map((r) => r.job_id));
}

/** The list fields only: a scored row also carries its summary, flags and key, which rows don't need. */
function listedOf(row: ListedJob): ListedJob {
  return {
    jobId: row.jobId,
    company: row.company,
    title: row.title,
    locationRaw: row.locationRaw,
    remoteType: row.remoteType,
    url: row.url,
    compMin: row.compMin,
    compMax: row.compMax,
    compCurrency: row.compCurrency,
    status: row.status,
    postedAt: row.postedAt,
    firstSeenAt: row.firstSeenAt,
    prescore: row.prescore,
    scoreState: row.scoreState,
    areas: row.areas,
    closed: row.closed,
  };
}

function fromScored(row: ScoredRow, key: ScoringKey): TriageRow {
  const stale = isStale(row, key);
  return { ...listedOf(row), dims: stale ? null : dimScores(row.dimensions), stale };
}

function fromUnscored(row: ListedJob): TriageRow {
  return { ...listedOf(row), dims: null, stale: false };
}

function newCutoff(clock: Clock): string {
  return newSince(clock.nowMs());
}

/** Visible jobs matching `filters`, with their current-key scores, minus jobs with an application. */
function loadRows(
  db: Db,
  clock: Clock,
  key: ScoringKey,
  filters: ListFilters,
  withUnscored: boolean,
): TriageRow[] {
  const repo = scoresRepo(db, clock);
  const rows = repo.scoredRows(filters).map((row) => fromScored(row, key));
  if (withUnscored) rows.push(...repo.unscoredRows(filters).map(fromUnscored));
  const applied = jobsWithApplication(db);
  return rows.filter((row) => !applied.has(row.jobId));
}

/** Every row of a view, before Where and Seen. Unordered: the UI ranks them. */
export function triageRows(db: Db, clock: Clock, view: TriageView, key: ScoringKey): TriageRow[] {
  const since = newCutoff(clock);
  if (view === 'shortlist') {
    const open = loadRows(db, clock, key, { statuses: ['shortlisted'] }, true).filter((row) =>
      inView(view, row, since),
    );
    const closed = loadRows(
      db,
      clock,
      key,
      { statuses: ['shortlisted'], includeClosedShortlist: true },
      true,
    ).filter((row) => row.closed && inView(view, row, since));
    return [...open, ...closed];
  }
  const filters: ListFilters = {
    statuses: UNTRIAGED,
    ...(view === 'new' ? { seenWithinHours: NEW_WITHIN_HOURS } : {}),
  };
  return loadRows(db, clock, key, filters, view !== 'top').filter((row) =>
    inView(view, row, since),
  );
}

export interface TriageCounts {
  /** Strong and Maybe in Top matches. */
  matches: number;
  fresh: number;
  shortlist: number;
  unscored: number;
}

/** The sidebar's triage counts within `where`, ranked with the given weights and bands. */
export function triageCounts(
  db: Db,
  clock: Clock,
  options: { key: ScoringKey; where: readonly string[]; weights: Weights; bands: Bands },
): TriageCounts {
  const all = loadRows(
    db,
    clock,
    options.key,
    { statuses: [...UNTRIAGED, 'shortlisted'] },
    true,
  ).filter((row) => inWhere(row.areas, options.where));
  const closedShort = loadRows(
    db,
    clock,
    options.key,
    { statuses: ['shortlisted'], includeClosedShortlist: true },
    true,
  ).filter((row) => row.closed && inWhere(row.areas, options.where));
  const since = newCutoff(clock);
  const rows = (view: TriageView) => all.filter((row) => inView(view, row, since));
  const ranked = rankJobs(
    rows('top').map((row) => ({ jobId: row.jobId, dimensions: toDimensions(row.dims ?? []) })),
    options.weights,
    options.bands,
  );
  return {
    matches: ranked.filter((row) => row.verdict !== 'no').length,
    fresh: rows('new').length,
    shortlist: rows('shortlist').length + closedShort.length,
    unscored: rows('unscored').length,
  };
}

/** One job's score for the detail pane: present only under the current key. */
export interface DetailScore {
  dimensions: Dimensions;
  summary: string | null;
  redFlags: string[];
  model: string;
  rubricVersion: string;
  scoredAt: string;
}

export interface TriageDetail {
  job: Job;
  company: string;
  areas: string[];
  score: DetailScore | null;
  /** Scored under an older key only: shown as unscored until a score run reaches it. */
  stale: boolean;
  application: { id: number; status: ApplicationStatus } | null;
}

/** Everything the detail pane needs about one job, or undefined when the id doesn't exist. */
export function triageDetail(
  db: Db,
  clock: Clock,
  jobId: number,
  key: ScoringKey,
): TriageDetail | undefined {
  const detail = scoresRepo(db, clock).detail(jobId);
  if (!detail) return undefined;
  const areas = db
    .all<{ area: string }>(sql`select area from job_areas where job_id = ${jobId}`)
    .map((r) => r.area);
  const app = db.get<{ id: number; status: ApplicationStatus }>(
    sql`select id, status from applications where job_id = ${jobId}`,
  );
  const s = detail.score;
  const dims = s?.dimensions ?? null;
  const stale = s !== null && dims !== null && isStale(s, key);
  const score: DetailScore | null =
    s !== null && dims !== null && !stale
      ? {
          dimensions: dims,
          summary: s.summary,
          redFlags: s.redFlags ?? [],
          model: s.model,
          rubricVersion: s.rubricVersion,
          scoredAt: s.createdAt,
        }
      : null;
  return {
    job: detail.job,
    company: detail.company,
    areas,
    score,
    stale,
    application: app ? { id: app.id, status: app.status } : null,
  };
}

/** One job as a list row, for the deep-link page, whatever its view. */
export function triageRowFor(
  db: Db,
  clock: Clock,
  jobId: number,
  key: ScoringKey,
): TriageRow | undefined {
  const d = triageDetail(db, clock, jobId, key);
  return d ? triageRowOf(d) : undefined;
}

export function triageRowOf(d: TriageDetail): TriageRow {
  const { job } = d;
  return {
    jobId: job.id,
    company: d.company,
    title: job.title,
    locationRaw: job.locationRaw,
    remoteType: job.remoteType,
    url: job.url,
    compMin: job.compMin,
    compMax: job.compMax,
    compCurrency: job.compCurrency,
    status: job.status,
    postedAt: job.postedAt,
    firstSeenAt: job.firstSeenAt,
    prescore: job.prescore,
    scoreState: job.scoreState,
    areas: d.areas,
    dims: d.score ? dimScores(d.score.dimensions) : null,
    stale: d.stale,
    closed: job.closedAt !== null,
  };
}

/**
 * The Unscored view's hero, from the funnel (`pnpm cli funnel`): jobs past the gates scored under
 * the current key, the rest waiting (never scored, or stale), and the gated ones by gate.
 */
export interface ScoringSummary {
  scored: number;
  waiting: number;
  gated: number;
  gates: { gate: string; label: string; count: number }[];
  /** Must be 0; shown when it isn't, so the hero's numbers still add up. */
  notYetGated: number;
  cap: number;
}

export function scoringSummary(funnel: Funnel): ScoringSummary {
  return {
    scored: funnel.scored.current,
    waiting: funnel.unscored.total + funnel.scored.stale,
    gated: funnel.gatedTotal,
    gates: gateLines(funnel),
    notYetGated: funnel.notYetGated,
    cap: funnel.settings.maxNewScoresPerRun,
  };
}
