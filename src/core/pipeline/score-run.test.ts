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
  liveScoringRun,
  runScoreBatch,
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

    expect(seen).toEqual([0, 1]);
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

  it('goes by the last progress for a score run, and by the start for a scout', () => {
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
    expect(liveScoringRun(db, at('2026-10-25T14:00:00.000Z'))?.id).toBe(scout);
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
