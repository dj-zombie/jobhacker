"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, CircleCheck, CircleDashed, Copy, Pencil, Plus, TriangleAlert, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Hint } from "./hint";
import type { FieldSource, FillField } from "./types";

const SOURCE_LABEL: Record<FieldSource, string> = {
  profile: "Profile",
  drafted: "Drafted",
  resume: "Resume",
  "cover-note": "Cover note",
  "self-id": "Self-ID",
};

const SOURCE_DETAIL: Record<Exclude<FieldSource, "drafted">, string> = {
  profile: "From your profile or your standard answers.",
  resume: "Your resume file, attached to the form.",
  "cover-note": "Your cover note, attached or pasted.",
  "self-id": "From the self-identification answers in your profile, exactly as written.",
};

function SourceChip({ source, state }: { source?: FieldSource; state?: FillField["state"] }) {
  if (!source) return null;
  const detail =
    source !== "drafted"
      ? SOURCE_DETAIL[source]
      : state === "review"
        ? "Drafted for this form's question. Check it before you submit."
        : "Drafted for this form's question, and approved by you.";
  return (
    <Hint label={SOURCE_LABEL[source]} detail={detail}>
      <span
        className={cn(
          "inline-flex h-5 shrink-0 items-center rounded-full px-1.5 text-2xs font-medium ring-1 ring-inset",
          source === "drafted" ? "bg-brand-wash text-brand-hi ring-brand/25" : "bg-surface-3 text-fg-3 ring-line-2",
        )}
      >
        {SOURCE_LABEL[source]}
      </span>
    </Hint>
  );
}

function Group({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
        {icon}
        {title}
        <span className="font-mono text-2xs font-normal tnum text-fg-3">{count}</span>
      </h3>
      {children}
    </section>
  );
}

function CopyButton({ value, label, onCopy }: { value: string; label: string; onCopy?: (v: string) => void }) {
  const [done, setDone] = React.useState(false);
  return (
    <Hint label={done ? "Copied" : `Copy ${label}`} side="left">
      <button
        type="button"
        aria-label={`Copy ${label}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
          } catch {
            /* clipboard can be refused; the toast still confirms intent */
          }
          onCopy?.(value);
          setDone(true);
          window.setTimeout(() => setDone(false), 1200);
        }}
        className="inline-flex size-7 max-md:size-10 shrink-0 items-center justify-center rounded-md text-fg-3 opacity-100 transition-[opacity,background-color] hover:bg-surface-4 hover:text-fg md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100"
      >
        {done ? <Check className="size-3.5 text-strong" /> : <Copy className="size-3.5" />}
      </button>
    </Hint>
  );
}

/**
 * What "Open & fill" wrote into the form, grouped by what Kris has to do:
 * review drafted answers, decide on blanks, and glance at the rest. An
 * approved answer moves from the review group into the filled list.
 */
export function FillReport({
  fields,
  onApprove,
  onEdit,
  onAddAnswer,
  onCopy,
  selfIdNote = "This form has no self-identification questions.",
}: {
  fields: FillField[];
  onApprove?: (id: string) => void;
  onEdit?: (id: string) => void;
  onAddAnswer?: (id: string) => void;
  onCopy?: (value: string) => void;
  selfIdNote?: string;
}) {
  const review = fields.filter((f) => f.state === "review");
  const blank = fields.filter((f) => f.state === "blank");
  const filled = fields.filter((f) => f.state === "filled" && f.source !== "self-id");
  const selfId = fields.filter((f) => f.source === "self-id");

  return (
    <div className="space-y-6">
      {review.length > 0 ? (
        <Group icon={<TriangleAlert className="size-4 text-maybe" />} title="Needs your review" count={review.length}>
          <div className="space-y-2.5">
            <AnimatePresence initial={false} mode="popLayout">
              {review.map((f) => (
                <motion.div
                  key={f.id}
                  layoutId={`field-${f.id}`}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 420, damping: 38 }}
                  className="chamfer relative rounded-xl border border-maybe/25 bg-maybe-wash/50 p-4 [--chamfer-edge:color-mix(in_oklab,var(--color-maybe)_40%,transparent)]"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-sm font-medium text-fg">{f.label}</span>
                    <SourceChip source={f.source} state={f.state} />
                    {f.required ? <span className="text-2xs text-danger">Required</span> : null}
                  </div>
                  <blockquote className="mt-2.5 max-h-48 overflow-y-auto rounded-lg border border-line bg-surface-1 p-3 text-sm leading-relaxed whitespace-pre-line text-fg-2">
                    {f.value}
                  </blockquote>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="positive" onClick={() => onApprove?.(f.id)}>
                      <Check />
                      Looks good
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onEdit?.(f.id)}>
                      <Pencil />
                      Edit answer
                    </Button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </Group>
      ) : null}

      {blank.length > 0 ? (
        <Group icon={<CircleDashed className="size-4 text-fg-3" />} title="Left blank" count={blank.length}>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface-1">
            {blank.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-fg">{f.label}</div>
                  <div className="text-xs text-fg-3">
                    {f.note ?? "No answer in your profile"}
                    {f.required ? <span className="text-danger"> · required</span> : " · optional"}
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => onAddAnswer?.(f.id)}>
                  <Plus />
                  Add answer
                </Button>
              </li>
            ))}
          </ul>
        </Group>
      ) : null}

      <Group icon={<CircleCheck className="size-4 text-strong" />} title="Filled" count={filled.length}>
        <ul className="overflow-hidden rounded-xl border border-line bg-surface-1">
          <AnimatePresence initial={false}>
            {filled.map((f) => (
              <motion.li
                key={f.id}
                layoutId={`field-${f.id}`}
                transition={{ type: "spring", stiffness: 420, damping: 38 }}
                className="group flex items-center gap-3 border-b border-line px-3.5 py-2 transition-colors last:border-b-0 hover:row-wash"
              >
                <CircleCheck className="size-4 shrink-0 text-strong" />
                <span className="w-44 shrink-0 truncate text-sm text-fg-2 max-sm:w-28">{f.label}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-fg">{f.value}</span>
                <SourceChip source={f.source} state={f.state} />
                {f.value ? <CopyButton value={f.value} label={f.label} onCopy={onCopy} /> : <span className="size-7" />}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </Group>

      <Group icon={<UserRound className="size-4 text-fg-3" />} title="Self-identification" count={selfId.length}>
        {selfId.length ? (
          <ul className="overflow-hidden rounded-xl border border-line bg-surface-1">
            {selfId.map((f) => (
              <li key={f.id} className="flex items-center gap-3 border-b border-line px-3.5 py-2 last:border-b-0">
                <CircleCheck className="size-4 shrink-0 text-strong" />
                <span className="w-44 shrink-0 truncate text-sm text-fg-2">{f.label}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-fg">{f.value}</span>
                <SourceChip source="self-id" />
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-line-2 px-3.5 py-3 text-sm text-fg-3">{selfIdNote}</p>
        )}
      </Group>
    </div>
  );
}
