import { afterEach, describe, expect, it } from 'vitest';
import { type Db, createMigratedTestDb } from '../db/client.js';
import { runsRepo } from '../db/repo/runs.js';
import { FakeLlm } from '../llm/fake.js';
import { LlmError } from '../llm/types.js';
import {
  TEST_PREFERENCES,
  scoreOutput,
  seedJobs,
  testCriteria,
  testProfile,
} from '../testing/fixtures.js';
import { type Clock, fixedClock } from '../util/clock.js';
import { nullLogger } from '../util/logger.js';
import {
  ScoreBusyError,
  finishWithProgress,
  formatScoreDuration,
  formatScorePlan,
  liveScoringRun,
  requestScoreStop,
  runScoreBatch,
  scorePace,
  scoreRunState,
  startScoreRun,
  trackScoreRun,
} from './score-run.js';

const NOW = '2026-10-25T12:00:00.000Z';

let sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'];

afterEach(() => {
  sqlite?.close();
});

function setup(titles: string[], now = NOW): { db: Db; clock: Clock; ids: number[] } {
  const made = createMigratedTestDb();
  sqlite = made.sqlite;
  const clock = fixedClock(now);
  const ids = seedJobs(
    made.db,
    clock,
    titles.map((title) => ({ title })),
  );
  return { db: made.db, clock, ids };
}

function deps(db: Db, clock: Clock, llm: FakeLlm | { structured: () => Promise<never> }) {
  return {
    db,
    llm,
    clock,
    log: nullLogger(),
    criteria: testCriteria(),
    profile: testProfile(),
    preferences: TEST_PREFERENCES,
  };
}

