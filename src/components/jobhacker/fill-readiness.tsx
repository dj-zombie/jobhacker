"use client";

import { Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The headline of an application: how much of the form is done, what needs
 * a look, and whether it's ready to submit. Segments resize as answers are
 * approved.
 */
export function FillReadiness({
  filled,
  review,
  blank,
  requiredBlank = 0,
  resumeAttached,
  /** Set once the application has left preparation, so the headline is not "Ready to submit". */
  phase,
  className,
}: {
  filled: number;
  review: number;
  blank: number;
  /** How many of the blank fields the form requires. */
  requiredBlank?: number;
  resumeAttached: boolean;
  phase?: string;
  className?: string;
}) {
  const total = filled + review + blank;
  const done = filled + review;
  const ready = !phase && review === 0 && requiredBlank === 0 && resumeAttached;
  const headline = phase
    ? phase
    : review > 0
      ? `${review} drafted ${review === 1 ? "answer" : "answers"} to check before you submit`
      : !resumeAttached
        ? "Resume missing"
        : requiredBlank > 0
          ? `${requiredBlank} required ${requiredBlank === 1 ? "field" : "fields"} left for you`
          : "Ready to submit";
  const blankNote =
    requiredBlank === 0
      ? `The ${blank} left blank ${blank === 1 ? "is" : "are"} optional.`
      : requiredBlank === blank
        ? `The ${blank} left blank ${blank === 1 ? "is" : "are"} required.`
        : `${requiredBlank} of the ${blank} left blank ${requiredBlank === 1 ? "is" : "are"} required.`;
  const sub = blank > 0 ? `${done} of ${total} fields are filled. ${blankNote}` : `All ${total} fields are filled.`;

  const segs = [
    { key: "filled", n: filled, cls: "bg-strong", label: "Filled", dot: "bg-strong" },
    { key: "review", n: review, cls: "bg-maybe", label: "Drafted, needs a check", dot: "bg-maybe" },
    { key: "blank", n: blank, cls: "bg-surface-4", label: "Left blank", dot: "bg-fg-4" },
  ];

  return (
    <div className={cn("surface-card rounded-xl p-5 max-md:p-4", className)}>
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className={cn("text-lg font-semibold tracking-tight", ready ? "text-strong" : "text-fg")}>{headline}</div>
          <p className="mt-0.5 text-sm text-fg-2">{sub}</p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-semibold leading-none tracking-tighter tnum text-fg">
            {done}
            <span className="text-fg-4">/{total}</span>
          </div>
          <div className="mt-1 text-2xs text-fg-3">fields filled</div>
        </div>
      </div>

      <div className="mt-4 flex h-2 gap-0.5" role="img" aria-label={`${filled} filled, ${review} need review, ${blank} blank`}>
        {segs.map((s) => (
          <div
            key={s.key}
            className={cn(
              "h-full rounded-full transition-[flex-grow] duration-500 ease-out-expo first:rounded-l-full",
              s.cls,
            )}
            style={{ flexGrow: s.n, flexBasis: 0, minWidth: s.n > 0 ? 6 : 0 }}
          />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-fg-3">
        {segs.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", s.dot)} />
            {s.label}
            <b className="font-semibold tnum text-fg">{s.n}</b>
          </span>
        ))}
        <span className={cn("inline-flex items-center gap-1.5", resumeAttached ? "text-fg-2" : "text-danger")}>
          <Paperclip className="size-3.5" />
          {resumeAttached ? "Resume attached" : "Resume missing"}
        </span>
      </div>
    </div>
  );
}
