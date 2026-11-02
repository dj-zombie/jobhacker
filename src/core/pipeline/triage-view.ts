import { DIMENSIONS } from '../config/schemas.js';
import type { Dimensions, JobStatus } from '../db/schema.js';

export type { JobStatus };

/**
 * Which triage view a job belongs to, with no database access, so the client applies the same
 * rule to its rows after a triage action as the server applied to build them (`triage.ts`).
 */

export const TRIAGE_VIEWS = ['top', 'new', 'shortlist', 'unscored'] as const;
export type TriageView = (typeof TRIAGE_VIEWS)[number];

/** Job statuses that haven't been triaged by a human. */
export const UNTRIAGED: readonly JobStatus[] = ['new', 'unscored', 'scored'];

/** New today: first seen by a scout within this many hours. */
export const NEW_WITHIN_HOURS = 24;

/** The six dimension scores in `DIMENSIONS` order, each 0–5 or null. */
export type DimScores = (number | null)[];

export function dimScores(dimensions: Dimensions): DimScores {
  return DIMENSIONS.map((d) => dimensions[d].score);
}

/** Scores back into the shape `rank.ts` takes. Reasons aren't needed to rank. */
export function toDimensions(scores: DimScores): Dimensions {
  return Object.fromEntries(
    DIMENSIONS.map((d, i) => [d, { score: scores[i] ?? null, reason: '' }]),
  ) as Dimensions;
}

export function newSince(nowMs: number): string {
  return new Date(nowMs - NEW_WITHIN_HOURS * 3_600_000).toISOString();
}

/**
 * Whether a job belongs to a view. `dims` is null unless scored under the current key. Jobs with
 * an application never reach this: they've left triage.
 */
export function inView(
  view: TriageView,
  row: { status: JobStatus; dims: DimScores | null; firstSeenAt: string },
  since: string,
): boolean {
  if (view === 'shortlist') return row.status === 'shortlisted';
  if (!UNTRIAGED.includes(row.status)) return false;
  if (view === 'top') return row.dims !== null;
  if (view === 'new') return row.firstSeenAt >= since;
  return row.dims === null;
}

/** Empty `where` means Anywhere. */
export function inWhere(areas: readonly string[], where: readonly string[]): boolean {
  return where.length === 0 || areas.some((area) => where.includes(area));
}
