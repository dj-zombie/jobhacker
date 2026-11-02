import { afterEach, describe, expect, it } from 'vitest';
import { scoreOutput, seedJobs } from '../../testing/fixtures.js';
import { fixedClock } from '../../util/clock.js';
import { createMigratedTestDb } from '../client.js';
import { jobs } from '../schema.js';
import { type ScoreKey, scoresRepo } from './scores.js';

let sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'];

afterEach(() => {
  sqlite?.close();
});

function setup() {
  const made = createMigratedTestDb();
  sqlite = made.sqlite;
  const clock = fixedClock('2026-10-23T00:00:00.000Z');
  const [jobId] = seedJobs(made.db, clock, [{ title: 'Engineer' }]);
  const contentHash = made.db.select().from(jobs).get()?.contentHash ?? '';
  const key: ScoreKey = {
    jobId: jobId ?? 0,
    contentHash,
    rubricVersion: 'r',
    model: 'm',
    profileHash: 'p',
    preferencesHash: 'q',
  };
  return { db: made.db, clock, key };
}

describe('scoresRepo cache key (PHASE2 D16)', () => {
  it('hits only on the exact (job, text, rubric, model, profile, preferences) key', () => {
    const { db, clock, key } = setup();
    const scores = scoresRepo(db, clock);
    scores.insert({
      ...key,
      dimensions: scoreOutput().dimensions,
      summary: 's',
      redFlags: [],
      score: 80,
      verdict: 'strong',
    });

    expect(scores.findCached(key)?.score).toBe(80);
    for (const part of [
      'contentHash',
      'rubricVersion',
      'model',
      'profileHash',
      'preferencesHash',
    ] as const) {
      expect(scores.findCached({ ...key, [part]: 'different' })).toBeUndefined();
    }
    expect(scores.hasDimensions(key.jobId, key.contentHash)).toBe(true);
    expect(scores.hasDimensions(key.jobId, 'other')).toBe(false);
  });

  it('allows a second row for the same text under a new key', () => {
    const { db, clock, key } = setup();
    const scores = scoresRepo(db, clock);
    const write = {
      dimensions: scoreOutput().dimensions,
      summary: 's',
      redFlags: [],
      score: 80,
      verdict: 'strong' as const,
    };
    scores.insert({ ...key, ...write });
    scores.insert({ ...key, preferencesHash: 'q2', ...write });
    expect(() => scores.insert({ ...key, ...write })).toThrow(/UNIQUE/);
  });
});
