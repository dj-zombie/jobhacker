import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { events } from '../db/schema.js';
import { estimateUsd } from '../llm/cost.js';
import { computeFunnel } from '../pipeline/funnel.js';
import { type ScoringKey, scoringInputs } from '../pipeline/score.js';
import type { Clock } from '../util/clock.js';
import type { Criteria, Profile } from './schemas.js';

/** The config the score cache key is computed from (D30). */
export interface ScoringConfig {
  criteria: Criteria;
  profile: Profile;
  preferences: string;
}

/** What one score has cost, averaged over a month's scoring calls for one model. */
export interface CostBasis {
  /** `YYYY-MM`, UTC. */
  month: string;
  /** False when this month has no scoring calls and an earlier month was used. */
  thisMonth: boolean;
  /** Scoring calls that month, retries and failures included. */
  calls: number;
  perScoreUsd: number;
}

export interface RescoreImpact {
  /** The edit changes the score cache key, so every current score goes stale. */
  changesScores: boolean;
  /** Jobs scored under the current key: `computeFunnel(...).scored.current`. 0 when the key holds. */
  staleIfSaved: number;
  /** `staleIfSaved` × `basis.perScoreUsd`, or null when the model has never scored a job here. */
  estimatedUsd: number | null;
  basis: CostBasis | null;
}

export function scoringKeyOf(config: ScoringConfig): ScoringKey {
  return scoringInputs(config.criteria, config.profile, config.preferences).key;
}

export function sameScoringKey(a: ScoringKey, b: ScoringKey): boolean {
  return (
    a.rubricVersion === b.rubricVersion &&
    a.model === b.model &&
    a.profileHash === b.profileHash &&
    a.preferencesHash === b.preferencesHash
  );
}

/** Jobs scored under the current key, the number `pnpm cli stats` prints as `scored … current`. */
export function currentScoreCount(db: Db, clock: Clock, config: ScoringConfig): number {
  return computeFunnel(db, clock, config.criteria, scoringKeyOf(config)).scored.current;
}

/**
 * The mean cost of a scoring call for `model`, from this month's `llm_usage` events with
 * `prompt: 'score'`. With none this month, the latest month that has some. Null when there are
 * none at all. Reads only.
 */
export function costPerScore(db: Db, clock: Clock, model: string): CostBasis | null {
  const rows = db
    .select({ payload: events.payload, at: events.at })
    .from(events)
    .where(eq(events.type, 'llm_usage'))
    .orderBy(desc(events.at))
    .all();

  const thisMonth = clock.now().slice(0, 7);
  const months = new Map<string, { calls: number; usd: number }>();
  for (const row of rows) {
    const p = row.payload;
    if (!isRecord(p) || p.prompt !== 'score' || p.model !== model) continue;
    const month = row.at.slice(0, 7);
    const sum = months.get(month) ?? { calls: 0, usd: 0 };
    sum.calls += 1;
    sum.usd += estimateUsd({
      model,
      inputTokens: typeof p.input_tokens === 'number' ? p.input_tokens : 0,
      outputTokens: typeof p.output_tokens === 'number' ? p.output_tokens : 0,
      calls: 1,
    });
    months.set(month, sum);
  }
  const month = months.has(thisMonth) ? thisMonth : [...months.keys()].sort().at(-1);
  const sum = month === undefined ? undefined : months.get(month);
  if (month === undefined || sum === undefined || sum.calls === 0) return null;
  return {
    month,
    thisMonth: month === thisMonth,
    calls: sum.calls,
    perScoreUsd: sum.usd / sum.calls,
  };
}

/**
 * What saving `next` over `current` does to scores (J18). Reads only; no model call.
 * When the cache key changes, every job scored under the current key goes stale, and Top
 * matches shows only re-scored jobs until they're scored again.
 */
export function rescoreImpact(
  db: Db,
  current: ScoringConfig,
  next: ScoringConfig,
  clock: Clock,
): RescoreImpact {
  const changesScores = !sameScoringKey(scoringKeyOf(current), scoringKeyOf(next));
  if (!changesScores) return { changesScores, staleIfSaved: 0, estimatedUsd: 0, basis: null };
  const staleIfSaved = currentScoreCount(db, clock, current);
  const basis = costPerScore(db, clock, current.criteria.llm.scoring_model);
  return {
    changesScores,
    staleIfSaved,
    estimatedUsd: basis === null ? null : staleIfSaved * basis.perScoreUsd,
    basis,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
