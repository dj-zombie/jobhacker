import type { Bands, Criteria, Weights } from '../config/schemas.js';
import type { Db } from '../db/client.js';
import { type ListFilters, type ScoredRow, scoresRepo } from '../db/repo/scores.js';
import type { Verdict } from '../db/schema.js';
import type { Clock } from '../util/clock.js';
import { companyOnList } from '../util/company-match.js';
import { type Ranked, rankJobs } from './rank.js';
import type { ScoringKey } from './score.js';

/**
 * The ranked queue (FR-6): scored jobs re-ranked with the given weights on
 * every read. Reads only; never calls the LLM. A row is `stale` when its score
 * was produced under a different rubric, model, profile or preferences than the
 * current ones, so it may change on the next `score` run.
 */

export type RankedRow = Ranked<ScoredRow> & { stale: boolean };

export interface RankedOptions extends ListFilters {
  verdict?: Verdict;
  limit?: number;
}

export interface RankingConfig {
  weights: Weights;
  bands: Bands;
  /** The current scoring key; omit to skip the stale check. */
  current?: ScoringKey;
  /** Listed companies. Absent or empty: no rank bump (J27). */
  targetCompanies?: readonly string[];
}

/** The saved weights, bands and company list, with a live weight or band override. */
export function rankingOf(
  criteria: Pick<Criteria, 'weights' | 'bands' | 'target_companies'>,
  extra: { current?: ScoringKey; weights?: Weights; bands?: Bands } = {},
): RankingConfig {
  return {
    weights: extra.weights ?? criteria.weights,
    bands: extra.bands ?? criteria.bands,
    current: extra.current,
    targetCompanies: criteria.target_companies ?? [],
  };
}

export function isStale(
  row: Pick<ScoredRow, keyof ScoringKey>,
  current: ScoringKey | undefined,
): boolean {
  if (!current) return false;
  return (
    row.rubricVersion !== current.rubricVersion ||
    row.model !== current.model ||
    row.profileHash !== current.profileHash ||
    row.preferencesHash !== current.preferencesHash
  );
}

export function rankedList(
  db: Db,
  clock: Clock,
  config: RankingConfig,
  options: RankedOptions = {},
): RankedRow[] {
  const { verdict, limit, ...filters } = options;
  const list = config.targetCompanies ?? [];
  const ranked = rankJobs(
    scoresRepo(db, clock)
      .scoredRows(filters)
      .map((row) => ({
        ...row,
        target: companyOnList(row.company, list) !== null,
      })),
    config.weights,
    config.bands,
  )
    .filter((row) => !verdict || row.verdict === verdict)
    .map((row) => ({ ...row, stale: isStale(row, config.current) }));
  return limit != null ? ranked.slice(0, limit) : ranked;
}
