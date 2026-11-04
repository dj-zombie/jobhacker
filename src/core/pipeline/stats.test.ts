import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import type { Criteria } from '../config/schemas.js';
import { type Db, createDb, migrateDb, openDbReadonly } from '../db/client.js';
import { applicationsRepo } from '../db/repo/applications.js';
import { companiesRepo } from '../db/repo/companies.js';
import { eventsRepo } from '../db/repo/events.js';
import { scoresRepo } from '../db/repo/scores.js';
import { type GateResult, jobs, runs } from '../db/schema.js';
import { chargeCall } from '../sources/budget.js';
import { scoreOutput, seedJobs, testCriteria } from '../testing/fixtures.js';
import { type Clock, fixedClock } from '../util/clock.js';
import { applyAreas } from './areas.js';
import { rankedList } from './ranked.js';
import { triageJob } from './review.js';
import type { ScoringKey } from './score.js';
import { computeStats, renderStats } from './stats.js';

const NOW = '2026-10-23T12:00:00.000Z';
const CURRENT: ScoringKey = {
  rubricVersion: 'r2',
  model: 'm',
  profileHash: 'p',
  preferencesHash: 'q',
};
const PASSED: GateResult = { passed: true, gate: null, detail: null };

const CRITERIA: Criteria = {
  ...testCriteria(),
  sources: {
    boards: { enabled: ['greenhouse', 'ashby'] },
    search: {
      jsearch: { enabled: true, monthly_call_budget: 200 },
      jobspipe: { enabled: false, monthly_call_budget: 0, monthly_credit_budget: 0 },
      hn: { enabled: true, monthly_call_budget: 100 },
    },
    workday: { enabled: false },
  },
};

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

/** Score a seeded job under `key`, with every dimension at `fill`. */
function score(db: Db, clock: Clock, jobId: number, fill: number, key: ScoringKey = CURRENT): void {
  const contentHash = db.select().from(jobs).where(eq(jobs.id, jobId)).get()?.contentHash ?? '';
  db.update(jobs)
    .set({ status: 'scored', gateResult: PASSED, scoreState: 'current' })
    .where(eq(jobs.id, jobId))
    .run();
  scoresRepo(db, clock).insert({
    jobId,
    contentHash,
    ...key,
    dimensions: scoreOutput({}, fill).dimensions,
    summary: 'summary',
    redFlags: [],
    score: 0,
    verdict: 'no',
  });
}

/** A file database with a few rows of everything the snapshot reads. Returns its path. */
function seedDatabase(): string {
  dir = mkdtempSync(join(tmpdir(), 'jobhacker-stats-'));
  const path = join(dir, 'stats.db');
  const { db, sqlite } = createDb(path);
  migrateDb(db);
  const clock = fixedClock(NOW);

  const [strong, maybe, weak, stale, pending, closed, dupe, fromSearch] = seedJobs(db, clock, [
    { title: 'Strong' },
    { title: 'Maybe' },
    { title: 'Weak' },
    { title: 'Stale' },
    { title: 'Pending' },
    { title: 'Closed' },
    { title: 'Dupe' },
    { title: 'From search', sourceKind: 'search', sourceName: 'hn', sourceQuality: 'low' },
  ]) as [number, number, number, number, number, number, number, number];
  score(db, clock, strong, 5);
  score(db, clock, maybe, 3);
  score(db, clock, weak, 2);
  score(db, clock, stale, 4, { ...CURRENT, model: 'older-model' });
  for (const id of [pending, fromSearch]) {
    db.update(jobs)
      .set({ status: 'unscored', gateResult: PASSED, scoreState: 'pending' })
      .where(eq(jobs.id, id))
      .run();
  }
  db.update(jobs)
    .set({
      closedAt: '2026-10-22T00:00:00.000Z',
      gateResult: { passed: false, gate: 'closed', detail: 'closed' },
    })
    .where(eq(jobs.id, closed))
    .run();
  db.update(jobs)
    .set({ duplicateOf: strong, gateResult: { passed: false, gate: 'duplicate', detail: 'dup' } })
    .where(eq(jobs.id, dupe))
    .run();
  db.update(jobs).set({ firstSeenAt: '2026-10-20T00:00:00.000Z' }).where(eq(jobs.id, weak)).run();

  const companyRepo = companiesRepo(db, clock);
  companyRepo.upsert({ name: 'Beta', ats: 'ashby', token: 'beta', active: true, tags: [] });
  companyRepo.upsert({ name: 'Gone', ats: 'lever', token: 'gone', active: false, tags: [] });
  companyRepo.upsert({ name: 'From HN', ats: 'hn', token: 'from-hn', active: true, tags: [] });

  db.insert(runs)
    .values({
      kind: 'scout',
      startedAt: '2026-10-23T10:00:00.000Z',
      finishedAt: '2026-10-23T10:01:30.000Z',
      ok: true,
      stats: { boards_ok: 2, boards_failed: 1, errors: [{ message: 'boom' }] },
    })
    .run();

  const apps = applicationsRepo(db, clock);
  const ev = eventsRepo(db, clock);
  apps.upsertForJob({ jobId: strong, fillReport: { filled: [] } });
  clock.set('2026-10-23T09:00:00.000Z');
  triageJob(db, clock, { jobId: maybe, action: 'shortlist' });
  triageJob(db, clock, { jobId: weak, action: 'shortlist' });
  // Moved to submitted and back to prepped before the fix: a stamp on a prepped application isn't a submission.
  apps.upsertForJob({ jobId: weak, status: 'prepped', submittedAt: '2026-10-23T09:05:00.000Z' });
  clock.set(NOW);
  apps.upsertForJob({
    jobId: maybe,
    status: 'submitted',
    submittedAt: '2026-10-23T09:45:00.000Z',
    followUpAt: '2026-10-23T11:00:00.000Z',
  });

  ev.append({
    type: 'fill',
    jobId: strong,
    payload: {
      ats: 'greenhouse',
      filled: 3,
      drafted: 0,
      unfilled: 1,
      unfilled_required: 0,
      skipped_eeo: 0,
    },
  });
  ev.append({
    type: 'fill',
    jobId: strong,
    payload: {
      ats: 'ashby',
      filled: 6,
      drafted: 1,
      unfilled: 1,
      unfilled_required: 1,
      skipped_eeo: 1,
      self_identification: 2,
    },
  });
  ev.append({
    type: 'llm_usage',
    payload: { model: 'claude-haiku-5-5', input_tokens: 1000, output_tokens: 100, calls: 2 },
  });
  ev.append({
    type: 'llm_usage',
    payload: { model: 'claude-haiku-5-5', input_tokens: 1000, output_tokens: 100 },
  });
  chargeCall(db, 'jsearch', NOW, 200, 0);
  chargeCall(db, 'jsearch', NOW, 200, 0);

  sqlite.close();
  return path;
}

