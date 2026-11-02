import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { type Db, createMigratedTestDb } from '../db/client.js';
import { companiesRepo } from '../db/repo/companies.js';
import { jobsRepo } from '../db/repo/jobs.js';
import { jobs } from '../db/schema.js';
import { testCriteria } from '../testing/fixtures.js';
import { fixedClock } from '../util/clock.js';
import { type GateableJob, applyGates, gateJob } from './gate.js';

const NOW = Date.parse('2026-10-23T12:00:00.000Z');

function job(overrides: Partial<GateableJob> = {}): GateableJob {
  return {
    closedAt: null,
    duplicateOf: null,
    companyName: 'Acme',
    postedAt: '2026-10-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('gateJob', () => {
  const cases: Array<{
    name: string;
    job: GateableJob;
    gates: ReturnType<typeof testCriteria>['gates'];
    gate: string | null;
  }> = [
    { name: 'open recent job passes', job: job(), gates: testCriteria().gates, gate: null },
    {
      name: 'closed job is gated first',
      job: job({ closedAt: '2026-10-21T00:00:00.000Z', duplicateOf: 3 }),
      gates: testCriteria().gates,
      gate: 'closed',
    },
    {
      name: 'duplicate is gated',
      job: job({ duplicateOf: 7 }),
      gates: testCriteria().gates,
      gate: 'duplicate',
    },
    {
      name: 'blocklist is exact and case-insensitive',
      job: job({ companyName: 'ACME ' }),
      gates: testCriteria({ blocklist: ['acme'] }).gates,
      gate: 'blocklist',
    },
    {
      name: 'blocklist does not substring-match',
      job: job({ companyName: 'Acme Labs' }),
      gates: testCriteria({ blocklist: ['acme'] }).gates,
      gate: null,
    },
    {
      name: 'older than max_age_days is gated',
      job: job({ postedAt: '2026-09-01T00:00:00.000Z' }),
      gates: testCriteria({ maxAgeDays: 21 }).gates,
      gate: 'age',
    },
    {
      name: 'exactly max_age_days old passes',
      job: job({ postedAt: '2026-10-02T12:00:00.000Z' }),
      gates: testCriteria({ maxAgeDays: 21 }).gates,
      gate: null,
    },
    {
      name: 'max_age_days 0 turns the age gate off',
      job: job({ postedAt: '2021-01-01T00:00:00.000Z' }),
      gates: testCriteria({ maxAgeDays: 0 }).gates,
      gate: null,
    },
    {
      name: 'unknown posted date passes the age gate',
      job: job({ postedAt: null }),
      gates: testCriteria({ maxAgeDays: 21 }).gates,
      gate: null,
    },
    {
      name: 'unparseable posted date passes the age gate',
      job: job({ postedAt: 'soon' }),
      gates: testCriteria({ maxAgeDays: 21 }).gates,
      gate: null,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const result = gateJob(c.job, c.gates, NOW);
      expect(result.gate).toBe(c.gate);
      expect(result.passed).toBe(c.gate === null);
      if (c.gate) expect(result.detail).toBeTruthy();
    });
  }
});

let sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'];
afterEach(() => sqlite?.close());

function setup(): { db: Db; add: (postedAt: string | null) => number } {
  const made = createMigratedTestDb();
  sqlite = made.sqlite;
  const db = made.db;
  const clock = fixedClock(NOW);
  const companyId = companiesRepo(db, clock).upsert({
    name: 'Acme',
    ats: 'greenhouse',
    token: 'acme',
    active: true,
    tags: [],
  }).id;
  const repo = jobsRepo(db);
  let n = 0;
  const add = (postedAt: string | null): number => {
    n += 1;
    repo.upsert(
      {
        companyId,
        ats: 'greenhouse',
        externalId: `job-${n}`,
        title: `Engineer ${n}`,
        locationRaw: 'Remote, US',
        remoteType: 'remote',
        employmentType: 'full_time',
        url: `https://example.com/${n}`,
        applyUrl: null,
        descriptionText: 'Build things.',
        compMin: null,
        compMax: null,
        compCurrency: null,
        postedAt,
        contentHash: `hash-${n}`,
        dedupeKey: `dk-${n}`,
      },
      new Date(NOW).toISOString(),
    );
    return repo.find('greenhouse', `job-${n}`)?.id ?? 0;
  };
  return { db, add };
}

