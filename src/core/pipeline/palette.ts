import type { Bands, Weights } from '../config/schemas.js';
import type { Db } from '../db/client.js';
import type { Verdict } from '../db/schema.js';
import type { Clock } from '../util/clock.js';
import { rankJobs } from './rank.js';
import type { ScoringKey } from './score.js';
import { toDimensions } from './triage-view.js';
import { triageRows } from './triage.js';

/** How many jobs ⌘K lists. The reference palette shows the top 40 by the current ranking. */
export const PALETTE_LIMIT = 40;

export interface PaletteJobRow {
  id: number;
  title: string;
  company: string;
  locationRaw: string | null;
  remoteType: 'remote' | 'hybrid' | 'onsite' | 'unknown';
  score: number;
  verdict: Verdict;
  /** Areas the job is in. Empty means the current Where would hide it unless Where is Anywhere. */
  areas: string[];
}

/**
 * The top scored, untriaged jobs by the ranking in force, from anywhere. Where is not applied:
 * choosing one the current Where would hide switches the view to Anywhere (PLACES § 7).
 */
export function paletteJobs(
  db: Db,
  clock: Clock,
  options: { key: ScoringKey; weights: Weights; bands: Bands },
): PaletteJobRow[] {
  const rows = triageRows(db, clock, 'top', options.key).filter((row) => row.dims !== null);
  const ranked = rankJobs(
    rows.map((row) => ({
      ...row,
      dimensions: toDimensions(row.dims ?? []),
    })),
    options.weights,
    options.bands,
  );
  const out: PaletteJobRow[] = [];
  for (const row of ranked) {
    if (row.score === null) continue;
    out.push({
      id: row.jobId,
      title: row.title,
      company: row.company,
      locationRaw: row.locationRaw,
      remoteType: row.remoteType,
      score: row.score,
      verdict: row.verdict,
      areas: row.areas,
    });
    if (out.length >= PALETTE_LIMIT) break;
  }
  return out;
}
