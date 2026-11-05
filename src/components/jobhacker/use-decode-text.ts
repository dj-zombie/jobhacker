"use client";

import { useReducedMotion } from "motion/react";
import * as React from "react";

const GLYPHS = "!<>-_/\\[]{}=+*^?#%&01";
/** A new scramble every other frame reads as a flicker, not a blur. */
const STEP_MS = 32;

const useIsoLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

export interface DecodeTargets {
  /** The real text. Transparent while decoding, so it keeps its place and is still read. */
  real: React.RefObject<HTMLSpanElement | null>;
  /** The aria-hidden overlay, rendered `hidden`. */
  overlay: React.RefObject<HTMLSpanElement | null>;
  /** Inside the overlay, both rendered empty: the resolved part, then the scrambled rest. */
  resolved: React.RefObject<HTMLSpanElement | null>;
  scrambled: React.RefObject<HTMLSpanElement | null>;
}

/**
 * Scrambles `text` and resolves it left to right, once each time `text` changes. Attach the
 * returned refs. Each step writes to the DOM; React never re-renders for one, because on a
 * server-rendered page an update every frame interrupts hydration again and again. One
 * requestAnimationFrame loop per caller, cancelled by the next change or unmount. Reduced
 * motion, or `enabled` false, leaves the text as it is.
 */
export function useDecodeText(
  text: string,
  { duration = 360, enabled = true }: { duration?: number; enabled?: boolean } = {},
): DecodeTargets {
  const reduce = useReducedMotion();
  const live = enabled && !reduce;
  const real = React.useRef<HTMLSpanElement>(null);
  const overlay = React.useRef<HTMLSpanElement>(null);
  const resolved = React.useRef<HTMLSpanElement>(null);
  const scrambled = React.useRef<HTMLSpanElement>(null);

  useIsoLayoutEffect(() => {
    const r = real.current;
    const o = overlay.current;
    const a = resolved.current;
    const b = scrambled.current;
    if (!r || !o || !a || !b) return;
    const stop = () => {
      o.hidden = true;
      a.textContent = "";
      b.textContent = "";
      r.style.color = "";
    };
    if (!live || text.length === 0) {
      stop();
      return;
    }
    const paint = (cut: number) => {
      a.textContent = text.slice(0, cut);
      b.textContent = scramble(text.slice(cut));
    };
    const start = performance.now();
    let raf = 0;
    let lastStep = -1;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      if (t >= 1) {
        stop();
        return;
      }
      const step = Math.floor((now - start) / STEP_MS);
      if (step !== lastStep) {
        lastStep = step;
        paint(Math.floor(t * text.length));
      }
      raf = requestAnimationFrame(tick);
    };
    r.style.color = "transparent";
    o.hidden = false;
    paint(0);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      stop();
    };
  }, [text, duration, live]);

  return React.useMemo(() => ({ real, overlay, resolved, scrambled }), []);
}

function scramble(s: string): string {
  let r = "";
  for (const ch of s) r += ch.trim() === "" ? ch : (GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? ch);
  return r;
}
