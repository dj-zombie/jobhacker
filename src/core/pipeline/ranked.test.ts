import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import type { Dimension } from '../config/schemas.js';
import { type Db, createMigratedTestDb } from '../db/client.js';
import { scoresRepo } from '../db/repo/scores.js';
import { type GateResult, type JobStatus, jobScores, jobs } from '../db/schema.js';
import { TEST_PREFERENCES, scoreOutput, seedJobs, testCriteria } from '../testing/fixtures.js';
import { type Clock, fixedClock } from '../util/clock.js';
import { computeFunnel, renderFunnel } from './funnel.js';
import { applyGates } from './gate.js';
import { applyPrescores } from './prescore.js';
import { rankedList } from './ranked.js';
import { reconcilePlacement } from './reconcile.js';
import type { ScoringKey } from './score.js';
import { explainJob, renderWhy } from './why.js';

const NOW = '2026-10-23T12:00:00.000Z';
const CURRENT: ScoringKey = {
  rubricVersion: 'r2',
  model: 'm',
  profileHash: 'p',
  preferencesHash: 'q',
};
const CRITERIA = testCriteria();
const RANKING = { weights: CRITERIA.weights, bands: CRITERIA.bands, current: CURRENT };

let sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'];

afterEach(() => {
  sqlite?.close();
});

interface Seed {
  title: string;
  status?: JobStatus;
  closed?: boolean;
  duplicateOf?: number;
  postedAt?: string;
  /** Every dimension at this value (score = fill × 20), or explicit dims. */
  fill?: number;
  dims?: Partial<Record<Dimension, number | null>>;
  key?: Partial<ScoringKey>;
  scoreForOtherText?: boolean;
  v1Only?: boolean;
}

function setup(seeds: Seed[]): { db: Db; clock: Clock; ids: number[] } {
  const made = createMigratedTestDb();
  sqlite = made.sqlite;
  const db = made.db;
  const clock = fixedClock(NOW);
  const ids = seedJobs(
    db,
    clock,
    seeds.map((s) => ({ title: s.title, postedAt: s.postedAt ?? '2026-10-20T00:00:00.000Z' })),
  );
  const scores = scoresRepo(db, clock);
  seeds.forEach((seed, i) => {
    const id = ids[i] ?? 0;
    const gateResult: GateResult | null =
      seed.status === 'filtered_out'
        ? null
        : seed.closed
          ? { passed: false, gate: 'closed', detail: 'closed' }
          : seed.duplicateOf != null
            ? { passed: false, gate: 'duplicate', detail: 'duplicate' }
            : { passed: true, gate: null, detail: null };
    db.update(jobs)
      .set({
        status: seed.status ?? 'scored',
        closedAt: seed.closed ? '2026-10-22T00:00:00.000Z' : null,
        duplicateOf: seed.duplicateOf ?? null,
        gateResult,
        scoreState: seed.fill !== undefined || seed.dims ? 'current' : 'pending',
      })
      .where(eq(jobs.id, id))
      .run();
    const contentHash = seed.scoreForOtherText
      ? 'older-text'
      : (db.select().from(jobs).where(eq(jobs.id, id)).get()?.contentHash ?? '');
    if (seed.v1Only) {
      db.insert(jobScores)
        .values({
          jobId: id,
          contentHash,
          rubricVersion: 'v1',
          model: 'm',
          score: 90,
          verdict: 'strong',
          createdAt: NOW,
        })
        .run();
    } else if (seed.fill !== undefined || seed.dims) {
      scores.insert({
        jobId: id,
        contentHash,
        ...CURRENT,
        ...seed.key,
        dimensions: scoreOutput(seed.dims ?? {}, seed.fill ?? 3).dimensions,
        summary: `${seed.title} summary`,
        redFlags: [],
        score: 0,
        verdict: 'no',
      });
    }
  });
  return { db, clock, ids };
}

const QUEUE: Seed[] = [
  { title: 'Senior Frontend Engineer', fill: 5 },
  { title: 'Engineer II', fill: 3 },
  { title: 'Lead Engineer', fill: 4, status: 'shortlisted' },
  { title: 'Backend Engineer', fill: 1 },
  { title: 'Closed', fill: 5, closed: true },
  { title: 'Dup', fill: 5, duplicateOf: 1 },
  { title: 'Gated', fill: 5, status: 'filtered_out' },
  { title: 'Older text', fill: 5, scoreForOtherText: true },
  { title: 'Only v1', v1Only: true },
  { title: 'Never scored', status: 'unscored' },
  { title: 'Stale key', fill: 2, key: { preferencesHash: 'old' } },
];

