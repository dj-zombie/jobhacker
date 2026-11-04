import 'server-only';
import { resolve } from 'node:path';
import type { Band } from '@/components/jobhacker';
import { attachedResume } from '../../core/apply/apply.js';
import { isStandardKey } from '../../core/apply/field-map.js';
import {
  type FillView,
  copyPasteRows,
  fillView,
  parseStoredReport,
} from '../../core/apply/fill-view.js';
import {
  type ShownDomain,
  countDomains,
  loadDomainMap,
  logoCompanies,
  logoSetKeys,
  namesMissingDomain,
} from '../../core/brand/logo-set.js';
import { LOGO_TILE_PX } from '../../core/brand/logo-url.js';
import { companyLogoSrc } from '../../core/brand/site-icon.js';
import { ConfigError } from '../../core/config/errors.js';
import { loadAllConfig } from '../../core/config/load.js';
import {
  type Bands,
  type Criteria,
  DIMENSIONS,
  type Profile,
  REMOTE_AREA,
  type Weights,
} from '../../core/config/schemas.js';
import { DEFAULT_DB_PATH, type Db, openExistingDb } from '../../core/db/client.js';
import { applicationsRepo } from '../../core/db/repo/applications.js';
import { domainsRepo } from '../../core/db/repo/domains.js';
import { eventsRepo } from '../../core/db/repo/events.js';
import { runsRepo } from '../../core/db/repo/runs.js';
import { type JobDetail, type ListFilters, scoresRepo } from '../../core/db/repo/scores.js';
import type { Application, EventRow, ScoreState, Verdict } from '../../core/db/schema.js';
import { areaIds, areaLabel, whereDefault } from '../../core/pipeline/areas.js';
import { type Funnel, computeFunnel } from '../../core/pipeline/funnel.js';
import { paletteJobs } from '../../core/pipeline/palette.js';
import { type RankedOptions, rankedList } from '../../core/pipeline/ranked.js';
import { reconcilePlacement } from '../../core/pipeline/reconcile.js';
import { type ScoutHeader, scoutHeader } from '../../core/pipeline/review.js';
import {
  type ScoreRunState,
  liveScoringRun,
  scoreRunState,
} from '../../core/pipeline/score-run.js';
import { type ScoringKey, scoringInputs } from '../../core/pipeline/score.js';
import {
  ABANDONED_AFTER_MS,
  scoutCard,
  scoutCheckedWords,
  scoutStaleBanner,
} from '../../core/pipeline/scout-card.js';
import { parseScoutProgress } from '../../core/pipeline/scout-progress.js';
import {
  type ApplicationList,
  answerApprovals,
  followUpCutoff,
  inApplicationList,
  listApplications,
} from '../../core/pipeline/tracker.js';
import type { TriageView } from '../../core/pipeline/triage-view.js';
import {
  type TriageCounts,
  type TriageRow,
  scoringSummary,
  triageCounts,
  triageDetail,
  triageRowOf,
  triageRows,
} from '../../core/pipeline/triage.js';
import { type WhyReport, explainJob } from '../../core/pipeline/why.js';
import { attachmentName } from '../../core/prep/render.js';
import { atsLabel } from '../../core/sources/detect.js';
import { systemClock } from '../../core/util/clock.js';
import { normalizeCompanyName } from '../../core/util/hash.js';
import { activityGroups, shortDate } from './activity.js';
import { type QueueItem, compLabel, locationLabel, remoteTypeOf } from './format.js';
import type { PaletteJob, ScoutCardView, ScoutRunView, ShellCounts } from './shell-types.js';
import {
  type PlaceInfo,
  type TriageDetailData,
  type TriagePageData,
  type TriageRowData,
  scoreOf,
} from './triage.js';
import type {
  ApplicationRowView,
  CompanyLogoRef,
  StageCounts,
  WorkspaceAnswer,
  WorkspaceData,
} from './workspace-types.js';

