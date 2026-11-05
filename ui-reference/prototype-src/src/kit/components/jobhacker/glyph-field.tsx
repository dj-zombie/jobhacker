"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const CELL = 11;
/** Sparse to dense. The first is a space, so the troughs of the waves stay empty. */
const RAMP = " .,:~;r!*/x$0&";
const LEVELS = 6;

/**
 * A field of mono glyphs whose density follows four radial waves, fading out to
 * the left and the bottom. A scan beam crosses it on a loop and lights the glyphs
 * under it red.
 *
 * Both copies of the field, dim and lit, are drawn once per size. The beam is a
 * masked window moving one way over the lit copy, which moves the other way by
 * the same amount, so the glyphs hold still and the loop runs on the compositor.
 * The beam pauses while the field is off screen, and while `data-hold` is set on
 * it through `ref` (the header holds it while jobs change fast). It is hidden
 * under reduced motion.
 */
export function GlyphField({
  ref,
  seed = "jobhacker",
  className,
}: {
  ref?: React.Ref<HTMLDivElement>;
  seed?: string;
  className?: string;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const setRoot = React.useCallback(
    (el: HTMLDivElement | null) => {
      rootRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );
  const dimRef = React.useRef<HTMLCanvasElement>(null);
  const litRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let frame = 0;
    let drawn = "";
    const draw = (force = false) => {
      const w = root.clientWidth;
      const h = root.clientHeight;
      const size = `${w}x${h}`;
      if (!w || !h || (size === drawn && !force)) return;
      drawn = size;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const font = getComputedStyle(root).fontFamily;
      const cells = layout(w, h, seed);
      paint(dimRef.current, w, h, dpr, font, cells, DIM);
      paint(litRef.current, w, h, dpr, font, cells, LIT);
    };
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => draw());
    });
    ro.observe(root);
    const io = new IntersectionObserver(([entry]) => {
      if (entry) root.toggleAttribute("data-paused", !entry.isIntersecting);
    });
    io.observe(root);
    let live = true;
    document.fonts?.ready.then(() => live && draw(true));
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
    };
  }, [seed]);

  return (
    <div
      ref={setRoot}
      aria-hidden
      className={cn(
        "pointer-events-none absolute overflow-hidden font-mono [&[data-hold]_*]:[animation-play-state:paused] [&[data-paused]_*]:[animation-play-state:paused]",
        className,
      )}
    >
      <canvas ref={dimRef} className="absolute inset-0 size-full" />
      <div className="absolute inset-0 animate-beam mask-[linear-gradient(100deg,transparent_36%,black_47%,black_53%,transparent_64%)] motion-reduce:hidden">
        <div className="absolute inset-0 bg-[linear-gradient(100deg,transparent_40%,rgb(255_46_79/0.16)_50%,transparent_60%)]" />
        <canvas ref={litRef} className="absolute inset-0 size-full animate-beam-counter" />
        <i className="absolute -inset-y-6 left-1/2 w-0.5 rotate-[10deg] bg-[rgb(255_200_208)] shadow-[0_0_6px_1px_rgb(255_46_79),0_0_28px_6px_rgb(255_46_79/0.45)]" />
      </div>
    </div>
  );
}

type Cell = { x: number; y: number; ch: string; level: number };

function layout(w: number, h: number, seed: string): Cell[] {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  const phase = (k: number) => (((hash >>> (k * 8)) & 0xff) / 255) * Math.PI * 2;
  const ox = w * 0.74;
  const oy = h * 0.28;
  const cells: Cell[] = [];
  for (let y = CELL / 2; y < h; y += CELL) {
    for (let x = CELL / 2; x < w; x += CELL) {
      const d = Math.hypot(x - ox, y - oy);
      const wave =
        (Math.sin(d / 9 - phase(0)) +
          Math.sin(d / 23 + phase(1)) * 0.8 +
          Math.sin(Math.hypot(x - w * 0.15, y + h * 0.5) / 15 + phase(2)) * 0.6 +
          Math.sin(Math.hypot(x - w, y - h) / 31 + phase(3)) * 0.7) /
        3.1;
      const t = (wave + 1) / 2;
      const fade = smooth(0, 0.42, x / w) * (1 - smooth(0.45, 1, y / h));
      const v = t ** 1.4 * fade;
      const i = Math.min(RAMP.length - 1, Math.floor(v * RAMP.length));
      const ch = RAMP[i];
      if (!ch || ch === " ") continue;
      cells.push({ x, y, ch, level: Math.min(LEVELS - 1, Math.floor(v * LEVELS)) });
    }
  }
  return cells;
}

const DIM = Array.from({ length: LEVELS }, (_, l) => `rgb(255 214 222 / ${(0.09 + (l / (LEVELS - 1)) * 0.27).toFixed(3)})`);
const LIT = Array.from({ length: LEVELS }, (_, l) =>
  l >= LEVELS - 3 ? `rgb(255 232 236 / ${(0.8 + l * 0.04).toFixed(2)})` : `rgb(255 70 98 / ${(0.55 + l * 0.15).toFixed(2)})`,
);

function paint(
  canvas: HTMLCanvasElement | null,
  w: number,
  h: number,
  dpr: number,
  font: string,
  cells: Cell[],
  inks: string[],
) {
  if (!canvas) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = `500 9px ${font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let level = 0; level < LEVELS; level++) {
    ctx.fillStyle = inks[level] ?? "transparent";
    for (const c of cells) if (c.level === level) ctx.fillText(c.ch, c.x, c.y);
  }
}

function smooth(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
