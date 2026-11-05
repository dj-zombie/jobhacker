import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Where a lock sits, in px inside its positioned parent. The top corners sit `top` down; the
 * bottom ones `height` below that. Left corners sit `left` in from the left edge and right
 * corners `right` in from the right edge, so a full-width target needs no measuring.
 */
export type LockBox = { top: number; height: number; left?: number; right?: number };

/**
 * A target lock: four white corner brackets around one target at a time. It is a single element
 * with four children however many targets there are, and it moves by transform only. Give the
 * parent `position: relative`; move the lock with `lockTo`.
 */
export function TargetLock({
  ref,
  corner = 10,
  weight = 1.5,
  className,
}: {
  ref?: React.Ref<HTMLDivElement>;
  /** Length of each bracket arm in px. */
  corner?: number;
  /** Stroke width in px. */
  weight?: number;
  className?: string;
}) {
  const arm = "absolute top-0 border-solid border-white/90 will-change-transform";
  return (
    <div
      ref={ref}
      aria-hidden
      data-corner={corner}
      className={cn(
        "pointer-events-none absolute inset-0 z-10 opacity-0 transition-opacity duration-300 data-[on]:opacity-100",
        "[&>i]:transition-transform [&>i]:duration-[var(--lock-ms,450ms)] [&>i]:ease-spring [&[data-still]>i]:transition-none",
        className,
      )}
      style={{ ["--lock-arm" as string]: `${corner}px`, ["--lock-w" as string]: `${weight}px` }}
    >
      <i className={cn(arm, "left-0 size-(--lock-arm) border-t-(length:--lock-w) border-l-(length:--lock-w)")} />
      <i className={cn(arm, "right-0 size-(--lock-arm) border-t-(length:--lock-w) border-r-(length:--lock-w)")} />
      <i className={cn(arm, "left-0 size-(--lock-arm) border-b-(length:--lock-w) border-l-(length:--lock-w)")} />
      <i className={cn(arm, "right-0 size-(--lock-arm) border-b-(length:--lock-w) border-r-(length:--lock-w)")} />
    </div>
  );
}

function place(lock: HTMLElement, box: LockBox, out = 0) {
  const arm = Number(lock.dataset.corner ?? 10);
  const [tl, tr, bl, br] = Array.from(lock.children) as HTMLElement[];
  if (!tl || !tr || !bl || !br) return;
  const left = (box.left ?? 0) - out;
  const right = (box.right ?? 0) - out;
  const top = box.top - out;
  const bottom = box.top + box.height - arm + out;
  tl.style.transform = `translate(${left}px, ${top}px)`;
  tr.style.transform = `translate(${-right}px, ${top}px)`;
  bl.style.transform = `translate(${left}px, ${bottom}px)`;
  br.style.transform = `translate(${-right}px, ${bottom}px)`;
}

/**
 * Moves a lock to `box` and shows it. By default it glides from wherever it is on a spring.
 * `from` starts it at another box (the viewfinder's corners, say) and flies it in; `spread`
 * starts it that many px outside the target and snaps it in; `instant` just puts it there.
 * Only `from`, `spread` and `instant` force a layout, to commit the start position.
 */
export function lockTo(
  lock: HTMLElement | null,
  box: LockBox,
  how: { from?: LockBox; spread?: number; instant?: boolean } = {},
) {
  if (!lock) return;
  lock.dataset.on = "";
  if (how.instant || how.from || how.spread) {
    lock.dataset.still = "";
    if (how.from) place(lock, how.from);
    else place(lock, box, how.spread ?? 0);
    void lock.offsetWidth;
    delete lock.dataset.still;
    if (how.instant) return;
  }
  place(lock, box);
}

/** Hides a lock where it is. */
export function releaseLock(lock: HTMLElement | null) {
  if (lock) delete lock.dataset.on;
}

/** The box of `el` inside `parent`, for `lockTo`. Forces a layout: call it on events, not per frame. */
export function boxIn(el: HTMLElement, parent: HTMLElement, pad = 0): LockBox {
  const a = el.getBoundingClientRect();
  const p = parent.getBoundingClientRect();
  const left = p.left + parent.clientLeft;
  const top = p.top + parent.clientTop;
  return {
    top: a.top - top + parent.scrollTop - pad,
    height: a.height + pad * 2,
    left: a.left - left - pad,
    right: left + parent.clientWidth - a.right - pad,
  };
}
