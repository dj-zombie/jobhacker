"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** The monogram tile color for this company. Stable for a given name. */
export function companyTileColor(name: string): string {
  return `var(--color-tile-${(hash(name) % 8) + 1})`;
}

/** The monogram's letter. A leading "The" is skipped. */
export function companyInitial(name: string): string {
  return name.replace(/^the\s+/i, "").trim().charAt(0).toUpperCase() || "?";
}

/**
 * Company identity tile. Shows the logo when `src` is set and loads, otherwise a
 * monogram on a tile color picked deterministically from the company name, so
 * the same company always gets the same color.
 *
 * `src` is a Brandfetch Logo CDN URL. The browser loads it; nothing stores the file.
 * A failed `src` is remembered by value, so a later `src` can still load.
 * A server-rendered image that finished before hydration reports through the mount check,
 * because React does not fire `onLoad` or `onError` for it. `onStatus` fires at most once per `src`.
 */
export function CompanyLogo({
  name,
  src,
  size = 32,
  fluid = false,
  className,
  onStatus,
}: {
  name: string;
  src?: string | null;
  size?: number;
  /**
   * Fill the parent instead of drawing at `size`, which then only picks the corner radius.
   * The parent sets the size and must be an inline-size container, which scales the letter.
   */
  fluid?: boolean;
  className?: string;
  onStatus?: (status: "loaded" | "failed") => void;
}) {
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const imgRef = React.useRef<HTMLImageElement>(null);
  const reported = React.useRef<string | null>(null);
  const onStatusRef = React.useRef(onStatus);
  onStatusRef.current = onStatus;
  const radius = size >= 96 ? 18 : size >= 40 ? 11 : size >= 28 ? 8 : 6;
  const box = fluid ? "100%" : size;
  const failed = Boolean(src) && failedSrc === src;

  const report = React.useCallback((status: "loaded" | "failed", forSrc: string) => {
    if (reported.current === forSrc) return;
    reported.current = forSrc;
    onStatusRef.current?.(status);
  }, []);

  React.useEffect(() => {
    const img = imgRef.current;
    if (!src || !img || !img.complete) return;
    if (img.naturalWidth > 0) report("loaded", src);
    else {
      setFailedSrc(src);
      report("failed", src);
    }
  }, [src, report]);

  if (src && !failed) {
    return (
      <img
        ref={imgRef}
        src={src}
        alt=""
        width={size}
        height={size}
        decoding="async"
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={() => report("loaded", src)}
        onError={() => {
          setFailedSrc(src);
          report("failed", src);
        }}
        className={cn("shrink-0 bg-white object-cover", className)}
        style={{ width: box, height: box, borderRadius: radius, boxShadow: "var(--shadow-tile)" }}
      />
    );
  }

  const tile = companyTileColor(name);
  const initial = companyInitial(name);
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 select-none items-center justify-center font-semibold text-white", className)}
      style={{
        width: box,
        height: box,
        borderRadius: radius,
        fontSize: fluid ? "44cqi" : Math.round(size * 0.44),
        background: `linear-gradient(140deg, color-mix(in oklab, ${tile} 88%, white), color-mix(in oklab, ${tile} 70%, black))`,
        boxShadow: "var(--shadow-tile)",
      }}
    >
      {initial}
    </span>
  );
}
