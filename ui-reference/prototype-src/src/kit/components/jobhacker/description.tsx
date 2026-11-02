"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DescriptionBlock } from "./types";

const URL_RE = /\s*\(?https?:\/\/[^\s)]+\)?/g;

/**
 * Turn a posting's plain-text description into structured blocks.
 * "- item" lines become lists, short label-like lines become headings, and
 * raw URLs that follow their own link text are dropped.
 */
/** A single newline mid-sentence is a wrap. A blank line, a bullet, or a short label stays a break. */
function unwrapLines(text: string): string[] {
  const raw = text.split(/\r?\n/).map((l) => l.replace(URL_RE, "").trim());
  const lines: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    let line = raw[i] ?? "";
    if (!line) {
      lines.push("");
      continue;
    }
    while (continues(line, raw[i + 1])) {
      i += 1;
      line = `${line} ${raw[i] ?? ""}`.trim();
    }
    lines.push(line);
  }
  return lines;
}

function continues(line: string, next: string | undefined): boolean {
  if (!next) return false;
  if (/[.!?:,;]$/.test(line)) return false;
  if (/^[-•*·]\s/.test(next)) return false;
  if (line.length < 56 && next.length > line.length + 20) return false;
  return true;
}

export function parseDescription(text: string): DescriptionBlock[] {
  const blocks: DescriptionBlock[] = [];
  let list: string[] | null = null;
  const lines = unwrapLines(text);

  const flush = () => {
    if (list?.length) blocks.push({ type: "list", items: list });
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line) {
      flush();
      continue;
    }
    const bullet = line.match(/^[-•*·]\s+(.*)$/);
    if (bullet) {
      if (!list) list = [];
      list.push(bullet[1] ?? "");
      continue;
    }
    flush();
    const next = lines[i + 1] ?? "";
    const looksLikeHeading =
      line.length < 56 &&
      !/[.!?:,;]$/.test(line) &&
      (/^[-•*·]\s/.test(next) || next.length > line.length + 20);
    blocks.push(looksLikeHeading ? { type: "heading", text: line } : { type: "paragraph", text: line });
  }
  flush();
  return blocks;
}

export function DescriptionBlocks({ blocks }: { blocks: DescriptionBlock[] }) {
  // Keys come from content; a repeated block gets a numeric suffix so keys stay unique.
  const seen = new Map<string, number>();
  const keyFor = (base: string) => {
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}#${n}` : base;
  };
  return (
    <div className="break-words text-sm leading-relaxed text-fg-2">
      {blocks.map((b) => {
        if (b.type === "heading")
          return (
            <h4 key={keyFor(`h:${b.text}`)} className="mb-1.5 mt-5 text-sm font-semibold text-fg first:mt-0">
              {b.text}
            </h4>
          );
        if (b.type === "paragraph")
          return (
            <p key={keyFor(`p:${b.text}`)} className="mb-3 max-w-[68ch] last:mb-0">
              {b.text}
            </p>
          );
        const itemSeen = new Map<string, number>();
        return (
          <ul key={keyFor(`l:${b.items.join("|")}`)} className="mb-3 max-w-[68ch] space-y-1.5 last:mb-0">
            {b.items.map((item) => {
              const n = itemSeen.get(item) ?? 0;
              itemSeen.set(item, n + 1);
              return (
                <li key={n ? `${item}#${n}` : item} className="flex gap-2.5">
                  <span aria-hidden className="mt-[0.6em] size-1 shrink-0 rounded-full bg-fg-4" />
                  <span className="min-w-0 break-words">{item}</span>
                </li>
              );
            })}
          </ul>
        );
      })}
    </div>
  );
}

/** Clips tall content with a fade and a "show more" control. */
export function Collapsible({
  maxHeight = 320,
  moreLabel = "Show full description",
  lessLabel = "Show less",
  children,
}: {
  maxHeight?: number;
  moreLabel?: string;
  lessLabel?: string;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [full, setFull] = React.useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the content changes
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      setFull(el.scrollHeight);
      setOverflows(el.scrollHeight > maxHeight + 40);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxHeight, children]);

  const clipped = overflows && !open;
  return (
    <div>
      <div
        ref={ref}
        className="overflow-hidden transition-[max-height] duration-300 ease-out-expo"
        style={{
          maxHeight: overflows ? (open ? full : maxHeight) : undefined,
          maskImage: clipped ? "linear-gradient(to bottom, black 70%, transparent)" : undefined,
          WebkitMaskImage: clipped ? "linear-gradient(to bottom, black 70%, transparent)" : undefined,
        }}
      >
        {children}
      </div>
      {overflows ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-3 inline-flex items-center gap-1 rounded-md text-xs font-medium text-brand-hi hover:text-fg"
        >
          {open ? lessLabel : moreLabel}
          <ChevronDown className={cn("size-3.5 transition-transform duration-200", open && "rotate-180")} />
        </button>
      ) : null}
    </div>
  );
}