function row(db: Db, id: number) {
  return db.select().from(jobs).where(eq(jobs.id, id)).get();
}

describe('applyGates', () => {
  it('stores a gate result on every job, including closed and duplicate ones', () => {
    const { db, add } = setup();
    const open = add('2026-10-20T00:00:00.000Z');
    const closed = add('2026-10-20T00:00:00.000Z');
    const dup = add('2026-10-20T00:00:00.000Z');
    db.update(jobs).set({ closedAt: '2026-10-22T00:00:00.000Z' }).where(eq(jobs.id, closed)).run();
    db.update(jobs).set({ duplicateOf: open }).where(eq(jobs.id, dup)).run();

    const stats = applyGates(db, testCriteria().gates, NOW);
    expect(stats.checked).toBe(3);
    expect(stats.passed).toBe(1);
    expect(stats.gated).toMatchObject({ closed: 1, duplicate: 1, blocklist: 0, age: 0 });
    expect(row(db, open)?.gateResult).toEqual({ passed: true, gate: null, detail: null });
    expect(row(db, closed)?.gateResult?.gate).toBe('closed');
    expect(row(db, dup)?.gateResult?.gate).toBe('duplicate');
  });

  it('gates an old job, then re-surfaces it when the gate is widened (no re-scout)', () => {
    const { db, add } = setup();
    const old = add('2026-06-01T00:00:00.000Z');

    const narrow = applyGates(db, testCriteria({ maxAgeDays: 21 }).gates, NOW);
    expect(narrow.newly_gated).toBe(1);
    expect(row(db, old)?.status).toBe('filtered_out');
    expect(row(db, old)?.gateResult?.gate).toBe('age');

    const wide = applyGates(db, testCriteria({ maxAgeDays: 0 }).gates, NOW);
    expect(wide.resurfaced).toBe(1);
    expect(row(db, old)?.status).toBe('new');
    expect(row(db, old)?.gateResult?.passed).toBe(true);
  });

  it('re-opens v1 keyword-filtered jobs and clears their stale filter_reason', () => {
    const { db, add } = setup();
    const id = add('2026-10-20T00:00:00.000Z');
    db.update(jobs)
      .set({ status: 'filtered_out', filterReason: 'title matches no include keyword' })
      .where(eq(jobs.id, id))
      .run();

    const stats = applyGates(db, testCriteria().gates, NOW);
    expect(stats.resurfaced).toBe(1);
    expect(row(db, id)?.status).toBe('new');
    expect(row(db, id)?.filterReason).toBeNull();
  });

  it('is idempotent and never changes human triage states', () => {
    const { db, add } = setup();
    const shortlisted = add('2026-01-01T00:00:00.000Z');
    const scored = add('2026-10-20T00:00:00.000Z');
    db.update(jobs).set({ status: 'shortlisted' }).where(eq(jobs.id, shortlisted)).run();
    db.update(jobs).set({ status: 'scored' }).where(eq(jobs.id, scored)).run();

    const gates = testCriteria({ maxAgeDays: 21 }).gates;
    const first = applyGates(db, gates, NOW);
    const second = applyGates(db, gates, NOW);
    expect(first.newly_gated).toBe(0);
    expect(second).toEqual(first);
    // The shortlisted job is past the age gate: its result says so, its status is his.
    expect(row(db, shortlisted)?.status).toBe('shortlisted');
    expect(row(db, shortlisted)?.gateResult?.gate).toBe('age');
    expect(row(db, scored)?.status).toBe('scored');
  });
});
