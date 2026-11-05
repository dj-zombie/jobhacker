"use client";

import * as React from "react";

const useIsoLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

/** Changes closer together than this skip their acquire: J held down, or pressed fast. */
export const ACQUIRE_GAP_MS = 300;

/**
 * Runs `acquire` when `key` changes, unless the change came hard on the heels of
 * the last one. A burst of changes acquires once, on the last, after it settles;
 * `onBurst` runs on each change the burst skips. Runs on mount too. The returned
 * ref says whether the latest change was calm; it is set in a layout effect, so
 * passive effects of the same commit can read it.
 */
export function useAcquire(key: unknown, acquire: () => void, onBurst?: () => void): React.RefObject<boolean> {
  const at = React.useRef(Number.NEGATIVE_INFINITY);
  const calm = React.useRef(true);
  const timer = React.useRef<number | undefined>(undefined);
  const run = React.useRef(acquire);
  const skip = React.useRef(onBurst);
  run.current = acquire;
  skip.current = onBurst;

  useIsoLayoutEffect(() => {
    window.clearTimeout(timer.current);
    const now = performance.now();
    calm.current = now - at.current > ACQUIRE_GAP_MS;
    at.current = now;
    if (calm.current) {
      run.current();
      return;
    }
    skip.current?.();
    timer.current = window.setTimeout(() => run.current(), ACQUIRE_GAP_MS);
  }, [key]);

  React.useEffect(() => () => window.clearTimeout(timer.current), []);
  return calm;
}

/** Plays an element's one-shot CSS animations again from the start. */
export function replay(el: Element | null | undefined) {
  if (!el) return;
  for (const a of el.getAnimations()) {
    a.currentTime = 0;
    a.play();
  }
}
