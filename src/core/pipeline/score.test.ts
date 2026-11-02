import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { type Db, createMigratedTestDb } from '../db/client.js';
import { eventsRepo } from '../db/repo/events.js';
import { scoresRepo } from '../db/repo/scores.js';
import { type ScoreState, jobScores, jobs } from '../db/schema.js';
import { FakeLlm } from '../llm/fake.js';
import { VERSION } from '../llm/prompts/score.js';
import {
  TEST_PREFERENCES,
  scoreOutput,
  seedJobs,
  testCriteria,
  testProfile,
} from '../testing/fixtures.js';
import { type Clock, fixedClock } from '../util/clock.js';
import { nullLogger } from '../util/logger.js';
import { rankedList } from './ranked.js';
import { type ScoreDeps, scoreNewJobs, scoringInputs } from './score.js';

const NOW = '2026-10-23T12:00:00.000Z';
const VALID = scoreOutput();

let sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'];

afterEach(() => {
  sqlite?.close();
});

function setup(titles: string[]): { db: Db; clock: Clock; ids: number[] } {
  const made = createMigratedTestDb();
  sqlite = made.sqlite;
  const clock = fixedClock(NOW);
  const ids = seedJobs(
    made.db,
    clock,
    titles.map((title) => ({ title })),
  );
  return { db: made.db, clock, ids };
}

function deps(db: Db, clock: Clock, llm: FakeLlm, overrides: Partial<ScoreDeps> = {}): ScoreDeps {
  return {
    db,
    llm,
    clock,
    log: nullLogger(),
    criteria: testCriteria(),
    profile: testProfile(),
    preferences: TEST_PREFERENCES,
    ...overrides,
  };
}

function statusOf(db: Db, id: number): string | undefined {
  return db.select({ s: jobs.status }).from(jobs).where(eq(jobs.id, id)).get()?.s;
}

function scoreStateOf(db: Db, id: number): ScoreState | undefined {
  return db.select({ s: jobs.scoreState }).from(jobs).where(eq(jobs.id, id)).get()?.s;
}

