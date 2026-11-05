import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { type Db, createMigratedTestDb } from '../db/client.js';
import { eventsRepo } from '../db/repo/events.js';
import { scoresRepo } from '../db/repo/scores.js';
import { jobs } from '../db/schema.js';
import { estimateUsd } from '../llm/cost.js';
import { computeFunnel } from '../pipeline/funnel.js';
import {
  TEST_PREFERENCES,
  scoreOutput,
  seedJobs,
  testCriteria,
  testProfile,
} from '../testing/fixtures.js';
import { type Clock, fixedClock } from '../util/clock.js';
import {
  type ScoringConfig,
  costPerScore,
  rescoreImpact,
  sameScoringKey,
  scoringKeyOf,
} from './staleness.js';

const NOW = '2026-11-04T12:00:00.000Z';
let sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'] | undefined;

afterEach(() => {
  sqlite?.close();
  sqlite = undefined;
});

function config(): ScoringConfig {
  return { criteria: testCriteria(), profile: testProfile(), preferences: TEST_PREFERENCES };
}

/** Three jobs scored under the current key, one under an older profile, one unscored. */
function setup(): { db: Db; clock: Clock } {
  const made = createMigratedTestDb();
  sqlite = made.sqlite;
  const db = made.db;
  const clock = fixedClock(NOW);
  const key = scoringKeyOf(config());
  const ids = seedJobs(
    db,
    clock,
    ['A', 'B', 'C', 'D', 'E'].map((title) => ({ title })),
  );
  const scores = scoresRepo(db, clock);
  ids.forEach((id, i) => {
    db.update(jobs)
      .set({
        status: i < 4 ? 'scored' : 'unscored',
        gateResult: { passed: true, gate: null, detail: null },
      })
      .where(eq(jobs.id, id))
      .run();
    if (i === 4) return;
    const output = scoreOutput({}, 4);
    scores.insert({
      jobId: id,
      contentHash: `hash-Acme-${i}`,
      ...key,
      ...(i === 3 ? { profileHash: 'an-older-profile' } : {}),
      dimensions: output.dimensions,
      summary: 'A test job.',
      score: 80,
      verdict: 'strong',
      redFlags: [],
    });
  });
  return { db, clock };
}

function usage(db: Db, at: string, model: string, inputTokens: number, prompt = 'score'): void {
  eventsRepo(db, fixedClock(at)).append({
    type: 'llm_usage',
    payload: { model, prompt, input_tokens: inputTokens, output_tokens: 100, calls: 1 },
  });
}

describe('scoringKeyOf', () => {
  it('changes when the summary changes', () => {
    const before = config();
    const after = { ...before, profile: { ...before.profile, summary: 'Staff engineer.' } };
    expect(sameScoringKey(scoringKeyOf(before), scoringKeyOf(after))).toBe(false);
  });

  it('holds for links, standard answers and self-identification edits', () => {
    const before = config();
    const edits: ScoringConfig['profile'][] = [
      { ...before.profile, links: { github: 'https://github.com/kris-tester' } },
      { ...before.profile, standard_answers: { notice_period: 'Two weeks' } },
      {
        ...before.profile,
        self_identification: {
          gender: 'decline',
          race_ethnicity: 'decline',
          veteran_status: 'I am not a veteran',
          disability_status: 'decline',
          overrides: {},
        },
      },
    ];
    for (const profile of edits) {
      expect(sameScoringKey(scoringKeyOf(before), scoringKeyOf({ ...before, profile }))).toBe(true);
    }
  });

  it('holds for a preferences edit that only changes whitespace', () => {
    const before = config();
    const spaced = `\n\n${before.preferences.replace(/ /g, '   ').replace(/\n/g, '\n\n')}  \n`;
    expect(spaced).not.toBe(before.preferences);
    expect(
      sameScoringKey(scoringKeyOf(before), scoringKeyOf({ ...before, preferences: spaced })),
    ).toBe(true);
    const worded = { ...before, preferences: `${before.preferences} Also games.` };
    expect(sameScoringKey(scoringKeyOf(before), scoringKeyOf(worded))).toBe(false);
  });
});

describe('rescoreImpact', () => {
  it("counts the stale-if-saved jobs as computeFunnel's current count", () => {
    const { db, clock } = setup();
    const current = config();
    const next = { ...current, profile: { ...current.profile, summary: 'Staff engineer.' } };
    const funnel = computeFunnel(db, clock, current.criteria, scoringKeyOf(current));
    const impact = rescoreImpact(db, current, next, clock);
    expect(funnel.scored).toMatchObject({ total: 4, current: 3, stale: 1 });
    expect(impact.changesScores).toBe(true);
    expect(impact.staleIfSaved).toBe(funnel.scored.current);
  });

  it('is zero when the key holds', () => {
    const { db, clock } = setup();
    const current = config();
    const next = {
      ...current,
      profile: { ...current.profile, links: { github: 'https://x.example' } },
    };
    expect(rescoreImpact(db, current, next, clock)).toEqual({
      changesScores: false,
      staleIfSaved: 0,
      estimatedUsd: 0,
      basis: null,
    });
  });

  it("prices the stale jobs at this month's mean scoring call for the scoring model", () => {
    const { db, clock } = setup();
    const current = config();
    const model = current.criteria.llm.scoring_model;
    usage(db, '2026-11-02T00:00:00.000Z', model, 4000);
    usage(db, '2026-11-03T00:00:00.000Z', model, 6000);
    usage(db, '2026-11-03T00:00:00.000Z', model, 900_000, 'draft_answers');
    usage(db, '2026-11-03T00:00:00.000Z', 'claude-opus-4', 900_000);
    usage(db, '2026-10-20T00:00:00.000Z', model, 1_000_000);
    const next = { ...current, preferences: `${current.preferences} More.` };
    const impact = rescoreImpact(db, current, next, clock);
    const mean =
      (estimateUsd({ model, inputTokens: 4000, outputTokens: 100, calls: 1 }) +
        estimateUsd({ model, inputTokens: 6000, outputTokens: 100, calls: 1 })) /
      2;
    expect(impact.basis).toEqual({
      month: '2026-11',
      thisMonth: true,
      calls: 2,
      perScoreUsd: mean,
    });
    expect(impact.estimatedUsd).toBeCloseTo(3 * mean, 10);
  });

  it('falls back to the last month with scoring calls, and says which', () => {
    const { db, clock } = setup();
    const model = config().criteria.llm.scoring_model;
    usage(db, '2026-08-10T00:00:00.000Z', model, 1000);
    usage(db, '2026-09-10T00:00:00.000Z', model, 2000);
    const basis = costPerScore(db, clock, model);
    expect(basis).toMatchObject({ month: '2026-09', thisMonth: false, calls: 1 });
  });

  it('has no estimate when the model has never scored a job', () => {
    const { db, clock } = setup();
    const current = config();
    const next = { ...current, profile: { ...current.profile, summary: 'Changed.' } };
    expect(rescoreImpact(db, current, next, clock)).toMatchObject({
      changesScores: true,
      staleIfSaved: 3,
      estimatedUsd: null,
      basis: null,
    });
  });
});
