import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDb } from '../db/client.js';
import { eventsRepo } from '../db/repo/events.js';
import { fixedClock } from '../util/clock.js';
import { monthlyUsage, startOfMonthUtc } from './usage.js';

let sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'];

afterEach(() => {
  sqlite?.close();
});

describe('startOfMonthUtc', () => {
  it('returns midnight on the first of the month', () => {
    expect(startOfMonthUtc('2026-10-23T01:16:00.000Z')).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('monthlyUsage', () => {
  it('sums llm_usage events in the current month and estimates cost', () => {
    const made = createMigratedTestDb();
    sqlite = made.sqlite;
    const db = made.db;
    const clock = fixedClock('2026-10-23T12:00:00.000Z');
    const events = eventsRepo(db, clock);

    // In-month: two usage events for Haiku ($1/$5 per Mtok).
    events.append({
      type: 'llm_usage',
      payload: { model: 'claude-haiku-5-5', input_tokens: 1_000_000, output_tokens: 1_000_000 },
    });
    events.append({
      type: 'llm_usage',
      payload: { model: 'claude-haiku-5-5', input_tokens: 0, output_tokens: 200_000 },
    });
    // A non-usage event is ignored.
    events.append({ type: 'score', payload: { input_tokens: 999 } });

    // Last month: must be excluded.
    const last = fixedClock('2026-09-15T12:00:00.000Z');
    eventsRepo(db, last).append({
      type: 'llm_usage',
      payload: { model: 'claude-haiku-5-5', input_tokens: 5_000_000, output_tokens: 5_000_000 },
    });

    const usage = monthlyUsage(db, clock);
    expect(usage.events).toBe(2);
    expect(usage.inputTokens).toBe(1_000_000);
    expect(usage.outputTokens).toBe(1_200_000);
    // 1*$1 + 1*$5 + 0.2*$5 = $7.00
    expect(usage.estimatedUsd).toBeCloseTo(7, 5);
  });
});
