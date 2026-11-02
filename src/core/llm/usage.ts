import { and, eq, gte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { events } from '../db/schema.js';
import type { Clock } from '../util/clock.js';
import { estimateUsd } from './cost.js';

/**
 * Month-to-date LLM spend, for `stats` and the scout card. This sums the
 * `llm_usage` events written this calendar month (scoring and prep) and
 * estimates their cost with the same approximate price table used per run.
 * Token counts only (invariant 4).
 */

/** The ISO timestamp for 00:00:00 UTC on the first day of `iso`'s month. */
export function startOfMonthUtc(iso: string): string {
  return `${iso.slice(0, 7)}-01T00:00:00.000Z`;
}

interface UsagePayload {
  model?: unknown;
  input_tokens?: unknown;
  output_tokens?: unknown;
  calls?: unknown;
}

export interface MonthlyUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
  /** How many `llm_usage` events were summed. */
  events: number;
  /** Model calls, including retries. An event without a `calls` count is one call. */
  calls: number;
}

/** Sum the `llm_usage` events since the start of the current UTC month. */
export function monthlyUsage(db: Db, clock: Clock): MonthlyUsage {
  const since = startOfMonthUtc(clock.now());
  const rows = db
    .select({ payload: events.payload })
    .from(events)
    .where(and(eq(events.type, 'llm_usage'), gte(events.at, since)))
    .all();

  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedUsd = 0;
  let calls = 0;
  for (const row of rows) {
    const p = (row.payload ?? {}) as UsagePayload;
    const model = typeof p.model === 'string' ? p.model : '';
    const inTok = typeof p.input_tokens === 'number' ? p.input_tokens : 0;
    const outTok = typeof p.output_tokens === 'number' ? p.output_tokens : 0;
    inputTokens += inTok;
    outputTokens += outTok;
    calls += typeof p.calls === 'number' ? p.calls : 1;
    estimatedUsd += estimateUsd({ model, inputTokens: inTok, outputTokens: outTok, calls: 1 });
  }
  return { inputTokens, outputTokens, estimatedUsd, events: rows.length, calls };
}
