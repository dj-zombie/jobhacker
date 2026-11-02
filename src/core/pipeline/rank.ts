import { type Bands, DIMENSIONS, type Dimension, type Weights } from '../config/schemas.js';
import type { Dimensions, Verdict } from '../db/schema.js';

/**
 * Ranking (FR-5a). Pure: the LLM supplies per-dimension 0–5 scores once, and
 * the 0–100 score and verdict are recomputed here from the current weights and
 * bands on every read. Changing weights never costs an LLM call.
 *
 *   base = Σ(w_d × s_d) / Σ(w_d over dimensions with a score) × 20
 *
 * A null dimension ("not stated", e.g. pay) drops out of both sums, so it is
 * neither a penalty nor a bonus. A known impossibility stays visible but caps
 * the local score: 0 in role/seniority/logistics → `no`; 1 → below `strong`.
 */

export const CRITICAL_DIMENSIONS = [
  'role_fit',
  'seniority_fit',
  'logistics_fit',
] as const satisfies readonly Dimension[];
export type CriticalDimension = (typeof CRITICAL_DIMENSIONS)[number];

export interface CriticalCap {
  /** The lowest known score among critical dimensions (only 0 or 1 creates a cap). */
  level: 0 | 1;
  dimensions: CriticalDimension[];
  /** Maximum final score allowed by this cap. */
  maxScore: number;
}

export interface RankComputation {
  baseScore: number | null;
  score: number | null;
  cap: CriticalCap | null;
}

export interface DimensionContribution {
  dimension: (typeof DIMENSIONS)[number];
  weight: number;
  score: number | null;
  /** weight × score, or null when the dimension is unknown. */
  weighted: number | null;
}

/** Uncapped 0–100 weighted mean, or null when no weighted dimension has a score. */
export function baseRankScore(dims: Dimensions, weights: Weights): number | null {
  let numerator = 0;
  let denominator = 0;
  for (const d of DIMENSIONS) {
    const s = dims[d].score;
    if (s === null) continue;
    numerator += weights[d] * s;
    denominator += weights[d];
  }
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 20);
}

/** The strongest critical-dimension cap, independent of its configured weight. */
export function criticalCap(dims: Dimensions, bands: Bands): CriticalCap | null {
  for (const level of [0, 1] as const) {
    const dimensions = CRITICAL_DIMENSIONS.filter((d) => dims[d].score === level);
    if (dimensions.length > 0) {
      return {
        level,
        dimensions,
        maxScore: level === 0 ? bands.maybe - 1 : bands.strong - 1,
      };
    }
  }
  return null;
}

/** Base score plus the local critical-dimension cap used for ranking and explanation. */
export function computeRank(dims: Dimensions, weights: Weights, bands: Bands): RankComputation {
  const baseScore = baseRankScore(dims, weights);
  const cap = criticalCap(dims, bands);
  return {
    baseScore,
    score: baseScore === null || cap === null ? baseScore : Math.min(baseScore, cap.maxScore),
    cap,
  };
}

/** Final capped score. */
export function rankScore(dims: Dimensions, weights: Weights, bands: Bands): number | null {
  return computeRank(dims, weights, bands).score;
}

export function verdictFor(score: number | null, bands: Bands): Verdict {
  if (score === null) return 'no';
  if (score >= bands.strong) return 'strong';
  if (score >= bands.maybe) return 'maybe';
  return 'no';
}

export function contributions(dims: Dimensions, weights: Weights): DimensionContribution[] {
  return DIMENSIONS.map((d) => {
    const s = dims[d].score;
    return {
      dimension: d,
      weight: weights[d],
      score: s,
      weighted: s === null ? null : weights[d] * s,
    };
  });
}

export interface Rankable {
  jobId: number;
  dimensions: Dimensions;
}

export type Ranked<T extends Rankable> = T &
  RankComputation & {
    verdict: Verdict;
  };

/** Score, band and sort: best first, unscorable last, ties by job id for stability. */
export function rankJobs<T extends Rankable>(
  rows: readonly T[],
  weights: Weights,
  bands: Bands,
): Ranked<T>[] {
  return rows
    .map((row) => {
      const computed = computeRank(row.dimensions, weights, bands);
      return { ...row, ...computed, verdict: verdictFor(computed.score, bands) };
    })
    .sort((a, b) => {
      if (a.score === b.score) return a.jobId - b.jobId;
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      return b.score - a.score;
    });
}