describe('usefulness stats', () => {
  it('reports every snapshot line from a seeded database, read-only', () => {
    const path = seedDatabase();
    const { db, sqlite } = openDbReadonly(path);
    try {
      const stats = computeStats({
        db,
        clock: fixedClock(NOW),
        criteria: CRITERIA,
        current: CURRENT,
      });

      expect(stats.jobs).toEqual({
        total: 8,
        passed: 6,
        gated: { closed: 1, duplicate: 1, blocklist: 0, age: 0 },
        notYetGated: 0,
      });
      expect(stats.boards).toEqual({
        active: 2,
        byAts: [
          { ats: 'ashby', count: 1 },
          { ats: 'greenhouse', count: 1 },
        ],
      });
      expect(stats.scout).toEqual({
        startedAt: '2026-10-23T10:00:00.000Z',
        seconds: 90,
        boardsOk: 2,
        boardsFailed: 1,
        errors: 1,
      });
      expect(stats.newLastDay).toBe(7);
      expect(stats.searchOnly).toEqual({ total: 1, bySource: [{ source: 'hn', count: 1 }] });
      expect(stats.scored).toEqual({ current: 3, stale: 1, unscored: 2 });
      expect(stats.matches).toEqual({ strong: 2, maybe: 1, weak: 1 });
      expect(stats.apply).toEqual({ prepared: 3, filled: 1, submitted: 1, followUpsDue: 1 });
      expect(stats.fill).toEqual({
        reports: 2,
        byAts: [
          { ats: 'ashby', forms: 1, filled: 8, fields: 10 },
          { ats: 'greenhouse', forms: 1, filled: 3, fields: 4 },
        ],
        needReview: 1,
        blank: 3,
        selfIdSet: 2,
        selfIdUnrecorded: 1,
      });
      expect(stats.time).toEqual({ medianMinutes: 45, measured: 1, submissions: 1 });
      expect(stats.spend).toMatchObject({ month: '2026-10', modelCalls: 3 });
      expect(stats.spend.sources).toEqual([
        { name: 'jsearch', enabled: true, calls: 2, budget: 200 },
        { name: 'jobspipe', enabled: false, calls: 0, budget: 0, credits: 0, creditBudget: 0 },
        { name: 'hn', enabled: true, calls: 0, budget: 100 },
      ]);

      const text = renderStats(stats);
      const labels = text
        .split('\n')
        .filter((l) => !l.startsWith(' '))
        .map((l) => l.slice(0, 9).trim());
      expect(labels).toEqual([
        'jobs',
        'boards',
        'scout',
        'new',
        'search',
        'links',
        'scored',
        'matches',
        'where',
        'in where',
        'logos',
        'apply',
        'fill',
        'time',
        'spend',
      ]);
      expect(text).toContain('where     not set up');
      expect(text).toContain('in where  not set up');
      expect(text).toContain('links     not read');
      expect(text).toContain('ashby 80% filled over 1 form');
      expect(text).toContain('(1 of 2 reports predate the self-ID count)');
      expect(text).toContain('jsearch 2/200 calls · jobspipe off · hn 0/100 calls');

      expect(() => sqlite.prepare('delete from jobs').run()).toThrow(/readonly/i);
    } finally {
      sqlite.close();
    }
  });

  it('counts linked boards companies.yaml does not list, and unreadable links by ATS', () => {
    const path = seedDatabase();
    const writable = createDb(path);
    writable.db
      .update(jobs)
      .set({
        url: 'https://jobs.ashbyhq.com/beta/123',
        descriptionText: [
          'Apply at https://jobs.ashbyhq.com/newco/9a8b or https://job-boards.greenhouse.io/missed/jobs/1.',
          'Also https://boards.greenhouse.io/emptyco and https://jobs.lever.co/off-ats.',
          'Old link: https://apply.workable.com/acme-w/j/ABC and https://acme.wd1.myworkdayjobs.com/x',
        ].join('\n'),
      })
      .where(eq(jobs.title, 'From search'))
      .run();
    writable.sqlite.close();

    const { db, sqlite } = openDbReadonly(path);
    try {
      const stats = computeStats({
        db,
        clock: fixedClock(NOW),
        criteria: CRITERIA,
        current: CURRENT,
        links: {
          listed: [{ ats: 'ashby', token: 'beta' }],
          cache: { 'greenhouse:missed': 'miss', 'greenhouse:emptyco': 'empty' },
        },
      });
      // lever is not enabled in CRITERIA, so its link is not counted.
      expect(stats.links).toEqual({
        unlisted: 3,
        toProbe: 1,
        missed: 1,
        empty: 1,
        unreadable: [
          { ats: 'workable', count: 1 },
          { ats: 'workday', count: 1 },
        ],
      });
      expect(renderStats(stats)).toContain(
        'links     3 boards linked from search hits not in companies.yaml: 1 to probe · 1 missed · 1 empty · unreadable: workable 1 · workday 1',
      );
    } finally {
      sqlite.close();
    }
  });

  it('counts open jobs per place, and matches within where_default', () => {
    const path = seedDatabase();
    const criteria: Criteria = { ...CRITERIA, ...testCriteria({ withPlaces: true }) };
    const writable = createDb(path);
    writable.db
      .update(jobs)
      .set({ locationRaw: 'Portland, OR', remoteType: 'onsite' })
      .where(eq(jobs.title, 'Strong'))
      .run();
    writable.db
      .update(jobs)
      .set({ locationRaw: 'Toronto, ON', remoteType: 'onsite' })
      .where(eq(jobs.title, 'Maybe'))
      .run();
    applyAreas(writable.db, criteria);
    writable.sqlite.close();

    const { db, sqlite } = openDbReadonly(path);
    try {
      const stats = computeStats({ db, clock: fixedClock(NOW), criteria, current: CURRENT });
      const visible = stats.jobs.passed;
      expect(stats.where).toEqual({
        byArea: [
          { area: 'portland', count: 1 },
          { area: 'phoenix', count: 0 },
          { area: 'remote', count: visible - 2 },
        ],
        elsewhere: 1,
      });
      // The Maybe job is in Toronto: a match, but not within where_default.
      expect(stats.inWhere).toEqual({
        areas: ['portland', 'phoenix', 'remote'],
        strong: stats.matches.strong,
        maybe: stats.matches.maybe - 1,
      });
      const text = renderStats(stats);
      expect(text).toContain(
        `where     1 portland · 0 phoenix · ${visible - 2} remote · 1 elsewhere (open, past the gates)`,
      );
      expect(text).toContain('in where  2 strong · 0 maybe in portland, phoenix, remote');

      // Anywhere lists the Toronto job too, with no areas rather than null.
      const anywhere = rankedList(db, fixedClock(NOW), {
        weights: criteria.weights,
        bands: criteria.bands,
        current: CURRENT,
      });
      expect(anywhere.find((row) => row.title === 'Strong')?.areas).toEqual(['portland']);
      expect(anywhere.find((row) => row.title === 'Maybe')?.areas).toEqual([]);
    } finally {
      sqlite.close();
    }
  });

  it('prints placeholders on an empty database', () => {
    dir = mkdtempSync(join(tmpdir(), 'jobhacker-stats-'));
    const path = join(dir, 'empty.db');
    const made = createDb(path);
    migrateDb(made.db);
    made.sqlite.close();
    const { db, sqlite } = openDbReadonly(path);
    try {
      const text = renderStats(
        computeStats({ db, clock: fixedClock(NOW), criteria: testCriteria() }),
      );
      expect(text).toContain('scout     never run');
      expect(text).toContain('fill      no fill reports yet');
      expect(text).toContain('time      no shortlisted → submitted times yet (0 submitted)');
      expect(text).toContain('jsearch off · jobspipe off · hn off');
    } finally {
      sqlite.close();
    }
  });
});