describe('rankedList', () => {
  it('ranks visible jobs with a current-text dimension score by the live weights', () => {
    const { db, clock } = setup(QUEUE);
    const rows = rankedList(db, clock, RANKING);
    expect(rows.map((r) => [r.title, r.score, r.verdict])).toEqual([
      ['Senior Frontend Engineer', 100, 'strong'],
      ['Lead Engineer', 80, 'strong'],
      ['Engineer II', 60, 'maybe'],
      ['Stale key', 40, 'no'],
      ['Backend Engineer', 20, 'no'],
    ]);
    expect(rows.find((r) => r.title === 'Lead Engineer')?.status).toBe('shortlisted');
    expect(rows.filter((r) => r.stale).map((r) => r.title)).toEqual(['Stale key']);
  });

  it('filters by verdict, status, company and recency, and limits', () => {
    const { db, clock } = setup(QUEUE);
    expect(rankedList(db, clock, RANKING, { verdict: 'strong' }).map((r) => r.title)).toEqual([
      'Senior Frontend Engineer',
      'Lead Engineer',
    ]);
    expect(
      rankedList(db, clock, RANKING, { statuses: ['shortlisted'] }).map((r) => r.title),
    ).toEqual(['Lead Engineer']);
    expect(rankedList(db, clock, RANKING, { company: 'Nobody' })).toEqual([]);
    expect(rankedList(db, clock, RANKING, { limit: 2 })).toHaveLength(2);
  });

  it('filters by recency (sinceDays)', () => {
    const { db, clock } = setup([
      { title: 'Fresh', fill: 4, postedAt: '2026-10-21T00:00:00.000Z' },
      { title: 'Old', fill: 4, postedAt: '2026-09-01T00:00:00.000Z' },
    ]);
    expect(rankedList(db, clock, RANKING, { sinceDays: 7 }).map((r) => r.title)).toEqual(['Fresh']);
  });

  it('filters by when a scout first saw the job (seenWithinHours)', () => {
    const { db, clock, ids } = setup([
      { title: 'Seen today', fill: 4 },
      { title: 'Seen two days ago', fill: 4 },
    ]);
    db.update(jobs)
      .set({ firstSeenAt: '2026-10-21T12:00:00.000Z' })
      .where(eq(jobs.id, ids[1] ?? 0))
      .run();
    expect(rankedList(db, clock, RANKING, { seenWithinHours: 24 }).map((r) => r.title)).toEqual([
      'Seen today',
    ]);
  });

  it('keeps a human triage status but excludes the job when its stored gate fails', () => {
    const { db, clock, ids } = setup([
      { title: 'Old shortlisted job', fill: 5, status: 'shortlisted' },
    ]);
    db.update(jobs)
      .set({
        gateResult: { passed: false, gate: 'age', detail: 'too old' },
      })
      .where(eq(jobs.id, ids[0] ?? 0))
      .run();
    expect(rankedList(db, clock, RANKING)).toEqual([]);
    expect(db.select().from(jobs).get()?.status).toBe('shortlisted');
  });

  it('reconciles an edited age gate before queue/funnel reads', () => {
    const { db, clock } = setup([
      { title: 'Old job', fill: 5, postedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    expect(rankedList(db, clock, RANKING)).toHaveLength(1);

    const criteria = testCriteria({ maxAgeDays: 30 });
    reconcilePlacement(db, criteria, TEST_PREFERENCES, clock);

    expect(rankedList(db, clock, { ...RANKING, bands: criteria.bands })).toEqual([]);
    const funnel = computeFunnel(db, clock, criteria, CURRENT);
    expect(funnel.gated.age).toBe(1);
    expect(funnel.passed).toBe(0);
  });

  it('puts every visible job without a current dimension score in the unscored list', () => {
    const { db, clock } = setup(QUEUE);
    const unscored = scoresRepo(db, clock).unscoredRows();
    expect(unscored.map((r) => r.title).sort()).toEqual(['Never scored', 'Older text', 'Only v1']);
  });

  it('uses only the latest dimension row per job', () => {
    const { db, clock, ids } = setup([{ title: 'Engineer', fill: 1 }]);
    const hash = db.select().from(jobs).get()?.contentHash ?? '';
    scoresRepo(db, clock).insert({
      jobId: ids[0] ?? 0,
      contentHash: hash,
      ...CURRENT,
      rubricVersion: 'r3',
      dimensions: scoreOutput({}, 5).dimensions,
      summary: 's',
      redFlags: [],
      score: 100,
      verdict: 'strong',
    });
    const rows = rankedList(db, clock, RANKING);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.score).toBe(100);
    expect(scoresRepo(db, clock).queueCompanies()).toEqual(['Acme']);
  });
});

describe('computeFunnel', () => {
  it('accounts for every job exactly once', () => {
    const { db, clock } = setup(QUEUE);
    const f = computeFunnel(db, clock, CRITERIA, CURRENT);
    expect(f.total).toBe(QUEUE.length);
    expect(f.gated).toEqual({ closed: 1, duplicate: 1, blocklist: 0, age: 0 });
    expect(f.notYetGated).toBe(1); // 'Gated' has status filtered_out but no gate_result yet
    expect(f.passed).toBe(8);
    expect(f.gatedTotal + f.notYetGated + f.passed).toBe(f.total);
    expect(f.scored).toMatchObject({
      total: 5,
      current: 4,
      stale: 1,
      bands: { strong: 2, maybe: 1, no: 2 },
    });
    expect(f.unscored.total).toBe(3);
    expect(f.scored.total + f.unscored.total).toBe(f.passed);
    expect(f.triage.shortlisted).toBe(1);
    expect(renderFunnel(f)).toContain('passed the gates');
  });

  it('counts the gate a job failed once gates have run', () => {
    const { db, clock } = setup([
      { title: 'Senior Frontend Engineer', fill: 5 },
      { title: 'Ancient', fill: 5, postedAt: '2025-01-01T00:00:00.000Z' },
    ]);
    const criteria = testCriteria({ maxAgeDays: 60 });
    applyGates(db, criteria.gates, clock.nowMs());
    const f = computeFunnel(db, clock, criteria, CURRENT);
    expect(f.gated.age).toBe(1);
    expect(f.passed).toBe(1);
    expect(f.ageOfPassed.find((b) => b.label === '≤7d')?.count).toBe(1);
  });

  it('splits unscored by exact persisted state', () => {
    const { db, clock } = setup([
      { title: 'Senior Frontend Engineer', status: 'unscored' },
      { title: 'Account Executive', status: 'unscored' },
    ]);
    applyPrescores(db, TEST_PREFERENCES);
    const [first, second] = db.select().from(jobs).all();
    if (first) db.update(jobs).set({ scoreState: 'run_cap' }).where(eq(jobs.id, first.id)).run();
    if (second)
      db.update(jobs).set({ scoreState: 'llm_error' }).where(eq(jobs.id, second.id)).run();
    const f = computeFunnel(db, clock, testCriteria(), CURRENT);
    expect(f.prescored).toBe(2);
    expect(f.unscored).toEqual({
      total: 2,
      byState: {
        pending: 0,
        current: 0,
        stale: 0,
        run_cap: 1,
        llm_error: 1,
      },
    });
  });
});

describe('explainJob', () => {
  it('explains a ranked job: gate, prescore, six weighted dimensions and the live score', () => {
    const { db, clock, ids } = setup([
      { title: 'Senior Frontend Engineer', dims: { role_fit: 5, comp_fit: null }, fill: 4 },
    ]);
    applyGates(db, CRITERIA.gates, clock.nowMs());
    applyPrescores(db, TEST_PREFERENCES);
    const r = explainJob(db, clock, ids[0] ?? 0, {
      criteria: CRITERIA,
      current: CURRENT,
      preferences: TEST_PREFERENCES,
    });
    expect(r?.placement).toBe('ranked');
    expect(r?.gate).toEqual({ passed: true, gate: null, detail: null });
    expect(r?.prescore.breakdown?.titleMatches.length).toBeGreaterThan(0);
    expect(r?.score?.dimensions).toHaveLength(6);
    // (3·5 + 2·4 + 2·4 + 2·4 + 4·4) / 13 × 20 = 55/13 × 20 = 84.6
    expect(r?.score).toMatchObject({
      baseScore: 85,
      score: 85,
      verdict: 'strong',
      knownWeight: 13,
      stale: false,
      cap: null,
    });
    const text = renderWhy(r ?? never());
    expect(text).toContain('role_fit');
    expect(text).toContain('comp_fit because');
    expect(text).toContain('passed all four gates');
  });

  it('explains a critical-dimension cap without hiding the job', () => {
    const { db, clock, ids } = setup([{ title: 'Sales Director', dims: { role_fit: 0 }, fill: 5 }]);
    const report = explainJob(db, clock, ids[0] ?? 0, {
      criteria: CRITERIA,
      current: CURRENT,
    });
    expect(report?.placement).toBe('ranked');
    expect(report?.score).toMatchObject({
      baseScore: 79,
      score: 54,
      verdict: 'no',
      cap: { level: 0, dimensions: ['role_fit'], maxScore: 54 },
    });
    expect(renderWhy(report ?? never())).toContain('critical role_fit = 0');
  });

  it('explains an exact unscored state and a v1-only score', () => {
    const { db, clock, ids } = setup([
      { title: 'Account Executive', status: 'unscored' },
      { title: 'Only v1', v1Only: true },
    ]);
    applyPrescores(db, TEST_PREFERENCES);
    db.update(jobs)
      .set({ scoreState: 'run_cap' })
      .where(eq(jobs.id, ids[0] ?? 0))
      .run();
    const criteria = testCriteria();
    const low = explainJob(db, clock, ids[0] ?? 0, { criteria });
    expect(low?.placement).toBe('unscored');
    expect(low?.scoreState).toBe('run_cap');
    expect(renderWhy(low ?? never())).toContain('deferred by the per-run cap');
    const v1 = explainJob(db, clock, ids[1] ?? 0, { criteria });
    expect(v1?.legacyScore).toEqual({ score: 90, verdict: 'strong' });
    expect(renderWhy(v1 ?? never())).toContain('v1 score 90');
  });

  it('returns undefined for a missing job', () => {
    const { db, clock } = setup([]);
    expect(explainJob(db, clock, 999, { criteria: CRITERIA })).toBeUndefined();
  });
});

function never(): never {
  throw new Error('unexpected undefined');
}
