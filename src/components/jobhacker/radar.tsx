"use client";

import { useInView } from "motion/react";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A small radar: two rings, a crosshair, a sweep that turns, and two blips that ping.
 * One live indicator. It animates only while it's on screen, and only transform and
 * opacity; `still` draws it without motion. Reduced motion leaves it still too.
 * Children sit in the middle, e.g. an empty state's icon.
 */
export function RadarSweep({
  still = false,
  className,
  children,
}: {
  still?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(ref);
  const live = inView && !still;
  return (
    <span
      ref={ref}
      className={cn(
        "relative inline-flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-brand/45",
        "bg-[radial-gradient(circle,var(--color-brand-wash),transparent_70%)]",
        className,
      )}
    >
      <span aria-hidden className="absolute inset-[22%] rounded-full border border-brand/25" />
      <span aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-brand/20" />
      <span aria-hidden className="absolute inset-y-0 left-1/2 w-px bg-brand/20" />
      <span
        aria-hidden
        className={cn(
          "absolute inset-0 rounded-full bg-[conic-gradient(from_0deg,transparent_0deg_270deg,var(--color-brand-hi)_360deg)]",
          live ? "animate-radar opacity-55" : "opacity-25",
        )}
      />
      <Blip className="left-[64%] top-[28%]" live={live} />
      <Blip className="left-[30%] top-[62%] [--ping-delay:1.2s]" live={live} />
      {children ? <span className="relative">{children}</span> : null}
    </span>
  );
}

function Blip({ className, live }: { className: string; live: boolean }) {
  return (
    <span aria-hidden className={cn("absolute size-1 rounded-full bg-brand-hi", className)}>
      <span
        className={cn(
          "absolute inset-0 rounded-full bg-brand-hi opacity-0 [animation-delay:var(--ping-delay,0s)]",
          live && "animate-ping",
        )}
      />
    </span>
  );
}
