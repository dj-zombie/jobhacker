import { and, desc, eq, gte, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { countDomains, logoSetKeys } from '../brand/logo-set.js';
import { BOARD_ATS, type Criteria, LEGACY_SOURCES, SEARCH_ATS } from '../config/schemas.js';
import type { Db } from '../db/client.js';
import { domainsRepo } from '../db/repo/domains.js';
import { runsRepo } from '../db/repo/runs.js';
import { events, GATE_NAMES, type GateName, applications, companies, jobs } from '../db/schema.js';
import { monthlyUsage } from '../llm/usage.js';
import { callsThisMonth } from '../sources/budget.js';
import type { Clock } from '../util/clock.js';
import { areaCounts, whereDefault } from './areas.js';
import { computeFunnel } from './funnel.js';
import { rankedList } from './ranked.js';
import type { ScoringKey } from './score.js';
import { followUpsDue } from './tracker.js';

/**
 * The usefulness snapshot (AGENTS § The usefulness snapshot): the same numbers
 * at the end of every round, so a round that passed its tests but made the
 * tool worse shows up. Read-only: no writes, no network, no model, no Chrome.
 * The job counts come from `computeFunnel`, so `stats` and `funnel` agree.
 */

const DAY_MS = 86_400_000;
const FILL_WINDOW = 10;
const TIME_WINDOW = 10;

export interface UsefulnessStats {
  jobs: { total: number; passed: number; gated: Record<GateName, number>; notYetGated: number };
  boards: { active: number; byAts: { ats: string; count: number }[] };
  scout: {
    startedAt: string;
    seconds: number | null;
    boardsOk: number | null;
    boardsFailed: number | null;
    errors: number | null;
  } | null;
  newLastDay: number;
  /** Open, canonical jobs whose record came from a search source: what search adds beyond the boards. */
  searchOnly: { total: number; bySource: { source: string; count: number }[] };
  scored: { current: number; stale: number; unscored: number };
  matches: { strong: number; maybe: number; weak: number };
  /**
   * Open jobs past the gates per area, from the stored `job_areas`; `null`
   * until `places` is configured. A job in two areas counts in both.
   */
  where: { byArea: { area: string; count: number }[]; elsewhere: number } | null;
  /** Strong and maybe matches within `where_default`; `null` when it is unset (anywhere). */
  inWhere: { areas: string[]; strong: number; maybe: number } | null;
  /** Logo set: companies with a domain, and how many of those Kris confirmed. */
  logos: { companies: number; withDomain: number; confirmed: number };
  apply: { prepared: number; filled: number; submitted: number; followUpsDue: number };
  fill: {
    reports: number;
    byAts: { ats: string; forms: number; filled: number; fields: number }[];
    needReview: number;
    blank: number;
    selfIdSet: number;
    /** Reports written before the fill event recorded self-ID. */
    selfIdUnrecorded: number;
  };
  time: { medianMinutes: number | null; measured: number; submissions: number };
  spend: {
    month: string;
    modelCalls: number;
    estimatedUsd: number;
    sources: { name: string; enabled: boolean; calls: number; budget: number }[];
  };
}

export interface StatsDeps {
  db: Db;
  clock: Clock;
  criteria: Criteria;
  /** The current scoring key, so stale scores are counted as stale. */
  current?: ScoringKey;
}

/** The counts stored on each `fill` event (`apply.ts`). `self_identification` is absent on older events. */
const fillPayloadSchema = z.object({
  ats: z.string(),
  filled: z.number(),
  drafted: z.number(),
  unfilled: z.number(),
  skipped_eeo: z.number(),
  self_identification: z.number().optional(),
});

const scoutStatsSchema = z.object({
  boards_ok: z.number().optional(),
  boards_failed: z.number().optional(),
  errors: z.array(z.unknown()).optional(),
});

export function computeStats(deps: StatsDeps): UsefulnessStats {
  const { db, clock, criteria } = deps;
  const funnel = computeFunnel(db, clock, criteria, deps.current);
  return {
    jobs: {
      total: funnel.total,
      passed: funnel.passed,
      gated: funnel.gated,
      notYetGated: funnel.notYetGated,
    },
    boards: activeBoards(db),
    scout: lastScout(db, clock),
    newLastDay: newSince(db, new Date(clock.nowMs() - DAY_MS).toISOString()),
    searchOnly: searchOnly(db),
    scored: {
      current: funnel.scored.current,
      stale: funnel.scored.stale,
      unscored: funnel.unscored.total,
    },
    matches: {
      strong: funnel.scored.bands.strong,
      maybe: funnel.scored.bands.maybe,
      weak: funnel.scored.bands.no,
    },
    where: whereCounts(db, criteria),
    inWhere: inWhereMatches(deps),
    logos: logoCounts(db, clock, criteria),
    apply: applyCounts(db, clock),
    fill: fillQuality(db),
    time: timeToSubmit(db),
    spend: spend(db, clock, criteria),
  };
}

function whereCounts(db: Db, criteria: Criteria): UsefulnessStats['where'] {
  if (!criteria.places) return null;
  const counts = areaCounts(db, criteria);
  return {
    byArea: counts
      .filter((c) => c.area !== 'none')
      .map((c) => ({ area: c.area, count: c.visible })),
    elsewhere: counts.find((c) => c.area === 'none')?.visible ?? 0,
  };
}

function logoCounts(db: Db, clock: Clock, criteria: Criteria): UsefulnessStats['logos'] {
  const counts = countDomains(logoSetKeys(db, clock, criteria), domainsRepo(db, clock).all());
  return {
    companies: counts.total,
    withDomain: counts.found + counts.confirmed,
    confirmed: counts.confirmed,
  };
}

function inWhereMatches(deps: StatsDeps): UsefulnessStats['inWhere'] {
  const { db, clock, criteria } = deps;
  const areas = whereDefault(criteria);
  if (areas.length === 0) return null;
  const rows = rankedList(
    db,
    clock,
    { weights: criteria.weights, bands: criteria.bands, current: deps.current },
    { areas },
  );
  return {
    areas,
    strong: rows.filter((r) => r.verdict === 'strong').length,
    maybe: rows.filter((r) => r.verdict === 'maybe').length,
  };
}

export function activeBoards(db: Db): UsefulnessStats['boards'] {
  const rows = db
    .select({ ats: companies.ats, count: sql<number>`count(*)` })
    .from(companies)
    .where(and(eq(companies.active, true), inArray(companies.ats, [...BOARD_ATS])))
    .groupBy(companies.ats)
    .all()
    .sort((a, b) => b.count - a.count || a.ats.localeCompare(b.ats));
  return { active: rows.reduce((sum, r) => sum + r.count, 0), byAts: rows };
}

function lastScout(db: Db, clock: Clock): UsefulnessStats['scout'] {
  const run = runsRepo(db, clock).latest('scout');
  if (!run) return null;
  const stats = scoutStatsSchema.safeParse(run.stats ?? {});
  const parsed = stats.success ? stats.data : {};
  return {
    startedAt: run.startedAt,
    seconds: run.finishedAt
      ? Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000)
      : null,
    boardsOk: parsed.boards_ok ?? null,
    boardsFailed: parsed.boards_failed ?? null,
    errors: parsed.errors ? parsed.errors.length : null,
  };
}