/**
 * Server-only DB readers for the review UI. The `server-only` import makes a
 * client import a build error (acceptance #3), so `better-sqlite3` can never
 * reach a client bundle. Each reader opens the DB, reads, and closes. None of
 * them calls the LLM: ranking is recomputed locally from stored dimensions.
 *
 * Reads tolerate an un-migrated database (no `jobs`/`runs` tables yet) by
 * returning empty results, so the UI shows "nothing yet" instead of crashing.
 */

function withDb<T>(fn: (db: Db) => T): T {
  const { db, sqlite } = openExistingDb();
  try {
    return fn(db);
  } finally {
    sqlite.close();
  }
}

/** A missing table, or a database file that isn't there: the layout shows the error state. */
function isMissingTable(err: unknown): boolean {
  return (
    err instanceof Error &&
    /no such table|no such column|unable to open database file|directory does not exist/i.test(
      err.message,
    )
  );
}

export type DbHealth =
  | { ok: true }
  | { ok: false; path: string; absolutePath: string; problem: string; command: string };

/** Whether the UI's database exists and has been set up. Never creates the file. */
export function getDbHealth(): DbHealth {
  const fail = (problem: string, command: string): DbHealth => ({
    ok: false,
    path: DEFAULT_DB_PATH,
    absolutePath: resolve(DEFAULT_DB_PATH),
    problem,
    command,
  });
  try {
    const { sqlite } = openExistingDb();
    try {
      sqlite.prepare('select count(*) from jobs').get();
      return { ok: true };
    } finally {
      sqlite.close();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/unable to open database file|directory does not exist/i.test(message)) {
      return fail('There is no database file there.', 'pnpm db:migrate && pnpm cli scout');
    }
    if (/no such table/i.test(message)) {
      return fail('The database has no tables yet.', 'pnpm db:migrate');
    }
    return fail(`The database can't be opened: ${message}`, 'pnpm cli db:info');
  }
}

function orEmpty<T>(fn: () => T, empty: T): T {
  try {
    return fn();
  } catch (err) {
    if (isMissingTable(err)) return empty;
    throw err;
  }
}

/** The config the UI ranks with, or the config error to show instead. */
export type UiConfig =
  | {
      ok: true;
      criteria: Criteria;
      preferences: string;
      key: ScoringKey;
      /** For the sidebar badge, from `profile.contact.name`. */
      user: { name: string; initials: string };
    }
  | { ok: false; error: string };

export function getUiConfig(): UiConfig {
  try {
    const config = loadAllConfig();
    const { key } = scoringInputs(config.criteria, config.profile, config.preferences);
    const name = config.profile.contact.name;
    return {
      ok: true,
      criteria: config.criteria,
      preferences: config.preferences,
      key,
      user: { name, initials: initialsOf(name) },
    };
  } catch (err) {
    if (err instanceof ConfigError) return { ok: false, error: err.message };
    throw err;
  }
}

/** "Ada King Lovelace" → "AL": the first letters of the first and last words. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

function dimsLabel(row: {
  dimensions: Record<(typeof DIMENSIONS)[number], { score: number | null }>;
}): string {
  return DIMENSIONS.map((d) => `${d[0]?.toUpperCase()}${row.dimensions[d].score ?? '–'}`).join(' ');
}

type RankedRow = ReturnType<typeof rankedList>[number];
type ListedRow = ReturnType<ReturnType<typeof scoresRepo>['unscoredRows']>[number];
type OkConfig = Extract<UiConfig, { ok: true }>;

function withDomain(item: QueueItem, domains: ReadonlyMap<string, ShownDomain>): QueueItem {
  const key = normalizeCompanyName(item.company);
  const shown = key ? domains.get(key) : undefined;
  return {
    ...item,
    domain: shown?.domain ?? null,
    logoSource: shown?.source ?? null,
    markUrl: shown?.markUrl ?? null,
  };
}

function rankedItem(row: RankedRow): QueueItem {
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
    score: row.score,
    verdict: row.verdict,
    stale: row.stale,
    dims: dimsLabel(row),
    prescore: row.prescore,
    note: null,
    domain: null,
    logoSource: null,
    markUrl: null,
  };
}

function listedItem(row: ListedRow, note: string | null): QueueItem {
  return {
    ...row,
    score: null,
    verdict: null,
    stale: false,
    dims: null,
    note,
    domain: null,
    logoSource: null,
    markUrl: null,
  };
}

/** The J4 queue's earlier views. Nothing routes to them since J6 (D97, superseded). */
export const QUEUE_VIEWS = ['review', 'ranked'] as const;
export type QueueView = (typeof QUEUE_VIEWS)[number];

