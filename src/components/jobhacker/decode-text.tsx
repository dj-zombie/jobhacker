"use client";

import { cn } from "@/lib/utils";
import { useDecodeText } from "./use-decode-text";

/**
 * Text that decodes from scrambled glyphs once, each time it changes. The real text
 * keeps its place in the layout (transparent while decoding, so screen readers still
 * read it), and the scramble is drawn over it, so nothing shifts. The parent must be
 * positioned, and should truncate if it can't wrap.
 */
export function DecodeText({
  text,
  duration,
  className,
}: {
  text: string;
  duration?: number;
  className?: string;
}) {
  const t = useDecodeText(text, { duration });
  return (
    <>
      <span ref={t.real} className={className}>
        {text}
      </span>
      <span
        ref={t.overlay}
        aria-hidden
        hidden
        className={cn("pointer-events-none absolute inset-0 truncate", className)}
      >
        <span ref={t.resolved} />
        <span ref={t.scrambled} className="text-brand-hi" />
      </span>
    </>
  );
}
