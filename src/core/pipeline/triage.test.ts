import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { type Db, createMigratedTestDb } from '../db/client.js';
import { applicationsRepo } from '../db/repo/applications.js';
import { areasRepo } from '../db/repo/areas.js';
import { scoresRepo } from '../db/repo/scores.js';
import { type JobStatus, jobs } from '../db/schema.js';
import {
  TEST_PREFERENCES,
  scoreOutput,
  seedJobs,
  testCriteria,
  testProfile,
} from '../testing/fixtures.js';
import { type Clock, fixedClock } from '../util/clock.js';
import { computeFunnel, renderFunnel } from './funnel.js';
import { type ScoringKey, scoringInputs } from './score.js';
import { TRIAGE_VIEWS, type TriageView, inWhere } from './triage-view.js';
import { scoringSummary, triageCounts, triageDetail, triageRowFor, triageRows } from './triage.js';

const NOW = '2026-10-25T12:00:00.000Z';
const PASSED = { passed: true, gate: null, detail: null };

let sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'];

afterEach(() => {
  sqlite?.close();
});

interface Seed {
  title: string;
  status: JobStatus;
  /** `current` scores under today's key, `stale` under an older profile. */
  score?: { kind: 'current' | 'stale'; fill: number };
  areas?: string[];
  firstSeenAt?: string;
  duplicate?: boolean;
  application?: boolean;
}

function setup(seeds: Seed[]): { db: Db; clock: Clock; key: ScoringKey; ids: number[] } {
  const made = createMigratedTestDb();
  sqlite = made.sqlite;
  const db = made.db;
  const clock = fixedClock(NOW);
  const key = scoringInputs(testCriteria(), testProfile(), TEST_PREFERENCES).key;
  const ids = seedJobs(
    db,
    clock,
    seeds.map((s) => ({ title: s.title })),
  );
  const scores = scoresRepo(db, clock);
  seeds.forEach((seed, i) => {
    const id = ids[i] ?? 0;
    db.update(jobs)
      .set({
        status: seed.status,
        gateResult: seed.duplicate ? { passed: false, gate: 'duplicate', detail: 'dup' } : PASSED,
        duplicateOf: seed.duplicate ? (ids[0] ?? null) : null,
        scoreState: seed.score?.kind === 'current' ? 'current' : 'run_cap',
        ...(seed.firstSeenAt ? { firstSeenAt: seed.firstSeenAt } : {}),
      })
      .where(eq(jobs.id, id))
      .run();
    if (seed.score) {
      const output = scoreOutput({}, seed.score.fill);
      scores.insert({
        jobId: id,
        contentHash: `hash-Acme-${i}`,
        ...key,
        ...(seed.score.kind === 'stale' ? { profileHash: 'an-older-profile' } : {}),
        dimensions: output.dimensions,
        summary: 'A test job.',
        score: seed.score.fill * 20,
        verdict: seed.score.fill >= 4 ? 'strong' : 'no',
        redFlags: [],
      });
    }
    if (seed.application) applicationsRepo(db, clock).upsertForJob({ jobId: id });
  });
  areasRepo(db).replace(seeds.map((s, i) => ({ jobId: ids[i] ?? 0, areas: s.areas ?? [] })));
  return { db, clock, key, ids };
}

const TWO_DAYS_AGO = '2026-10-23T12:00:00.000Z';

const SEEDS: Seed[] = [
  {
    title: 'A scored today',
    status: 'scored',
    score: { kind: 'current', fill: 5 },
    areas: ['portland'],
  },
  { title: 'B stale only', status: 'scored', score: { kind: 'stale', fill: 5 }, areas: ['remote'] },
  { title: 'C never scored', status: 'unscored', areas: ['phoenix'], firstSeenAt: TWO_DAYS_AGO },
  {
    title: 'D shortlisted',
    status: 'shortlisted',
    score: { kind: 'current', fill: 4 },
    areas: ['phoenix'],
  },
  { title: 'E skipped', status: 'skipped', score: { kind: 'current', fill: 5 } },
  { title: 'F duplicate', status: 'unscored', duplicate: true },
  {
    title: 'G applied',
    status: 'shortlisted',
    score: { kind: 'current', fill: 5 },
    application: true,
  },
  {
    title: 'H scored, older',
    status: 'scored',
    score: { kind: 'current', fill: 1 },
    firstSeenAt: TWO_DAYS_AGO,
  },
];

function titles(db: Db, clock: Clock, view: TriageView, key: ScoringKey): string[] {
  return triageRows(db, clock, view, key)
    .map((r) => r.title)
    .sort();
}