function newSince(db: Db, sinceIso: string): number {
  return (
    db.select({ n: sql<number>`count(*)` }).from(jobs).where(gte(jobs.firstSeenAt, sinceIso)).get()
      ?.n ?? 0
  );
}

function searchOnly(db: Db): UsefulnessStats['searchOnly'] {
  const rows = db
    .select({ source: jobs.sourceName, count: sql<number>`count(*)` })
    .from(jobs)
    .where(and(eq(jobs.sourceKind, 'search'), isNull(jobs.duplicateOf), isNull(jobs.closedAt)))
    .groupBy(jobs.sourceName)
    .all()
    .map((r) => ({ source: r.source ?? 'unknown', count: r.count }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
  return { total: rows.reduce((sum, r) => sum + r.count, 0), bySource: rows };
}

function applyCounts(db: Db, clock: Clock): UsefulnessStats['apply'] {
  const row = db
    .select({
      prepared: sql<number>`count(*)`,
      filled: sql<number>`coalesce(sum(case when ${applications.fillReport} is not null then 1 else 0 end), 0)`,
      submitted: sql<number>`coalesce(sum(case when ${applications.submittedAt} is not null and ${applications.status} != 'prepped' then 1 else 0 end), 0)`,
    })
    .from(applications)
    .get();
  return {
    prepared: row?.prepared ?? 0,
    filled: row?.filled ?? 0,
    submitted: row?.submitted ?? 0,
    followUpsDue: followUpsDue(db, clock).length,
  };
}

function fillQuality(db: Db): UsefulnessStats['fill'] {
  const rows = db
    .select({ payload: events.payload })
    .from(events)
    .where(eq(events.type, 'fill'))
    .orderBy(desc(events.id))
    .limit(FILL_WINDOW)
    .all();
  const byAts = new Map<string, { forms: number; filled: number; fields: number }>();
  let needReview = 0;
  let blank = 0;
  let selfIdSet = 0;
  let selfIdUnrecorded = 0;
  let reports = 0;
  for (const row of rows) {
    const parsed = fillPayloadSchema.safeParse(row.payload);
    if (!parsed.success) continue;
    const p = parsed.data;
    reports += 1;
    const selfId = p.self_identification ?? 0;
    if (p.self_identification === undefined) selfIdUnrecorded += 1;
    const entry = byAts.get(p.ats) ?? { forms: 0, filled: 0, fields: 0 };
    entry.forms += 1;
    entry.filled += p.filled + selfId;
    entry.fields += p.filled + p.unfilled + p.skipped_eeo + selfId;
    byAts.set(p.ats, entry);
    needReview += p.drafted;
    blank += p.unfilled + p.skipped_eeo;
    selfIdSet += selfId;
  }
  return {
    reports,
    byAts: [...byAts.entries()]
      .map(([ats, v]) => ({ ats, ...v }))
      .sort((a, b) => b.forms - a.forms || a.ats.localeCompare(b.ats)),
    needReview,
    blank,
    selfIdSet,
    selfIdUnrecorded,
  };
}

/** Minutes from the job's last shortlist to "marked submitted", over the latest submissions. */
function timeToSubmit(db: Db): UsefulnessStats['time'] {
  const submitted = db
    .select({ jobId: applications.jobId, submittedAt: applications.submittedAt })
    .from(applications)
    .where(and(isNotNull(applications.submittedAt), ne(applications.status, 'prepped')))
    .orderBy(desc(applications.submittedAt))
    .limit(TIME_WINDOW)
    .all();
  const minutes: number[] = [];
  for (const app of submitted) {
    if (!app.submittedAt) continue;
    const shortlisted = db
      .select({ at: sql<string | null>`max(${events.at})` })
      .from(events)
      .where(
        and(
          eq(events.jobId, app.jobId),
          eq(events.type, 'triage'),
          sql`json_extract(${events.payload}, '$.to') = 'shortlisted'`,
          sql`${events.at} <= ${app.submittedAt}`,
        ),
      )
      .get()?.at;
    if (!shortlisted) continue;
    minutes.push((Date.parse(app.submittedAt) - Date.parse(shortlisted)) / 60_000);
  }
  return {
    medianMinutes: median(minutes),
    measured: minutes.length,
    submissions: submitted.length,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1
      ? (sorted[mid] ?? 0)
      : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return Math.round(value);
}

function spend(db: Db, clock: Clock, criteria: Criteria): UsefulnessStats['spend'] {
  const usage = monthlyUsage(db, clock);
  const search = (criteria.sources ?? LEGACY_SOURCES).search;
  const now = clock.now();
  return {
    month: now.slice(0, 7),
    modelCalls: usage.calls,
    estimatedUsd: usage.estimatedUsd,
    sources: SEARCH_ATS.map((name) => ({
      name,
      enabled: search[name].enabled,
      calls: callsThisMonth(db, name, now),
      budget: search[name].monthly_call_budget,
    })),
  };
}

function list(items: { label: string; count: number }[]): string {
  return items.map((i) => `${i.label} ${i.count}`).join(' · ');
}

function percent(part: number, whole: number): string {
  return whole === 0 ? 'no fields' : `${Math.round((part / whole) * 100)}%`;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function duration(seconds: number | null): string {
  if (seconds === null) return 'unfinished';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** Plain-text rendering for the CLI, one line per AGENTS § The usefulness snapshot row. */
export function renderStats(s: UsefulnessStats): string {
  const gated = GATE_NAMES.reduce((sum, g) => sum + s.jobs.gated[g], 0);
  const gateParts = list(GATE_NAMES.map((g) => ({ label: g, count: s.jobs.gated[g] })));
  const notYet = s.jobs.notYetGated > 0 ? ` · ${s.jobs.notYetGated} not yet gated` : '';

  const scout = s.scout
    ? [
        `${s.scout.startedAt.slice(0, 16).replace('T', ' ')} UTC`,
        duration(s.scout.seconds),
        `${s.scout.boardsOk ?? '?'} ok`,
        `${s.scout.boardsFailed ?? '?'} failed`,
        `${s.scout.errors ?? '?'} errors`,
      ].join(' · ')
    : 'never run';

  const searchParts = list(s.searchOnly.bySource.map((r) => ({ label: r.source, count: r.count })));
  const search =
    s.searchOnly.total === 0
      ? '0 open jobs only from search'
      : `${s.searchOnly.total} open jobs only from search: ${searchParts}`;

  const perAts = s.fill.byAts
    .map((a) => `${a.ats} ${percent(a.filled, a.fields)} filled over ${plural(a.forms, 'form')}`)
    .join(' · ');
  const unrecorded =
    s.fill.selfIdUnrecorded > 0
      ? ` (${s.fill.selfIdUnrecorded} of ${s.fill.reports} reports predate the self-ID count)`
      : '';
  const fillLine =
    s.fill.reports === 0
      ? 'no fill reports yet'
      : [
          `last ${s.fill.reports} reports: ${perAts}`,
          `need review ${s.fill.needReview} · blank ${s.fill.blank} · self-ID set ${s.fill.selfIdSet}${unrecorded}`,
        ].join('\n          ');

  const unmeasured =
    s.time.submissions > s.time.measured
      ? ` (${s.time.submissions - s.time.measured} without a shortlist time)`
      : '';
  const time =
    s.time.medianMinutes === null
      ? `no shortlisted → submitted times yet (${s.time.submissions} submitted)`
      : `median ${s.time.medianMinutes} min from shortlisted to marked submitted, over ${plural(s.time.measured, 'submission')}${unmeasured}`;

  const sources = s.spend.sources
    .map((src) =>
      src.enabled ? `${src.name} ${src.calls}/${src.budget} calls` : `${src.name} off`,
    )
    .join(' · ');

  const lines: [string, string][] = [
    [
      'jobs',
      `${s.jobs.total} · ${s.jobs.passed} past the gates · ${gated} gated (${gateParts})${notYet}`,
    ],
    [
      'boards',
      `${s.boards.active} active: ${list(s.boards.byAts.map((b) => ({ label: b.ats, count: b.count })))}`,
    ],
    ['scout', scout],
    ['new', `${s.newLastDay} first seen in the last 24 hours`],
    ['search', search],
    [
      'scored',
      `${s.scored.current} current · ${s.scored.stale} stale · ${s.scored.unscored} unscored`,
    ],
    [
      'matches',
      `${s.matches.strong} strong · ${s.matches.maybe} maybe · ${s.matches.weak} weak (saved weights)`,
    ],
    [
      'where',
      s.where
        ? `${[...s.where.byArea.map((a) => `${a.count} ${a.area}`), `${s.where.elsewhere} elsewhere`].join(' · ')} (open, past the gates)`
        : 'not set up',
    ],
    [
      'in where',
      s.inWhere
        ? `${s.inWhere.strong} strong · ${s.inWhere.maybe} maybe in ${s.inWhere.areas.join(', ')}`
        : 'not set up',
    ],
    [
      'logos',
      `${s.logos.withDomain} of ${s.logos.companies} have a domain (${s.logos.confirmed} confirmed)`,
    ],
    [
      'apply',
      `${s.apply.prepared} prepared · ${s.apply.filled} filled · ${s.apply.submitted} submitted · ${s.apply.followUpsDue} follow-ups due`,
    ],
    ['fill', fillLine],
    ['time', time],
    [
      'spend',
      `${s.spend.month}: ${s.spend.modelCalls} model calls · est $${s.spend.estimatedUsd.toFixed(2)} · ${sources}`,
    ],
  ];
  return lines.map(([label, value]) => `${label.padEnd(9)} ${value}`).join('\n');
}
