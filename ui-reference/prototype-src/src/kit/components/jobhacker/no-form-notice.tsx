"use client";

import type * as React from "react";
import { ArrowUpRight, Link2, LoaderCircle, Save } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SettingsField, describedBy, settingsFieldClass } from "./settings";

/** An apply link on the employer's own site, as the source listed it. */
export interface ApplyLink {
  publisher: string;
  host: string;
  url: string;
  /** The source marked it as the employer's own link. */
  direct: boolean;
}

const LINK_FIELD = "employer-link";

/** The employer's application link: one field and Save. Controlled; a refusal shows under it. */
export function EmployerLinkField({
  value,
  onChange,
  onSave,
  onCancel,
  saving = false,
  error,
  hint,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  /** Shown when the field was opened from Change. */
  onCancel?: () => void;
  saving?: boolean;
  error?: string | null;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <SettingsField label="Employer's application link" htmlFor={LINK_FIELD} error={error} hint={error ? undefined : hint}>
        <div className="flex gap-2 max-sm:flex-wrap">
          <input
            id={LINK_FIELD}
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://careers.example.com/jobs/123"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(LINK_FIELD, { error, hint: error ? undefined : hint })}
            className={cn(settingsFieldClass, "h-9 min-w-0 flex-1 max-sm:basis-full")}
          />
          <Button type="submit" size="sm" className="h-9" disabled={saving || value.trim() === ""}>
            {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
            Save
          </Button>
          {onCancel ? (
            <Button type="button" variant="ghost" size="sm" className="h-9" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
        </div>
      </SettingsField>
    </form>
  );
}

function DirectChip() {
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-strong-wash px-1.5 text-2xs font-medium text-strong ring-1 ring-inset ring-strong/25">
      Direct
    </span>
  );
}

function otherLinksLine(count: number): string {
  const links = count === 1 ? "1 more link" : `${count} more links`;
  return `Not shown: ${links} from the search, on job boards or sites not tied to this employer. Search results are grouped by title, so some are other companies' jobs.`;
}

/**
 * Takes the fill report's place on the Apply tab when there's nothing to fill.
 * `job-board`: the link is on a job board, so Open & fill won't open it; the
 * job's links on the employer's own site follow, each usable, then a count of
 * the links left out. `no-form`: the page opened, but it had no application
 * form. Both end with the employer-link field. Every link opens in a new tab.
 */
export function NoFormNotice({
  kind,
  host,
  links = [],
  otherLinks = 0,
  employerNamed = true,
  onUseLink,
  usingUrl = null,
  postingHref,
  link,
  onLinkChange,
  onSave,
  saving = false,
  error,
  className,
}: {
  kind: "job-board" | "no-form";
  host: string;
  /** The job's apply links on the employer's own site (`job-board` only). */
  links?: ApplyLink[];
  /** Links the source listed that aren't shown: job boards, or sites not tied to the employer. */
  otherLinks?: number;
  /** False when the source listed a placeholder ("Remote") instead of an employer. */
  employerNamed?: boolean;
  onUseLink?: (link: ApplyLink) => void;
  /** The link being saved from Use this link. */
  usingUrl?: string | null;
  /** Open posting (`job-board` only). */
  postingHref?: string;
  link: string;
  onLinkChange: (value: string) => void;
  onSave: () => void;
  saving?: boolean;
  error?: string | null;
  className?: string;
}) {
  const board = kind === "job-board";
  return (
    <section aria-labelledby="no-form-title" className={cn("surface-card rounded-xl p-5 max-md:p-4", className)}>
      <div className="hud-label text-maybe">Nothing to fill</div>
      <h2 id="no-form-title" className="mt-1 text-lg font-semibold tracking-tight text-fg [overflow-wrap:anywhere]">
        {board ? `${host} is a job board` : `No application form on ${host}`}
      </h2>
      <p className="mt-0.5 text-sm text-fg-2">
        {board
          ? "Open & fill won't type anything there."
          : "Nothing was filled. The tab is still open in Chrome."}
      </p>

      {board ? (
        <div className="mt-4">
          <div className="hud-label text-fg-3">On the employer's site</div>
          {links.length > 0 ? (
            <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
              {links.map((l) => {
                const usable = onUseLink !== undefined;
                return (
                  <li key={l.url} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                    <div className={cn("min-w-0 flex-1", usable && "max-sm:basis-full")}>
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium text-fg">{l.publisher}</span>
                        {l.direct ? <DirectChip /> : null}
                      </div>
                      <div className="truncate font-mono text-xs text-fg-3">{l.host}</div>
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-1">
                      {usable ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={usingUrl !== null}
                          onClick={() => onUseLink?.(l)}
                        >
                          {usingUrl === l.url ? <LoaderCircle className="animate-spin" /> : <Link2 />}
                          Use this link
                        </Button>
                      ) : null}
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open ${l.host} in a new tab`}
                        className={buttonVariants({ variant: "ghost", size: "sm" })}
                      >
                        <ArrowUpRight />
                        <span className="max-sm:hidden">Open</span>
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 rounded-lg border border-dashed border-line-2 px-3.5 py-3 text-sm text-fg-3">
              {employerNamed
                ? "The search has no link on the employer's own site."
                : "The search didn't name the employer, so no link can be tied to it. The description may say who's hiring."}
            </p>
          )}
          {otherLinks > 0 ? <p className="mt-2 text-xs text-fg-3">{otherLinksLine(otherLinks)}</p> : null}
        </div>
      ) : null}

      <EmployerLinkField
        className="mt-4"
        value={link}
        onChange={onLinkChange}
        onSave={onSave}
        saving={saving}
        error={error}
        hint={
          board
            ? "Find the role on the employer's own site and paste its application link. Open & fill opens that instead."
            : "If the employer has its own application page, paste it here and press Open & fill again."
        }
      />

      {board && postingHref ? (
        <a
          href={postingHref}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mt-3 -ml-2")}
        >
          <ArrowUpRight />
          Open posting
        </a>
      ) : null}
    </section>
  );
}

/** "Opens <host>": the employer link set on the application, with Change and Clear. */
export function EmployerLinkBar({
  host,
  onChange,
  onClear,
  clearing = false,
  className,
}: {
  host: string;
  onChange: () => void;
  onClear: () => void;
  clearing?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-surface-1 py-2 pr-2 pl-4 text-sm",
        className,
      )}
    >
      <Link2 aria-hidden className="size-4 shrink-0 text-fg-3" />
      <span className="min-w-0 flex-1 text-fg-2 [overflow-wrap:anywhere]">
        Opens <span className="font-mono font-medium text-fg">{host}</span>
        <span className="text-fg-3"> · the employer link you set</span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onChange}>
          Change
        </Button>
        <Button variant="ghost" size="sm" onClick={onClear} disabled={clearing}>
          {clearing ? <LoaderCircle className="animate-spin" /> : null}
          Clear
        </Button>
      </span>
    </div>
  );
}