describe('score batches', () => {
  it('records progress on its run while it goes, then finishes with the stats', async () => {
    const { db, clock } = setup(['Senior Frontend Engineer', 'Account Executive']);
    const seen: number[] = [];
    const llm = new FakeLlm({
      responder: (request) => {
        const state = scoreRunState(db, clock, 1);
        seen.push(state?.progress.done ?? -1);
        return request.user.includes('Account Executive') ? scoreOutput({}, 0) : scoreOutput();
      },
    });

    const id = startScoreRun(db, clock, { first: ['phoenix'] });
    expect(scoreRunState(db, clock, id)).toMatchObject({
      running: true,
      ok: null,
      first: ['phoenix'],
      jobIds: null,
    });
    await runScoreBatch(id, deps(db, clock, llm));

    // Both calls start before either finishes, so each one still sees 0 done.
    expect(seen).toEqual([0, 0]);
    const done = scoreRunState(db, clock, id);
    expect(done).toMatchObject({
      running: false,
      ok: true,
      abandoned: false,
      progress: { done: 2, total: 2, found: 1 },
      first: ['phoenix'],
    });
    expect(runsRepo(db, clock).get(id)?.stats).toMatchObject({ scored: 2, first: ['phoenix'] });
  });

  it('scores one job when started with its id', async () => {
    const { db, clock, ids } = setup(['Senior Frontend Engineer', 'Data Analyst']);
    const llm = new FakeLlm({ responder: () => scoreOutput() });
    const id = startScoreRun(db, clock, { first: [], jobIds: [ids[1] ?? 0] });
    await runScoreBatch(id, deps(db, clock, llm));
    expect(llm.callCount).toBe(1);
    expect(llm.requests[0]?.user).toContain('Title: Data Analyst');
    expect(scoreRunState(db, clock, id)).toMatchObject({
      jobIds: [ids[1]],
      progress: { done: 1, total: 1 },
    });
  });

  it('refuses a second batch, or one during a scout, until the live run finishes', async () => {
    const { db, clock } = setup(['Senior Frontend Engineer']);
    const id = startScoreRun(db, clock, { first: [] });
    expect(() => startScoreRun(db, clock, { first: [] })).toThrow(ScoreBusyError);
    await runScoreBatch(id, deps(db, clock, new FakeLlm({ responder: () => scoreOutput() })));
    expect(liveScoringRun(db, clock)).toBeUndefined();

    const scout = runsRepo(db, clock).start('scout');
    expect(() => startScoreRun(db, clock, { first: [] })).toThrow(/scout is running/);
    runsRepo(db, clock).finish(scout, { ok: true });
    expect(() => startScoreRun(db, clock, { first: [] })).not.toThrow();
  });

  it('counts a model failure as an error on the run and still finishes it', async () => {
    const { db, clock } = setup(['Senior Frontend Engineer']);
    const id = startScoreRun(db, clock, { first: [] });
    const broken = { structured: () => Promise.reject(new LlmError('no key')) };
    await runScoreBatch(id, deps(db, clock, broken));
    expect(scoreRunState(db, clock, id)).toMatchObject({ running: false, ok: true });
    expect(runsRepo(db, clock).get(id)?.stats).toMatchObject({ errors: 1 });
  });

  it('treats a run left open for hours as abandoned, not running', () => {
    const { db } = setup([]);
    const then = fixedClock('2026-10-25T06:00:00.000Z');
    const id = startScoreRun(db, then, { first: [] });
    const later = fixedClock(NOW);
    expect(scoreRunState(db, later, id)).toMatchObject({
      running: false,
      abandoned: true,
      ok: null,
    });
    expect(liveScoringRun(db, later)).toBeUndefined();
    expect(scoreRunState(db, later, 999)).toBeUndefined();
  });

  it('goes by the last progress for a score run, and by the heartbeat for a scout', () => {
    const { db } = setup([]);
    const at = (iso: string) => fixedClock(iso);
    const id = startScoreRun(db, at('2026-10-25T08:00:00.000Z'), { first: [] });
    trackScoreRun(db, at('2026-10-25T11:50:00.000Z'), id)({ done: 3, total: 9, found: 1 });
    expect(liveScoringRun(db, at('2026-10-25T12:00:00.000Z'))?.id).toBe(id);
    expect(scoreRunState(db, at('2026-10-25T12:06:00.000Z'), id)).toMatchObject({
      running: false,
      abandoned: true,
      progress: { done: 3 },
    });

    // A CLI run killed mid-batch (no progress written) stops blocking after the stall window.
    const killed = runsRepo(db, at('2026-10-25T12:00:00.000Z')).start('score');
    expect(liveScoringRun(db, at('2026-10-25T12:14:00.000Z'))?.id).toBe(killed);
    expect(liveScoringRun(db, at('2026-10-25T12:16:00.000Z'))).toBeUndefined();

    const scout = runsRepo(db, at('2026-10-25T12:00:00.000Z')).start('scout');
    expect(liveScoringRun(db, at('2026-10-25T14:00:00.000Z'))).toBeUndefined();
    runsRepo(db, at('2026-10-25T13:58:00.000Z')).progress(scout, {
      progress: { done: 13, total: 532, found: 1, unit: 'Board' },
      beatAt: '2026-10-25T13:58:00.000Z',
    });
    expect(liveScoringRun(db, at('2026-10-25T14:00:00.000Z'))?.id).toBe(scout);
    expect(liveScoringRun(db, at('2026-10-25T14:04:00.000Z'))).toBeUndefined();
  });

  it('scores past the config cap when the run asked for a higher limit', async () => {
    const { db, clock } = setup([
      'Senior Frontend Engineer',
      'Staff Frontend Engineer',
      'Data Analyst',
    ]);
    const llm = new FakeLlm({ responder: () => scoreOutput() });
    const id = startScoreRun(db, clock, { first: [], limit: 3 });
    await runScoreBatch(id, { ...deps(db, clock, llm), criteria: testCriteria({ cap: 1 }) });
    expect(llm.callCount).toBe(3);
    expect(scoreRunState(db, clock, id)?.progress).toMatchObject({ done: 3, total: 3 });
  });

  it('keeps a stop across the next progress write', () => {
    const { db, clock } = setup(['Senior Frontend Engineer']);
    const id = startScoreRun(db, clock, { first: ['portland'], limit: 40, onlyFirst: true });
    expect(requestScoreStop(db, clock, id)).toBe(true);
    trackScoreRun(db, clock, id, {
      first: ['portland'],
      jobIds: null,
      industry: null,
      onlyFirst: true,
      limit: 40,
      stop: false,
      concurrency: 6,
    })({ done: 1, total: 40, found: 0 });
    expect(scoreRunState(db, clock, id)).toMatchObject({ stop: true, progress: { done: 1 } });
    expect(requestScoreStop(db, clock, 999)).toBe(false);
  });

  it('prices a later overlapping run from a one-at-a-time batch without dividing twice', () => {
    const { db } = setup([]);
    const early = fixedClock('2026-10-25T12:00:00.000Z');
    const late = fixedClock('2026-10-25T12:09:00.000Z');
    const id = runsRepo(db, early).start('score');
    runsRepo(db, late).finish(id, { ok: true, stats: { scored: 150 } });
    const pace = scorePace(db, late, 'claude-haiku-5-5');
    // 540s / 150 jobs, recorded as one-at-a-time, spread across 6 calls.
    expect(pace.secondsEach).toBeCloseTo(0.6, 5);
    expect(pace.perScoreUsd).toBeNull();
    expect(formatScoreDuration(15 * 60)).toBe('about 15 min');
    expect(formatScoreDuration(3.7 * 3600)).toBe('about 3.7 hours');
    expect(formatScorePlan(2, pace)).toBe(
      'up to 2 jobs · cost unknown · about 1 second · 6 at a time',
    );

    const again = fixedClock('2026-10-25T13:00:00.000Z');
    const parallel = runsRepo(db, again).start('score');
    runsRepo(db, fixedClock('2026-10-25T13:01:30.000Z')).finish(parallel, {
      ok: true,
      stats: { scored: 150, concurrency: 6 },
    });
    expect(scorePace(db, again, 'claude-haiku-5-5').secondsEach).toBeCloseTo(0.6, 5);

    // One job cannot fill six slots. 4s for that one job is 4/6 s at full overlap.
    const one = runsRepo(db, fixedClock('2026-10-25T14:00:00.000Z')).start('score');
    runsRepo(db, fixedClock('2026-10-25T14:00:04.000Z')).finish(one, {
      ok: true,
      stats: { scored: 1, concurrency: 6 },
    });
    expect(
      scorePace(db, fixedClock('2026-10-25T14:01:00.000Z'), 'claude-haiku-5-5').secondsEach,
    ).toBeCloseTo(4 / 6, 5);
  });

  it('keeps the heartbeat progress when a run is finished with its score stats', () => {
    const { db, clock } = setup([]);
    const id = runsRepo(db, clock).start('score');
    trackScoreRun(db, clock, id)({ done: 4, total: 4, found: 1 });
    finishWithProgress(db, clock, id, { ok: true, stats: { scored: 4, first: ['portland'] } });
    expect(scoreRunState(db, clock, id)).toMatchObject({
      running: false,
      ok: true,
      progress: { done: 4, total: 4, found: 1 },
    });
  });
});