describe('scoreNewJobs', () => {
  it('stores six dimensions, a summary and a snapshot score, and caches the result', async () => {
    const { db, clock, ids } = setup(['Senior Frontend Engineer']);
    const llm = new FakeLlm({ responder: () => scoreOutput({ comp_fit: null }, 5) });

    const first = await scoreNewJobs(deps(db, clock, llm));
    expect(first.stats).toMatchObject({
      candidates: 1,
      scored: 1,
      cached: 0,
      rubric_version: VERSION,
    });
    expect(llm.callCount).toBe(1);
    expect(statusOf(db, ids[0] ?? 0)).toBe('scored');

    const row = db.select().from(jobScores).get();
    expect(row?.dimensions?.role_fit).toEqual({ score: 5, reason: 'role_fit because' });
    expect(row?.dimensions?.comp_fit.score).toBeNull();
    expect(row?.summary).toBe('A test job.');
    expect(row?.score).toBe(100); // comp unknown drops out; everything else is 5
    expect(row?.verdict).toBe('strong');
    const key = scoringInputs(testCriteria(), testProfile(), TEST_PREFERENCES).key;
    expect(row).toMatchObject({
      profileHash: key.profileHash,
      preferencesHash: key.preferencesHash,
    });

    const second = await scoreNewJobs(deps(db, clock, llm));
    expect(second.stats).toMatchObject({ scored: 0, cached: 1 });
    expect(llm.callCount).toBe(1);
  });

  it('sends preferences and profile but never contact details', async () => {
    const { db, clock } = setup(['Senior Frontend Engineer']);
    const llm = new FakeLlm({ responder: () => VALID });
    await scoreNewJobs(deps(db, clock, llm));
    const user = llm.requests[0]?.user ?? '';
    expect(user).toContain('No people management');
    expect(user).toContain('Senior engineer.');
    expect(user).not.toContain('t@example.com');
  });

  it('walks candidates in prescore order so a capped run spends on the likeliest fits', async () => {
    const { db, clock, ids } = setup([
      'Account Executive',
      'Senior Frontend Engineer',
      'Data Analyst',
    ]);
    const llm = new FakeLlm({ responder: () => VALID });

    const result = await scoreNewJobs(deps(db, clock, llm, { criteria: testCriteria({ cap: 1 }) }));
    expect(result.stats).toMatchObject({ candidates: 3, scored: 1, skipped_cap: 2 });
    expect(llm.requests[0]?.user).toContain('Title: Senior Frontend Engineer');
    expect(statusOf(db, ids[1] ?? 0)).toBe('scored');
    expect(statusOf(db, ids[0] ?? 0)).toBe('unscored');
    expect(statusOf(db, ids[2] ?? 0)).toBe('unscored');
    expect(scoreStateOf(db, ids[0] ?? 0)).toBe('run_cap');
    expect(scoreStateOf(db, ids[2] ?? 0)).toBe('run_cap');
  });

  it("scores jobs in Kris's places first, tells the model where each job is, and skips none", async () => {
    const made = createMigratedTestDb();
    sqlite = made.sqlite;
    const clock = fixedClock(NOW);
    const ids = seedJobs(made.db, clock, [
      { title: 'Senior Frontend Engineer', locationRaw: 'Toronto, ON', remoteType: 'onsite' },
      { title: 'Data Analyst', locationRaw: 'Portland, OR', remoteType: 'onsite' },
    ]);
    const llm = new FakeLlm({ responder: () => VALID });
    const criteria = testCriteria({ cap: 1, withPlaces: true });

    const capped = await scoreNewJobs(deps(made.db, clock, llm, { criteria }));
    expect(capped.stats).toMatchObject({
      candidates: 2,
      scored: 1,
      skipped_cap: 1,
      first: ['portland', 'phoenix', 'remote'],
      scored_first: 1,
    });
    expect(llm.requests[0]?.user).toContain('Title: Data Analyst');
    expect(llm.requests[0]?.user).toContain(
      'Location classified as: Portland area (matched "Portland, OR")',
    );

    // The out-of-place job is next, not dropped; `first: []` puts no place first.
    await scoreNewJobs(deps(made.db, clock, llm, { criteria, first: [] }));
    expect(llm.requests[1]?.user).toContain(
      `Location classified as: none of the candidate's places ("Toronto, ON")`,
    );
    expect(scoreStateOf(made.db, ids[0] ?? 0)).toBe('current');
  });

  it('reports progress: total is the capped number of model calls, then done and matches found', async () => {
    const { db, clock } = setup([
      'Senior Frontend Engineer',
      'Staff Frontend Engineer',
      'Account Executive',
    ]);
    await scoreNewJobs(deps(db, clock, new FakeLlm({ responder: () => VALID }), { limit: 1 }));
    const llm = new FakeLlm({
      responder: (request) =>
        request.user.includes('Account Executive') ? scoreOutput({}, 0) : VALID,
    });
    const seen: { done: number; total: number; found: number }[] = [];

    await scoreNewJobs(deps(db, clock, llm, { onProgress: (p) => seen.push(p) }));
    expect(llm.callCount).toBe(2);
    expect(seen[0]).toEqual({ done: 0, total: 2, found: 0 });
    expect(seen.at(-1)).toEqual({ done: 2, total: 2, found: 1 });
    expect(seen.map((p) => p.done)).toEqual([0, 1, 2]);
  });

  it('scores only the given jobs when `jobIds` is set', async () => {
    const { db, clock, ids } = setup(['Senior Frontend Engineer', 'Data Analyst']);
    const llm = new FakeLlm({ responder: () => VALID });

    const result = await scoreNewJobs(deps(db, clock, llm, { jobIds: [ids[1] ?? 0] }));
    expect(result.stats).toMatchObject({ candidates: 1, scored: 1 });
    expect(llm.requests[0]?.user).toContain('Title: Data Analyst');
    expect(statusOf(db, ids[1] ?? 0)).toBe('scored');
    expect(statusOf(db, ids[0] ?? 0)).not.toBe('scored');
  });

  it('eventually scores the lowest-prescore job across repeated capped runs', async () => {
    const { db, clock, ids } = setup([
      'Account Executive',
      'Senior Frontend Engineer',
      'Data Analyst',
    ]);
    const llm = new FakeLlm({ responder: () => VALID });

    const capped = deps(db, clock, llm, { criteria: testCriteria({ cap: 1 }) });
    await scoreNewJobs(capped);
    await scoreNewJobs(capped);
    await scoreNewJobs(capped);

    expect(llm.callCount).toBe(3);
    expect(scoresRepo(db, clock).unscoredRows()).toEqual([]);
    for (const id of ids) {
      expect(statusOf(db, id)).toBe('scored');
      expect(scoreStateOf(db, id)).toBe('current');
    }
    expect(llm.requests.some((r) => r.user.includes('Title: Account Executive'))).toBe(true);
  });

  it('applies the gates first: a too-old job is gated, not scored', async () => {
    const made = createMigratedTestDb();
    sqlite = made.sqlite;
    const clock = fixedClock(NOW);
    const [fresh, old] = seedJobs(made.db, clock, [
      { title: 'Senior Frontend Engineer' },
      { title: 'Senior Frontend Engineer II', postedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const llm = new FakeLlm({ responder: () => VALID });

    const result = await scoreNewJobs(
      deps(made.db, clock, llm, { criteria: testCriteria({ maxAgeDays: 30 }) }),
    );
    expect(result.stats.gates.gated.age).toBe(1);
    expect(result.stats).toMatchObject({ candidates: 1, scored: 1 });
    expect(statusOf(made.db, fresh ?? 0)).toBe('scored');
    expect(statusOf(made.db, old ?? 0)).toBe('filtered_out');
  });

  it('rescores when preferences change, keeping the old score (stale) until then', async () => {
    const { db, clock, ids } = setup(['Senior Frontend Engineer', 'Senior Fullstack Engineer']);
    const llm = new FakeLlm({ responder: () => VALID });
    await scoreNewJobs(deps(db, clock, llm));
    expect(llm.callCount).toBe(2);

    const edited = `${TEST_PREFERENCES}\nI would love audio work.`;
    const result = await scoreNewJobs(
      deps(db, clock, llm, { preferences: edited, criteria: testCriteria({ cap: 1 }) }),
    );
    expect(result.stats).toMatchObject({ scored: 1, cached: 0, skipped_cap: 1 });
    expect(llm.callCount).toBe(3);

    const current = scoringInputs(testCriteria(), testProfile(), edited).key;
    const ranked = rankedList(db, clock, {
      weights: testCriteria().weights,
      bands: testCriteria().bands,
      current,
    });
    expect(ranked).toHaveLength(2); // the not-yet-rescored job keeps its old score
    expect(ranked.filter((r) => r.stale)).toHaveLength(1);
    for (const id of ids) expect(statusOf(db, id)).toBe('scored');
  });

  it('rescores when the profile changes', async () => {
    const { db, clock } = setup(['Senior Frontend Engineer']);
    const llm = new FakeLlm({ responder: () => VALID });
    await scoreNewJobs(deps(db, clock, llm));
    const profile = { ...testProfile(), summary: 'Senior engineer who ships audio tools.' };
    const result = await scoreNewJobs(deps(db, clock, llm, { profile }));
    expect(result.stats.scored).toBe(1);
    expect(llm.callCount).toBe(2);
  });

  it.each(['shortlisted', 'skipped', 'archived'] as const)(
    'rescores a stale %s job without changing its triage status',
    async (status) => {
      const { db, clock, ids } = setup(['Senior Frontend Engineer']);
      const id = ids[0] ?? 0;
      const llm = new FakeLlm({ responder: () => VALID });
      await scoreNewJobs(deps(db, clock, llm));
      db.update(jobs).set({ status }).where(eq(jobs.id, id)).run();

      const profile = { ...testProfile(), summary: `Changed profile for ${status}.` };
      const result = await scoreNewJobs(deps(db, clock, llm, { profile }));

      expect(result.stats.scored).toBe(1);
      expect(llm.callCount).toBe(2);
      expect(statusOf(db, id)).toBe(status);
      expect(scoreStateOf(db, id)).toBe('current');
    },
  );

  it('re-ranks on a weight change with zero LLM calls', async () => {
    const { db, clock, ids } = setup(['Senior Frontend Engineer', 'Senior Fullstack Engineer']);
    let n = 0;
    const llm = new FakeLlm({
      responder: () => {
        n += 1;
        // first job: great role, bad logistics; second: the reverse
        return n === 1
          ? scoreOutput({ logistics_fit: 0 }, 5)
          : scoreOutput({ role_fit: 1, logistics_fit: 5 }, 3);
      },
    });
    await scoreNewJobs(deps(db, clock, llm));
    const calls = llm.callCount;
    const usage = eventsRepo(db, clock).ofType('llm_usage').length;

    const base = testCriteria();
    const roleHeavy = rankedList(db, clock, {
      weights: { ...base.weights, role_fit: 10, logistics_fit: 0 },
      bands: base.bands,
    });
    const logisticsHeavy = rankedList(db, clock, {
      weights: { ...base.weights, role_fit: 0, logistics_fit: 10 },
      bands: base.bands,
    });
    expect(roleHeavy[0]?.jobId).not.toBe(logisticsHeavy[0]?.jobId);
    expect(new Set(roleHeavy.map((r) => r.jobId))).toEqual(new Set(ids));
    expect(llm.callCount).toBe(calls);
    expect(eventsRepo(db, clock).ofType('llm_usage')).toHaveLength(usage);
  });

  it('retries once on invalid output and then records a clean error', async () => {
    const { db, clock, ids } = setup(['Senior Frontend Engineer']);
    const llm = new FakeLlm({ responder: () => ({ not: 'a score' }) });

    const result = await scoreNewJobs(deps(db, clock, llm));
    expect(result.stats).toMatchObject({ scored: 0, errors: 1 });
    expect(llm.attempts).toBe(2);
    expect(statusOf(db, ids[0] ?? 0)).toBe('unscored');
    expect(scoreStateOf(db, ids[0] ?? 0)).toBe('llm_error');
    expect(db.select().from(jobScores).all()).toHaveLength(0);
  });

  it('rejects a dimension outside 0–5 (no coercion)', async () => {
    const { db, clock } = setup(['Senior Frontend Engineer']);
    const llm = new FakeLlm({ responder: () => scoreOutput({ role_fit: 7 }) });
    const result = await scoreNewJobs(deps(db, clock, llm));
    expect(result.stats.errors).toBe(1);
    expect(db.select().from(jobScores).all()).toHaveLength(0);
  });

  it('rejects a dimension sent as a bare null instead of {score: null, reason}', async () => {
    const { db, clock, ids } = setup(['Senior Frontend Engineer']);
    const llm = new FakeLlm({
      responder: () => {
        const out = scoreOutput();
        return { ...out, dimensions: { ...out.dimensions, comp_fit: null } };
      },
    });
    const result = await scoreNewJobs(deps(db, clock, llm));
    expect(result.stats.errors).toBe(1);
    expect(llm.attempts).toBe(2);
    expect(statusOf(db, ids[0] ?? 0)).toBe('unscored');
  });

  it('recovers when the single retry returns valid output', async () => {
    const { db, clock, ids } = setup(['Senior Frontend Engineer']);
    const llm = new FakeLlm({
      responder: (_req, attempt) => (attempt === 1 ? { garbage: true } : VALID),
    });

    const result = await scoreNewJobs(deps(db, clock, llm));
    expect(result.stats).toMatchObject({ scored: 1, errors: 0 });
    expect(llm.attempts).toBe(2);
    expect(statusOf(db, ids[0] ?? 0)).toBe('scored');
  });

  it('the --limit option can only lower the cap', async () => {
    const { db, clock } = setup([
      'Senior Frontend Engineer',
      'Senior Fullstack Engineer',
      'Staff Engineer',
    ]);
    const llm = new FakeLlm({ responder: () => VALID });

    const result = await scoreNewJobs(
      deps(db, clock, llm, { criteria: testCriteria({ cap: 2 }), limit: 1 }),
    );
    expect(result.stats).toMatchObject({ scored: 1, skipped_cap: 2 });
    expect(llm.callCount).toBe(1);
  });

  it('logs a llm_usage event per scored job and totals usage and cost', async () => {
    const { db, clock } = setup(['Senior Frontend Engineer', 'Senior Fullstack Engineer']);
    const llm = new FakeLlm({ responder: () => VALID, inputTokens: 100, outputTokens: 40 });

    const result = await scoreNewJobs(deps(db, clock, llm));
    expect(result.stats).toMatchObject({
      scored: 2,
      input_tokens: 200,
      output_tokens: 80,
      calls: 2,
    });
    expect(result.stats.cost_is_estimate).toBe(false);
    expect(result.stats.estimated_usd).toBeGreaterThan(0);

    const usage = eventsRepo(db, clock).ofType('llm_usage');
    expect(usage).toHaveLength(2);
    expect(usage[0]?.payload).toMatchObject({
      model: 'claude-haiku-5-5',
      prompt: 'score',
      rubric_version: VERSION,
    });
  });

  it('counts a failed attempt toward the per-run cap and logs its usage', async () => {
    const { db, clock } = setup(['Senior Frontend Engineer', 'Senior Fullstack Engineer']);
    const llm = new FakeLlm({ responder: () => ({ bad: true }), inputTokens: 10, outputTokens: 5 });

    const result = await scoreNewJobs(deps(db, clock, llm, { criteria: testCriteria({ cap: 1 }) }));
    expect(result.stats).toMatchObject({ errors: 1, skipped_cap: 1 });
    expect(llm.callCount).toBe(1);

    const usage = eventsRepo(db, clock).ofType('llm_usage');
    expect(usage).toHaveLength(1);
    expect(usage[0]?.payload).toMatchObject({ prompt: 'score', failed: true });
    expect(result.stats.estimated_usd).toBeGreaterThan(0);
  });

  it('keeps scoring whatever the month has spent; only the per-run cap stops calls', async () => {
    const { db, clock } = setup(['Senior Frontend Engineer', 'Senior Fullstack Engineer']);
    // Prior in-month spend of ~$100 (100M Haiku input tokens at $1/Mtok).
    eventsRepo(db, clock).append({
      type: 'llm_usage',
      payload: { model: 'claude-haiku-5-5', input_tokens: 100_000_000, output_tokens: 0 },
    });
    const llm = new FakeLlm({ responder: () => VALID });

    const result = await scoreNewJobs(deps(db, clock, llm));
    expect(result.stats).toMatchObject({ scored: 2, skipped_cap: 0 });
    expect(llm.callCount).toBe(2);
    for (const row of db.select().from(jobs).all()) {
      expect(row.scoreState).toBe('current');
    }
  });
});
