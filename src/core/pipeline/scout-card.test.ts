import { describe, expect, it } from 'vitest';
import type { Criteria } from '../config/schemas.js';
import { type Db, createMigratedTestDb } from '../db/client.js';
import { eventsRepo } from '../db/repo/events.js';
import { runsRepo } from '../db/repo/runs.js';
import { chargeCall } from '../sources/budget.js';
import { seedJobs, testCriteria } from '../testing/fixtures.js';
import { fixedClock } from '../util/clock.js';
import { scoutCard } from './scout-card.js';

const NOW = '2026-10-25T12:00:00.000Z';
const clock = fixedClock(NOW);

function criteria(overrides: { jsearchBudget?: number } = {}): Criteria {
  return {
    ...testCriteria(),
    sources: {
      boards: { enabled: ['greenhouse'] },
      search: {
        jsearch: { enabled: true, monthly_call_budget: overrides.jsearchBudget ?? 200 },
        jobspipe: { enabled: false, monthly_call_budget: 0 },
        hn: { enabled: true, monthly_call_budget: 100 },
      },
      workday: { enabled: false },
    },
  };
}

function finishedRun(db: Db, ok: boolean, stats: unknown, error: string | null = null): void {
  const runs = runsRepo(db, fixedClock('2026-10-25T10:00:00.000Z'));
  const id = runs.start('scout');
  runsRepo(db, fixedClock('2026-10-25T10:15:00.000Z')).finish(id, { ok, stats, error });
}

describe('scoutCard', () => {
  it('is ok with no notices before any scout', () => {
    const { db } = createMigratedTestDb();
    const card = scoutCard(db, clock, criteria());
    expect(card).toMatchObject({ status: 'ok', notices: [], lastRun: null, running: false });
  });

  it('is ok after a clean run, with the boards and the new jobs of that run', () => {
    const { db } = createMigratedTestDb();
    seedJobs(db, clock, [{ title: 'A' }]);
    finishedRun(db, true, { inserted: 7, errors: [] });
    const card = scoutCard(db, clock, criteria());
    expect(card).toMatchObject({
      status: 'ok',
      notices: [],
      running: false,
      boards: 1,
      newLastRun: 7,
      lastRun: { startedAt: '2026-10-25T10:00:00.000Z', finishedAt: '2026-10-25T10:15:00.000Z' },
    });
  });

  it('asks for attention when the last run had board and search errors', () => {
    const { db } = createMigratedTestDb();
    finishedRun(db, true, {
      errors: [
        { company: 'A', ats: 'greenhouse', token: 'a' },
        { company: 'B', ats: 'lever', token: 'b' },
        { company: 'jsearch', ats: 'jsearch', token: 'search' },
      ],
    });
    const card = scoutCard(db, clock, criteria());
    expect(card.status).toBe('attention');
    expect(card.notices).toEqual([
      '2 boards failed in the last run',
      'JSearch failed in the last run',
    ]);
  });

  it('fails when the last run failed, naming the error', () => {
    const { db } = createMigratedTestDb();
    finishedRun(db, false, null, 'database is locked\nstack…');
    const card = scoutCard(db, clock, criteria());
    expect(card.status).toBe('failed');
    expect(card.notices).toEqual(['The last scout failed: database is locked']);
  });

  it('is running, with progress, while a recent run has no finish time', () => {
    const { db } = createMigratedTestDb();
    runsRepo(db, fixedClock('2026-10-25T11:50:00.000Z')).start('scout');
    seedJobs(db, fixedClock('2026-10-25T11:55:00.000Z'), [{ title: 'A' }, { title: 'B' }]);
    const card = scoutCard(db, clock, criteria());
    expect(card).toMatchObject({
      status: 'ok',
      running: true,
      progress: { done: 1, total: 1, found: 2, unit: 'Board' },
    });
  });

  it('fails when a run started hours ago never finished', () => {
    const { db } = createMigratedTestDb();
    runsRepo(db, fixedClock('2026-10-25T06:00:00.000Z')).start('scout');
    const card = scoutCard(db, clock, criteria());
    expect(card).toMatchObject({
      status: 'failed',
      running: false,
      progress: null,
      notices: ['The last scout never finished'],
    });
  });

  it('asks for attention when a search source is at its monthly budget', () => {
    const { db } = createMigratedTestDb();
    for (let i = 0; i < 3; i++) chargeCall(db, 'jsearch', NOW, 3, 0);
    const card = scoutCard(db, clock, criteria({ jsearchBudget: 3 }));
    expect(card.status).toBe('attention');
    expect(card.notices).toEqual(['JSearch is at its monthly budget']);
  });

  it('counts the model calls this month, and model spend alone is never a notice', () => {
    const { db } = createMigratedTestDb();
    const events = eventsRepo(db, clock);
    events.append({
      type: 'llm_usage',
      payload: { model: 'claude-haiku-5-5', input_tokens: 100_000_000, output_tokens: 1_000_000 },
    });
    events.append({ type: 'llm_usage', payload: { model: 'claude-haiku-5-5', calls: 2 } });
    const card = scoutCard(db, clock, criteria());
    expect(card.status).toBe('ok');
    expect(card.notices).toEqual([]);
    expect(card.modelCalls).toBe(3);
  });
});
