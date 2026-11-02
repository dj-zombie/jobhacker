/**
 * What a scout writes to `runs.stats` while it is still going (J8, the same shape J5 uses for a
 * score batch). The card polls it. A finished run replaces this with its `ScoutStats`.
 */

export interface ScoutProgress {
  done: number;
  total: number;
  found: number;
  /** "Board" while boards are fetched, "Scoring" while the model runs. */
  unit: 'Board' | 'Scoring';
}

export interface ScoutBeat {
  progress: ScoutProgress;
  beatAt: string;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The progress object on an open scout run, or null when the row holds finished stats. */
export function parseScoutProgress(stats: unknown): ScoutProgress | null {
  if (!stats || typeof stats !== 'object') return null;
  const progress = (stats as { progress?: unknown }).progress;
  if (!progress || typeof progress !== 'object') return null;
  const p = progress as Record<string, unknown>;
  const done = num(p.done);
  const total = num(p.total);
  const found = num(p.found);
  if (done === null || total === null || found === null) return null;
  const unit = p.unit === 'Scoring' ? 'Scoring' : 'Board';
  return { done, total, found, unit };
}