/** A view's rows: re-ranked with `weights` (the sliders), never the LLM. */
function viewRows(
  db: Db,
  config: OkConfig,
  view: QueueView,
  weights: Weights,
  filters: ListFilters,
  verdict?: Verdict,
): QueueItem[] {
  const domains = loadDomainMap(db, systemClock);
  if (view === 'review') {
    return scoresRepo(db, systemClock)
      .reviewRows(filters)
      .map((row) => withDomain(listedItem(row, row.remoteType), domains));
  }
  const ranking = { weights, bands: config.criteria.bands, current: config.key };
  return rankedList(db, systemClock, ranking, { ...filters, verdict }).map((row) =>
    withDomain(rankedItem(row), domains),
  );
}

export function getQueueRows(
  config: OkConfig,
  view: QueueView,
  options: { weights: Weights; filters?: ListFilters; verdict?: Verdict },
): QueueItem[] {
  return orEmpty(
    () =>
      withDb((db) => {
        reconcilePlacement(db, config.criteria, config.preferences, systemClock);
        return viewRows(db, config, view, options.weights, options.filters ?? {}, options.verdict);
      }),
    [],
  );
}

const NO_STAGES: StageCounts = { prepped: 0, submitted: 0, interviewing: 0, offer: 0 };

/** "Today, 7:34 PM", "Yesterday", or "Oct 22", in the server's time zone (Kris's Mac). */
function updatedLabel(iso: string, nowMs: number): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';
  const now = new Date(nowMs);
  if (at.toDateString() === now.toDateString()) {
    return `Today, ${at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (at.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return shortDate(iso);
}

/** A local `yyyy-mm-dd` for a date input. */
function localDate(iso: string | null): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

function logoRef(domains: ReadonlyMap<string, ShownDomain>, company: string): CompanyLogoRef {
  const key = normalizeCompanyName(company);
  const shown = key ? domains.get(key) : undefined;
  return {
    domain: shown?.domain ?? null,
    logoSource: shown?.source ?? null,
    markUrl: shown?.markUrl ?? null,
  };
}

function applicationFill(db: Db, app: Application, ats: string, profile: Profile): FillView {
  return fillView({
    ats,
    report: parseStoredReport(app.fillReport),
    answers: app.answers ?? {},
    coverNote: app.coverNote,
    profile,
    approvals: answerApprovals(db, systemClock, app.id),
  });
}

function scoreForJob(
  db: Db,
  config: OkConfig,
  jobId: number,
): { score: number | null; band: Band | null; detail: ReturnType<typeof triageDetail> } {
  const detail = triageDetail(db, systemClock, jobId, config.key);
  const dims = detail ? triageRowOf(detail).dims : null;
  return {
    ...scoreOf(dims, { weights: config.criteria.weights, bands: config.criteria.bands }),
    detail,
  };
}

function progressOf(view: FillView, status: string): ApplicationRowView['progress'] {
  if (view.rows.length === 0) return null;
  const filled = view.filled + view.review;
  const total = view.rows.length;
  // Once it's sent, what was left to check no longer matters.
  if (status !== 'prepped') return { filled, review: 0, total, label: 'Sent' };
  const label =
    view.review > 0
      ? `${view.review} to check`
      : view.requiredBlank > 0
        ? `${view.requiredBlank} required blank`
        : 'Ready';
  return { filled, review: view.review, total, label };
}

export interface ApplicationListData {
  rows: ApplicationRowView[];
  stages: StageCounts;
  /** The soonest follow-up not yet due, for the empty Follow-ups view. */
  nextFollowUp: { company: string; date: string } | null;
}

/** One of the pipeline lists, with the stage counts above it (J7). */
export function getApplicationList(config: OkConfig, list: ApplicationList): ApplicationListData {
  return orEmpty(
    () =>
      withDb((db) => {
        const nowMs = systemClock.nowMs();
        const cutoff = followUpCutoff(systemClock);
        const all = listApplications(db, systemClock);
        const stages = { ...NO_STAGES };
        for (const row of all) {
          if (row.status in stages) stages[row.status as keyof StageCounts] += 1;
        }
        const profile = loadAllConfig().profile;
        const domains = loadDomainMap(db, systemClock);
        const apps = applicationsRepo(db, systemClock);
        const listed = all.filter((row) => inApplicationList(row, list, cutoff));
        if (list === 'follow-ups') {
          listed.sort((a, b) => (a.followUpAt ?? '').localeCompare(b.followUpAt ?? ''));
        }
        const rows = listed.map((row): ApplicationRowView => {
          const app = apps.get(row.applicationId);
          const view = app ? applicationFill(db, app, row.ats, profile) : null;
          const { score, band } = scoreForJob(db, config, row.jobId);
          return {
            applicationId: row.applicationId,
            title: row.title,
            company: row.company,
            status: row.status,
            updatedLabel: updatedLabel(row.updatedAt, nowMs),
            followUpLabel:
              row.followUpAt && row.status !== 'prepped' ? shortDate(row.followUpAt) : null,
            followUpDue: inApplicationList(row, 'follow-ups', cutoff),
            progress: view ? progressOf(view, row.status) : null,
            score,
            band,
            logo: logoRef(domains, row.company),
          };
        });
        const upcoming = all
          .filter(
            (row) =>
              row.followUpAt !== null &&
              row.followUpAt > cutoff &&
              inApplicationList({ ...row, followUpAt: cutoff }, 'follow-ups', cutoff),
          )
          .sort((a, b) => (a.followUpAt ?? '').localeCompare(b.followUpAt ?? ''))[0];
        const nextFollowUp =
          upcoming?.followUpAt != null
            ? { company: upcoming.company, date: shortDate(upcoming.followUpAt) }
            : null;
        return { rows, stages, nextFollowUp };
      }),
    { rows: [], stages: { ...NO_STAGES }, nextFollowUp: null },
  );
}

/** Standard keys are snake_case; a form question's key is already its label. */
function answerLabel(key: string): string {
  if (!isStandardKey(key)) return key;
  const spaced = key.replace(/_/g, ' ').trim().replace(/ us$/, ' (US)');
  return spaced.length === 0 ? key : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function workspaceAnswers(answers: Record<string, string>, view: FillView): WorkspaceAnswer[] {
  const out: WorkspaceAnswer[] = [];
  const seen = new Set<string>();
  const push = (key: string, value: string, stored: boolean) => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, label: answerLabel(key), value, standard: isStandardKey(key), stored });
  };
  for (const [key, value] of Object.entries(answers)) {
    if (isStandardKey(key)) push(key, value, true);
  }
  for (const [key, value] of Object.entries(answers)) {
    if (!isStandardKey(key)) push(key, value, true);
  }
  // A question the fill left blank gets a field, so Add answer has somewhere to go.
  for (const row of view.rows) {
    if (row.state === 'blank' && row.fix === 'answer' && row.answerKey) {
      push(row.answerKey, '', false);
    }
  }
  return out;
}

/** Everything the workspace at `/applications/[id]` shows (J7). */
export function getWorkspace(config: OkConfig, applicationId: number): WorkspaceData | undefined {
  return orEmpty(
    () =>
      withDb((db): WorkspaceData | undefined => {
        const app = applicationsRepo(db, systemClock).get(applicationId);
        if (!app) return undefined;
        const { score, band, detail } = scoreForJob(db, config, app.jobId);
        if (!detail) return undefined;
        const profile = loadAllConfig().profile;
        const domains = loadDomainMap(db, systemClock);
        const view = applicationFill(db, app, detail.job.ats, profile);
        const answers = workspaceAnswers(app.answers ?? {}, view);
        const resume = attachedResume(app.resumePdfPath);
        const events = eventsRepo(db, systemClock).timeline(app.jobId, app.id);
        return {
          applicationId: app.id,
          jobId: app.jobId,
          title: detail.job.title,
          company: detail.company,
          status: app.status,
          submittedAt: app.submittedAt,
          followUpDate: localDate(app.followUpAt),
          notes: app.notes ?? '',
          postingUrl: detail.job.url,
          location: locationLabel(detail.job),
          remote: remoteTypeOf(detail.job.remoteType),
          score,
          band,
          logo: logoRef(domains, detail.company),
          fill: view,
          filled: parseStoredReport(app.fillReport) !== null,
          resume: {
            pdfUrl: resume.path
              ? `/applications/${app.id}/resume.pdf?v=${encodeURIComponent(app.updatedAt)}`
              : null,
            html: app.resumeHtml ?? '',
            fileName: attachmentName(profile, 'Resume'),
            provided: resume.provided,
          },
          coverNote: app.coverNote ?? '',
          answers,
          copyRows: copyPasteRows(app.coverNote, answers),
          activity: activityGroups(events, systemClock.nowMs()),
          backHref: app.status === 'prepped' ? '/applications' : '/applications/submitted',
        };
      }),
    undefined,
  );
}

/** The application id for a job, for links that only know the job. */
export function getApplicationIdForJob(jobId: number): number | undefined {
  return orEmpty(
    () => withDb((db) => applicationsRepo(db, systemClock).findByJob(jobId)?.id),
    undefined,
  );
}

/** The resume PDF an application attaches: Kris's own when he has one in `input/`, else prep's. */
export function getResumePdfPath(applicationId: number): string | null {
  return orEmpty(
    () =>
      withDb((db) => {
        const app = applicationsRepo(db, systemClock).get(applicationId);
        return app ? attachedResume(app.resumePdfPath).path : null;
      }),
    null,
  );
}

/**
 * The sidebar's counts. Triage counts come from the same reader as the triage views, within
 * `where_default` and under the saved weights; a triage view replaces them with its own Where's.
 */
export function getShellCounts(config: UiConfig): ShellCounts | null {
  if (!config.ok) return null;
  return orEmpty(
    () =>
      withDb((db) => {
        reconcilePlacement(db, config.criteria, config.preferences, systemClock);
        const apps = listApplications(db, systemClock);
        const cutoff = followUpCutoff(systemClock);
        const records = domainsRepo(db, systemClock).all();
        const logos = countDomains(
          logoSetKeys(db, systemClock, config.criteria),
          records,
        ).noDomainYet;
        const inList = (list: ApplicationList) =>
          apps.filter((row) => inApplicationList(row, list, cutoff)).length;
        return {
          ...countsIn(db, config, whereDefault(config.criteria)),
          inProgress: inList('in-progress'),
          submitted: inList('submitted'),
          followUps: inList('follow-ups'),
          logos,
        };
      }),
    null,
  );
}

function countsIn(
  db: Db,
  config: OkConfig,
  where: readonly string[],
  ranking?: { weights?: Weights; bands?: Bands },
): TriageCounts {
  return triageCounts(db, systemClock, {
    key: config.key,
    where,
    weights: ranking?.weights ?? config.criteria.weights,
    bands: ranking?.bands ?? config.criteria.bands,
  });
}

/**
 * The triage counts within a Where, for the sidebar after a Where change, a triage action,
 * or a live weight move. Absent weights and bands are the ones saved in `criteria.yaml`.
 */
export function getTriageCounts(
  config: OkConfig,
  where: readonly string[],
  ranking?: { weights?: Weights; bands?: Bands },
): TriageCounts {
  return orEmpty(() => withDb((db) => countsIn(db, config, where, ranking)), {
    matches: 0,
    fresh: 0,
    shortlist: 0,
    unscored: 0,
  });
}

/** The Where filter's options in config order: each place, then Remote. */
export function placesOf(criteria: Criteria): PlaceInfo[] {
  const countries = criteria.remote?.countries ?? [];
  return areaIds(criteria).map((id): PlaceInfo => {
    if (id === REMOTE_AREA) {
      return {
        id,
        label: 'Remote',
        kind: 'remote',
        ...(countries.length ? { note: `Remote roles open to ${countries.join(', ')}` } : {}),
      };
    }
    const note = criteria.places?.find((place) => place.id === id)?.note;
    return { id, label: areaLabel(criteria, id), kind: 'place', ...(note ? { note } : {}) };
  });
}

function rowData(
  row: TriageRow,
  order: readonly string[],
  domains: ReadonlyMap<string, ShownDomain>,
): TriageRowData {
  const key = normalizeCompanyName(row.company);
  const shown = key ? domains.get(key) : undefined;
  return {
    id: row.jobId,
    title: row.title,
    company: row.company,
    location: locationLabel(row),
    remote: remoteTypeOf(row.remoteType),
    comp: row.compMin == null && row.compMax == null ? null : compLabel(row),
    seenAt: row.firstSeenAt,
    prescore: row.prescore,
    status: row.status,
    closed: row.closed,
    areas:
      row.areas.length > 1
        ? [...row.areas].sort((a, b) => order.indexOf(a) - order.indexOf(b))
        : row.areas,
    dims: row.dims,
    domain: shown?.domain ?? null,
    logoSource: shown?.source ?? null,
    markUrl: shown?.markUrl ?? null,
  };
}

/** The Company logos page: the logo set, best band first, then by name. */
export function getLogoCompanies(config: UiConfig) {
  if (!config.ok) return [];
  return orEmpty(
    () =>
      withDb((db) => {
        reconcilePlacement(db, config.criteria, config.preferences, systemClock);
        return logoCompanies(db, systemClock, config.criteria);
      }),
    [],
  );
}

/** Logo-set companies the job text didn't name, strongest first. The browser looks these up. */
export function getLogoLookup(config: UiConfig): { clientId: string | null; names: string[] } {
  const clientId = brandfetchClientId();
  if (!config.ok || !clientId) return { clientId, names: [] };
  return orEmpty(
    () =>
      withDb((db) => ({ clientId, names: namesMissingDomain(db, systemClock, config.criteria) })),
    { clientId, names: [] },
  );
}

/** The Brandfetch client id, or null when logos stay monograms. Never logged. */
export function brandfetchClientId(): string | null {
  const id = process.env.BRANDFETCH_CLIENT_ID;
  return id && id.length > 0 ? id : null;
}

/** Company key to the domain a tile should draw, for the few server-rendered lists. */
export function getCompanyDomains(): Map<string, ShownDomain> {
  return orEmpty(() => withDb((db) => loadDomainMap(db, systemClock)), new Map());
}

/** Every row of a triage view, before Where and Seen; the client filters and ranks. */
export function getTriagePage(config: OkConfig, view: TriageView): TriagePageData {
  const places = placesOf(config.criteria);
  const order = places.map((p) => p.id);
  const base = {
    places,
    whereDefault: whereDefault(config.criteria),
    ranking: { weights: config.criteria.weights, bands: config.criteria.bands },
    nowMs: systemClock.nowMs(),
    logoClientId: brandfetchClientId(),
  };
  return orEmpty(
    () =>
      withDb((db) => {
        reconcilePlacement(db, config.criteria, config.preferences, systemClock);
        const domains = loadDomainMap(db, systemClock);
        const rows = triageRows(db, systemClock, view, config.key).map((r) =>
          rowData(r, order, domains),
        );
        const stale = scoutStaleBanner(db, systemClock);
        const live = liveScoringRun(db, systemClock);
        return {
          ...base,
          rows,
          banner: stale
            ? { checkedOn: stale.checkedAt ? scoutCheckedWords(stale.checkedAt) : null }
            : null,
          scoring:
            view === 'unscored'
              ? scoringSummary(computeFunnel(db, systemClock, config.criteria, config.key))
              : null,
          liveRun:
            live?.kind === 'score' ? (scoreRunState(db, systemClock, live.id) ?? null) : null,
        };
      }),
    { ...base, rows: [], banner: null, scoring: null, liveRun: null },
  );
}

/** One job's detail for the detail pane or the deep link, or undefined when it doesn't exist. */
export function getTriageDetail(config: OkConfig, jobId: number): TriageDetailData | undefined {
  const order = areaIds(config.criteria);
  return orEmpty(
    () =>
      withDb((db) => {
        const d = triageDetail(db, systemClock, jobId, config.key);
        if (!d) return undefined;
        const s = d.score;
        return {
          row: rowData(triageRowOf(d), order, loadDomainMap(db, systemClock)),
          employment: d.job.employmentType ?? '',
          postedAt: d.job.postedAt,
          lastSeenAt: d.job.lastSeenAt,
          description: d.job.descriptionText ?? '',
          postingUrl: d.job.url,
          summary: s?.summary ?? null,
          reasons: s ? DIMENSIONS.map((dim) => s.dimensions[dim].reason) : null,
          redFlags: s?.redFlags ?? [],
          model: s?.model ?? null,
          rubric: s?.rubricVersion ?? null,
          scoredAt: s?.scoredAt ?? null,
          stale: d.stale,
          application: d.application,
        };
      }),
    undefined,
  );
}

/** A score batch's progress, polled by the Unscored view and Score this job. */
export function getScoreRun(runId: number): ScoreRunState | null {
  return orEmpty(() => withDb((db) => scoreRunState(db, systemClock, runId) ?? null), null);
}

/** "3:26 AM" for a run today, "Oct 24" before that, in the server's time zone (Kris's Mac). */
function runLabel(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return 'Never';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';
  const sameDay = at.toDateString() === new Date(nowMs).toDateString();
  return sameDay
    ? at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function getScoutCard(config: UiConfig): ScoutCardView | null {
  if (!config.ok) return null;
  return orEmpty(
    () =>
      withDb((db) => {
        const card = scoutCard(db, systemClock, config.criteria);
        const last = card.lastRun;
        return {
          status: card.status,
          notices: card.notices.map((notice) => ({
            text: notice.text,
            ...(notice.retire ? { retire: notice.retire } : {}),
            ...(notice.relocate
              ? {
                  relocate: {
                    looked: notice.relocate.looked,
                    candidates: notice.relocate.candidates.map((c) => ({
                      ats: c.ats,
                      token: c.token,
                      label: `${atsLabel(c.ats)} · ${c.token}`,
                      detail: `${c.postings.toLocaleString('en-US')} ${c.postings === 1 ? 'posting' : 'postings'} · ${c.name}`,
                    })),
                  },
                }
              : {}),
          })),
          running: card.running,
          lastRunLabel: runLabel(last?.finishedAt ?? last?.startedAt, systemClock.nowMs()),
          boards: card.boards,
          newLastRun: card.newLastRun,
          modelCalls: card.modelCalls,
          progress: card.progress,
        };
      }),
    null,
  );
}

/** One scout run, for the card's live progress. Null when the id isn't a scout. */
export function getScoutRun(runId: number): ScoutRunView | null {
  return orEmpty(
    () =>
      withDb((db) => {
        const run = runsRepo(db, systemClock).get(runId);
        if (!run || run.kind !== 'scout') return null;
        const running =
          run.finishedAt === null &&
          systemClock.nowMs() - Date.parse(run.startedAt) < ABANDONED_AFTER_MS;
        const stats =
          run.stats && typeof run.stats === 'object'
            ? (run.stats as Record<string, unknown>)
            : null;
        const num = (key: string): number | null =>
          typeof stats?.[key] === 'number' ? (stats[key] as number) : null;
        return {
          runId,
          running,
          progress: parseScoutProgress(run.stats),
          ok: run.finishedAt === null ? null : run.ok,
          error: run.error,
          inserted: num('inserted'),
          closed: num('closed'),
          closedShortlisted: num('closed_shortlisted'),
          boardsOk: num('boards_ok'),
          boards: num('boards'),
          errorCount: Array.isArray(stats?.errors) ? stats.errors.length : null,
        };
      }),
    null,
  );
}

/** The top 40 jobs for ⌘K, ranked with the given weights or the saved ones. */
export function getPaletteJobs(
  config: UiConfig,
  ranking: { weights?: Weights; bands?: Bands } = {},
): PaletteJob[] {
  if (!config.ok) return [];
  return orEmpty(
    () =>
      withDb((db) => {
        const domains = loadDomainMap(db, systemClock);
        const clientId = brandfetchClientId();
        return paletteJobs(db, systemClock, {
          key: config.key,
          weights: ranking.weights ?? config.criteria.weights,
          bands: ranking.bands ?? config.criteria.bands,
        }).map((row) => {
          const key = normalizeCompanyName(row.company);
          const shown = key ? domains.get(key) : undefined;
          const band = row.verdict === 'strong' || row.verdict === 'maybe' ? row.verdict : 'no';
          return {
            id: String(row.id),
            title: row.title,
            company: row.company,
            location: locationLabel(row),
            score: row.score,
            band,
            areas: row.areas,
            logoUrl: companyLogoSrc({
              domain: shown?.domain ?? null,
              source: shown?.source ?? null,
              markUrl: shown?.markUrl ?? null,
              clientId,
              size: LOGO_TILE_PX,
            }),
          };
        });
      }),
    [],
  );
}

export function getFunnel(config: UiConfig): Funnel | null {
  if (!config.ok) return null;
  return orEmpty(
    () =>
      withDb((db) => {
        reconcilePlacement(db, config.criteria, config.preferences, systemClock);
        return computeFunnel(db, systemClock, config.criteria, config.key);
      }),
    null,
  );
}

export function getQueueCompanies(config: Extract<UiConfig, { ok: true }>): string[] {
  return orEmpty(
    () =>
      withDb((db) => {
        reconcilePlacement(db, config.criteria, config.preferences, systemClock);
        return scoresRepo(db, systemClock).queueCompanies();
      }),
    [],
  );
}

export function getJobDetail(jobId: number): JobDetail | undefined {
  return orEmpty(() => withDb((db) => scoresRepo(db, systemClock).detail(jobId)), undefined);
}

export function getJobEvents(jobId: number): EventRow[] {
  return orEmpty(() => withDb((db) => eventsRepo(db, systemClock).forJob(jobId)), []);
}

/** How many `llm_usage` events exist; the UI shows it so a re-rank's zero cost is visible. */
export function getLlmCallCount(): number {
  return orEmpty(() => withDb((db) => eventsRepo(db, systemClock).ofType('llm_usage').length), 0);
}

export function getScoutHeader(): ScoutHeader {
  return orEmpty(() => withDb((db) => scoutHeader(db, systemClock)), { present: false });
}
