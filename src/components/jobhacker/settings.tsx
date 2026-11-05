"use client";

import { ChevronRight, CircleAlert, RefreshCcw, Save, TriangleAlert, X } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Hint } from "./hint";

const ring =
  "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-uv-hi";

/** Text fields in Settings. Add `h-9` for an input, or `py-2 leading-relaxed resize-y` for a textarea. */
/** Ligatures off: a field shows the characters in the file, so `-->` doesn't draw as an arrow. */
export const settingsFieldClass =
  "w-full rounded-lg border border-line-2 bg-surface-1 px-3 text-sm text-fg outline-none transition-colors [font-variant-ligatures:none] placeholder:text-fg-4 focus:border-brand/60 focus:bg-surface-2 aria-invalid:border-danger/70";

export interface SettingsTab {
  href: string;
  label: string;
}

/** The Settings sections, as links. The active one carries the same lit underline as `Segmented`. */
export function SettingsTabs({
  tabs,
  activeHref,
  className,
}: {
  tabs: SettingsTab[];
  activeHref: string;
  className?: string;
}) {
  return (
    <nav
      aria-label="Settings sections"
      className={cn(
        "flex min-w-0 max-w-full flex-wrap items-center gap-0.5 rounded-lg border border-line bg-surface-1 p-0.5",
        className,
      )}
    >
      {tabs.map((tab) => {
        const active = tab.href === activeHref;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative inline-flex h-8 max-md:min-h-10 shrink-0 items-center whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors",
              ring,
              active ? "text-fg" : "text-fg-3 hover:text-fg-2",
            )}
          >
            {active ? (
              <motion.span
                layoutId="settings-tab"
                className="absolute inset-0 rounded-md bg-surface-3 shadow-hairline ring-1 ring-line-2"
                transition={{ type: "spring", stiffness: 560, damping: 42 }}
              >
                <span className="absolute inset-x-2.5 bottom-0 h-px bg-brand-hi shadow-neon" />
              </motion.span>
            ) : null}
            <span className="relative">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** A note in a section or under a field: an error, a flag, or plain information. Never color alone. */
export function SettingsNote({
  tone,
  id,
  children,
  className,
}: {
  tone: "error" | "flag" | "info";
  id?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const Icon = tone === "error" ? CircleAlert : tone === "flag" ? TriangleAlert : null;
  return (
    <p
      id={id}
      className={cn(
        "flex items-start gap-1.5 text-xs leading-relaxed",
        tone === "error" ? "text-danger" : tone === "flag" ? "text-maybe" : "text-fg-3",
        className,
      )}
    >
      {Icon ? <Icon aria-hidden className="mt-0.5 size-3.5 shrink-0" /> : null}
      <span className="min-w-0">
        {tone === "error" ? <span className="sr-only">Error: </span> : null}
        {tone === "flag" ? <span className="sr-only">Note: </span> : null}
        {children}
      </span>
    </p>
  );
}

/**
 * One labelled field. The container renders the input as `children`, with `id={htmlFor}`,
 * `aria-invalid` when there's an error, and `aria-describedby={describedBy(htmlFor, …)}`.
 */
export function SettingsField({
  label,
  htmlFor,
  hint,
  error,
  flag,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: React.ReactNode;
  error?: string | null;
  flag?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={htmlFor} className="mb-1 block text-xs text-fg-3">
        {label}
      </label>
      {children}
      {error ? (
        <SettingsNote tone="error" id={`${htmlFor}-error`} className="mt-1.5">
          {error}
        </SettingsNote>
      ) : null}
      {flag ? (
        <SettingsNote tone="flag" id={`${htmlFor}-flag`} className="mt-1.5">
          {flag}
        </SettingsNote>
      ) : null}
      {hint ? (
        <SettingsNote tone="info" id={`${htmlFor}-hint`} className="mt-1.5">
          {hint}
        </SettingsNote>
      ) : null}
    </div>
  );
}

/** The `aria-describedby` for a `SettingsField`'s input, from what the field shows. */
export function describedBy(
  htmlFor: string,
  shown: { error?: unknown; flag?: unknown; hint?: unknown },
): string | undefined {
  const ids = [
    shown.error ? `${htmlFor}-error` : null,
    shown.flag ? `${htmlFor}-flag` : null,
    shown.hint ? `${htmlFor}-hint` : null,
  ].filter((id): id is string => id !== null);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

/** "Changes scores": the section is part of the score cache key, so saving it asks first. */
export function ScoredBadge() {
  return (
    <Hint
      label="Changes scores"
      detail="Saving this makes current scores stale. You see how many, and what re-scoring them costs, before it saves."
    >
      <span className="inline-flex items-center gap-1 rounded-full bg-maybe-wash px-2 py-0.5 text-2xs font-medium text-maybe ring-1 ring-inset ring-maybe/25">
        <RefreshCcw aria-hidden className="size-3" />
        Changes scores
      </span>
    </Hint>
  );
}

/** A Settings card: a title, what it's for, the fields, and its save bar. Each section saves on its own. */
export function SettingsSection({
  id,
  title,
  description,
  scored = false,
  error,
  children,
  footer,
  className,
}: {
  id: string;
  title: string;
  description?: React.ReactNode;
  scored?: boolean;
  /** An issue with no field of its own, such as a duplicate bullet id. */
  error?: string | null;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn("rounded-xl border border-line bg-surface-1/60 shadow-card", className)}
    >
      <header className="flex flex-wrap items-start gap-x-3 gap-y-1.5 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1 basis-56">
          <h2 id={`${id}-title`} className="hud-rule hud-label text-fg-2">
            {title}
          </h2>
          {description ? <p className="mt-1 text-xs leading-relaxed text-fg-3">{description}</p> : null}
        </div>
        {scored ? <ScoredBadge /> : null}
      </header>
      <div className="space-y-4 px-4 py-4">
        {error ? <SettingsNote tone="error">{error}</SettingsNote> : null}
        {children}
      </div>
      {footer}
    </section>
  );
}

/** A section's footer: whether there are unsaved edits, Discard, and Save. */
export function SaveBar({
  dirty,
  busy = false,
  status,
  onSave,
  onDiscard,
  saveLabel = "Save",
}: {
  dirty: boolean;
  busy?: boolean;
  /** Shown when nothing is unsaved, e.g. "Saved. A backup was taken first." */
  status?: string | null;
  onSave: () => void;
  onDiscard: () => void;
  saveLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
      <span aria-live="polite" className={cn("text-xs", dirty ? "text-maybe" : "text-fg-3")}>
        {busy ? "Saving…" : dirty ? "Unsaved changes" : (status ?? "")}
      </span>
      <div className="ml-auto flex items-center gap-1.5">
        <Button type="button" size="sm" variant="ghost" disabled={!dirty || busy} onClick={onDiscard}>
          Discard
        </Button>
        <Button type="button" size="sm" disabled={!dirty || busy} onClick={onSave}>
          <Save />
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}

/** One experience or education entry, folded to its title line. Uses `<details>`, so it opens from the keyboard. */
export function EntryDisclosure({
  title,
  meta,
  flags,
  defaultOpen = false,
  children,
}: {
  title: string;
  meta?: string;
  /** Short labels shown on the folded line, such as "Year-only date". */
  flags?: string[];
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group/entry rounded-lg border border-line bg-surface-1">
      <summary
        className={cn(
          "flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-3 py-2.5 max-md:min-h-11 [&::-webkit-details-marker]:hidden",
          "-outline-offset-2 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-uv-hi",
          "hover:bg-surface-2",
        )}
      >
        <ChevronRight
          aria-hidden
          className="size-3.5 shrink-0 text-fg-3 transition-transform duration-200 group-open/entry:rotate-90"
        />
        <span className="min-w-0 truncate text-sm font-medium text-fg">{title}</span>
        {meta ? <span className="font-mono text-2xs tnum text-fg-3">{meta}</span> : null}
        {flags?.map((flag) => (
          <span
            key={flag}
            className="inline-flex items-center gap-1 rounded-full bg-maybe-wash px-1.5 py-0.5 text-2xs text-maybe"
          >
            <TriangleAlert aria-hidden className="size-3" />
            {flag}
          </span>
        ))}
      </summary>
      <div className="space-y-4 border-t border-line px-3 py-3">{children}</div>
    </details>
  );
}

/** A bullet's id, which is a label and not a fact. */
export function BulletId({ id }: { id: string | null }) {
  return (
    <span className="inline-block min-w-0 truncate font-mono text-2xs text-fg-4">{id ?? "new"}</span>
  );
}

/**
 * Asked before a save that changes the score cache key. Every number comes from the container:
 * `stale` is `computeFunnel`'s current count, and `cost` is already formatted. Cancel writes nothing.
 */
export function RescoreNotice({
  open,
  onOpenChange,
  stale,
  cost,
  costBasis,
  perRun,
  busy = false,
  error = null,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stale: number;
  /** e.g. "$45". Null when there's no scoring call on record to price it. */
  cost: string | null;
  /** e.g. "November's mean of $0.015 a score, over 1,108 calls". */
  costBasis: string | null;
  perRun: number;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-md overflow-hidden p-0">
        <div aria-hidden className="hazard-warn h-1" />
        <div className="scanlines-light flex items-start gap-3 border-b border-line px-5 py-4">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 ring-1 ring-line-2">
            <RefreshCcw className="size-4 text-maybe" />
          </span>
          <div className="min-w-0">
            <DialogTitle className="text-md font-semibold text-fg">This edit re-scores your jobs</DialogTitle>
            <DialogDescription className="mt-1 text-xs text-fg-3">
              Scores are cached against your profile and preferences. Saving this changes them, so every
              current score goes stale.
            </DialogDescription>
          </div>
          <DialogClose
            disabled={busy}
            className={`ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-3 hover:bg-surface-3 hover:text-fg ${ring}`}
          >
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogClose>
        </div>
        <dl className="divide-y divide-line">
          <div className="flex items-baseline justify-between gap-4 px-5 py-2.5 text-sm">
            <dt className="text-fg-2">Current scores that go stale</dt>
            <dd className="font-mono text-sm tnum text-fg">{formatCount(stale)}</dd>
          </div>
          <div className="px-5 py-2.5 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-fg-2">Estimated cost to re-score them</dt>
              <dd className="font-mono text-sm tnum text-fg">{cost ?? "Unknown"}</dd>
            </div>
            <p className="mt-0.5 text-xs text-fg-3">
              {costBasis ?? "No scoring calls are on record to price it."}
            </p>
          </div>
        </dl>
        <p className="border-t border-line bg-surface-1 px-5 py-3 text-xs leading-relaxed text-fg-2">
          Until they're scored again, Top matches shows only jobs scored after this save. Each scout or Score
          next re-scores up to <span className="font-mono tnum text-fg">{formatCount(perRun)}</span>.
        </p>
        {error ? (
          <div className="border-t border-line px-5 py-3">
            <SettingsNote tone="error">{error}</SettingsNote>
          </div>
        ) : null}
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <Button type="button" variant="outline" className={ring} disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" className={ring} disabled={busy} onClick={onConfirm}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
