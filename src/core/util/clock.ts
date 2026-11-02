/**
 * A `Clock` supplies the current time. All "now" reads in core go through a
 * clock so tests can control time deterministically (ARCHITECTURE § Data model).
 */
export interface Clock {
  /** Current time as an ISO-8601 string in UTC, e.g. `2026-10-22T23:15:00.000Z`. */
  now(): string;
  /** Current time as epoch milliseconds. */
  nowMs(): number;
}

/** The real system clock. */
export const systemClock: Clock = {
  now: () => new Date().toISOString(),
  nowMs: () => Date.now(),
};

/**
 * A clock fixed at a given instant, for tests. `advance(ms)` moves it forward.
 */
export function fixedClock(start: string | number | Date = 0): Clock & {
  advance(ms: number): void;
  set(value: string | number | Date): void;
} {
  let ms = new Date(start).getTime();
  return {
    now: () => new Date(ms).toISOString(),
    nowMs: () => ms,
    advance: (delta: number) => {
      ms += delta;
    },
    set: (value: string | number | Date) => {
      ms = new Date(value).getTime();
    },
  };
}
