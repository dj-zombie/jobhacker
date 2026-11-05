"use client";

import type * as React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Kbd } from "./kbd";

const MODIFIERS = new Set(["⌘", "⌃", "⌥", "⇧"]);

/**
 * Key caps for a shortcut. "S" stays one key. "⌘B", "⌘ K" and "⌘+K" become two.
 * Anything else, including a word, stays one cap.
 */
export function shortcutKeys(shortcut: string): string[] {
  const trimmed = shortcut.trim();
  if (!trimmed) return [];
  if (trimmed.includes("+")) {
    return trimmed
      .split("+")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }
  const chars = [...trimmed].filter((char) => char !== " ");
  const first = chars[0];
  if (chars.length === 2 && first !== undefined && MODIFIERS.has(first)) return chars;
  return [trimmed];
}

function shown(value: React.ReactNode): boolean {
  return value != null && value !== "";
}

/**
 * One tooltip: a label, an optional shortcut, and one line of context.
 * The child is the trigger, so pass the control itself. A `disabled` button
 * never receives hover or focus; keep it enabled and ignore the click instead.
 */
export function Hint({
  label,
  shortcut,
  meta,
  detail,
  side,
  align,
  children,
}: {
  /** The action or the name. */
  label: React.ReactNode;
  /** Drawn as key caps. "S", "⌘B" or "⌘+K". */
  shortcut?: string;
  /** A count or other short fact, on the same line as the label. */
  meta?: React.ReactNode;
  /** One sentence under the label: a date, or why the control is what it is. */
  detail?: React.ReactNode;
  side?: React.ComponentProps<typeof TooltipContent>["side"];
  align?: React.ComponentProps<typeof TooltipContent>["align"];
  children: React.ReactElement;
}) {
  const keys = shortcut ? shortcutKeys(shortcut) : [];
  const hasMeta = shown(meta);
  const hasDetail = shown(detail);
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} align={align}>
        <span className={cn("flex items-center gap-2", hasDetail && "font-medium")}>
          <span className={cn("min-w-0", (hasMeta || keys.length > 0) && "whitespace-nowrap")}>{label}</span>
          {hasMeta ? <span className="shrink-0 tnum text-fg-3">{meta}</span> : null}
          {keys.length > 0 ? (
            <span className="ml-auto flex shrink-0 items-center gap-0.5">
              {keys.map((key) => (
                <Kbd key={key} className="h-4 min-w-4 border-line-3 bg-surface-4 text-fg-2 shadow-none">
                  {key}
                </Kbd>
              ))}
            </span>
          ) : null}
        </span>
        {hasDetail ? (
          <span className="mt-0.5 block max-w-56 text-pretty text-2xs leading-relaxed text-fg-3">{detail}</span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}
