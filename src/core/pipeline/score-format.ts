/** Model calls kept in flight during a score run (D178). */
export const SCORE_CONCURRENCY = 6;

/** Dollars and wall-clock seconds for one more scoring call, from runs already finished. */
export interface ScorePace {
  perScoreUsd: number | null;
  /**
   * Seconds of wall clock per job at `SCORE_CONCURRENCY`. A run that didn't
   * record a concurrency is treated as one-at-a-time, so its pace isn't
   * divided twice after the first overlapping batch. A run that scored fewer
   * jobs than it recorded in flight is scaled by that smaller number.
   */
  secondsEach: number | null;
}

/** "about 15 min", "about 3.7 hours". */
export function formatScoreDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 90) {
    const rounded = Math.max(1, Math.round(Number.isFinite(seconds) ? seconds : 0));
    return `about ${rounded} ${rounded === 1 ? 'second' : 'seconds'}`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `about ${minutes} min`;
  const hours = seconds / 3600;
  const rounded = hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours);
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `about ${text} ${rounded === 1 ? 'hour' : 'hours'}`;
}

/** The line a long run prints before its first model call. */
export function formatScorePlan(jobs: number, pace: ScorePace): string {
  const cost =
    pace.perScoreUsd === null ? 'cost unknown' : `about $${(jobs * pace.perScoreUsd).toFixed(2)}`;
  const time = pace.secondsEach === null ? null : formatScoreDuration(jobs * pace.secondsEach);
  const parts = [
    `up to ${jobs} ${jobs === 1 ? 'job' : 'jobs'}`,
    cost,
    ...(time ? [time] : []),
    `${SCORE_CONCURRENCY} at a time`,
  ];
  return parts.join(' · ');
}