describe('triageRows', () => {
  it('puts each visible job in its views, and never a duplicate, skipped or applied job', () => {
    const { db, clock, key } = setup(SEEDS);
    expect(titles(db, clock, 'top', key)).toEqual(['A scored today', 'H scored, older']);
    expect(titles(db, clock, 'new', key)).toEqual(['A scored today', 'B stale only']);
    expect(titles(db, clock, 'shortlist', key)).toEqual(['D shortlisted']);
    expect(titles(db, clock, 'unscored', key)).toEqual(['B stale only', 'C never scored']);
    const everywhere = TRIAGE_VIEWS.flatMap((v) => titles(db, clock, v, key));
    for (const hidden of ['E skipped', 'F duplicate', 'G applied']) {
      expect(everywhere).not.toContain(hidden);
    }
  });

  it('counts a job whose only score is stale as unscored, with no dimension scores', () => {
    const { db, clock, key } = setup(SEEDS);
    const b = triageRows(db, clock, 'unscored', key).find((r) => r.title === 'B stale only');
    expect(b).toMatchObject({ stale: true, dims: null, areas: ['remote'] });
    const a = triageRows(db, clock, 'top', key).find((r) => r.title === 'A scored today');
    expect(a?.dims).toEqual([5, 5, 5, 5, 5, 5]);
    expect(a?.stale).toBe(false);
  });
});

describe('inWhere', () => {
  it('treats an empty Where as anywhere', () => {
    expect(inWhere([], [])).toBe(true);
    expect(inWhere(['phoenix'], [])).toBe(true);
    expect(inWhere([], ['phoenix'])).toBe(false);
    expect(inWhere(['remote', 'phoenix'], ['phoenix'])).toBe(true);
  });
});

describe('triageCounts', () => {
  it('counts each view within Where, ranking Top matches with the given weights', () => {
    const { db, clock, key } = setup(SEEDS);
    const criteria = testCriteria();
    const base = { key, weights: criteria.weights, bands: criteria.bands };
    expect(triageCounts(db, clock, { ...base, where: [] })).toEqual({
      matches: 1,
      fresh: 2,
      shortlist: 1,
      unscored: 2,
    });
    expect(triageCounts(db, clock, { ...base, where: ['phoenix'] })).toEqual({
      matches: 0,
      fresh: 0,
      shortlist: 1,
      unscored: 1,
    });
    expect(triageCounts(db, clock, { ...base, where: ['portland', 'remote'] })).toEqual({
      matches: 1,
      fresh: 2,
      shortlist: 0,
      unscored: 1,
    });
  });

  it('agrees with the rows of every view', () => {
    const { db, clock, key } = setup(SEEDS);
    const criteria = testCriteria();
    const where = ['phoenix', 'remote'];
    const counts = triageCounts(db, clock, {
      key,
      where,
      weights: criteria.weights,
      bands: criteria.bands,
    });
    const count = (view: TriageView) =>
      triageRows(db, clock, view, key).filter((r) => inWhere(r.areas, where)).length;
    expect(counts.fresh).toBe(count('new'));
    expect(counts.shortlist).toBe(count('shortlist'));
    expect(counts.unscored).toBe(count('unscored'));
  });
});

describe('triageDetail', () => {
  it('shows a current score with its areas and application', () => {
    const { db, clock, key, ids } = setup(SEEDS);
    const a = triageDetail(db, clock, ids[0] ?? 0, key);
    expect(a?.company).toBe('Acme');
    expect(a?.areas).toEqual(['portland']);
    expect(a?.score?.dimensions.role_fit.score).toBe(5);
    expect(a?.stale).toBe(false);
    expect(a?.application).toBeNull();
    expect(triageDetail(db, clock, ids[6] ?? 0, key)?.application).toEqual({
      id: expect.any(Number),
      status: 'prepped',
    });
  });

  it('hides a stale score and marks the detail stale', () => {
    const { db, clock, key, ids } = setup(SEEDS);
    const b = triageDetail(db, clock, ids[1] ?? 0, key);
    expect(b?.score).toBeNull();
    expect(b?.stale).toBe(true);
    expect(triageRowFor(db, clock, ids[1] ?? 0, key)).toMatchObject({ dims: null, stale: true });
  });

  it('returns undefined for a missing job', () => {
    const { db, clock, key } = setup([]);
    expect(triageDetail(db, clock, 999, key)).toBeUndefined();
    expect(triageRowFor(db, clock, 999, key)).toBeUndefined();
  });
});

describe('scoringSummary', () => {
  it('reads scored, waiting, gated and the cap from the funnel, with its gate labels', () => {
    const { db, clock, key } = setup(SEEDS);
    const criteria = testCriteria({ cap: 7 });
    const funnel = computeFunnel(db, clock, criteria, key);
    const summary = scoringSummary(funnel);
    expect(summary).toMatchObject({ scored: 5, waiting: 2, gated: 1, notYetGated: 0, cap: 7 });
    const text = renderFunnel(funnel);
    for (const g of summary.gates) expect(text).toContain(`${g.count}    ${g.label}`);
    expect(summary.gates.find((g) => g.gate === 'duplicate')?.count).toBe(1);
  });
});
