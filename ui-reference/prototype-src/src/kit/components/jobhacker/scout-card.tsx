"use client";

import { CircleAlert, Radar, RefreshCw, TriangleAlert } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import { Button } from "@/components/ui/button";

export interface ScoutProgress {
  done: number;
  total: number;
  found: number;
  /** What's being counted. Defaults to "Board". Scoring uses "Scoring". */
  unit?: string;
}

/**
 * Health of the unattended scout. `attention`: the last run had errors or a metered source is at
 * its monthly budget. `failed`: the last run failed.
 */
export type ScoutStatus = "ok" | "attention" | "failed";

/** A board that may be where a gone board moved: "Ashby · sbi-coinhako", "10 postings · SBI Coinhako". */
export interface ScoutCandidate {
  label: string;
  detail: string;
}

/**
 * A string, or a line with a button. The card does not know what the button does.
 * A gone board's line can also carry where JobHacker looked (`looked`), the boards it found
 * (`candidates`, each with Use this board), and a careers-link field (`link`).
 */
export type ScoutNoticeItem =
  | string
  | {
      text: string;
      action?: string;
      /** The board's name, for the field's label. */
      board?: string;
      looked?: string;
      candidates?: ScoutCandidate[];
      /** Show the link field. `error` is the reason the last link was refused; `busy` while it's checked. */
      link?: { error?: string; busy?: boolean };
    };

type NoticeObject = Exclude<ScoutNoticeItem, string>;

function noticeText(notice: ScoutNoticeItem): string {
  return typeof notice === "string" ? notice : notice.text;
}

function noticeObject(notice: ScoutNoticeItem): NoticeObject {
  return typeof notice === "string" ? { text: notice } : notice;
}

const ring =
  "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-hi";

/** Paste a careers link for a gone board. The parent checks it; an error shows under the field. */
function LinkField({
  id,
  label,
  error,
  busy = false,
  onSubmit,
}: {
  id: string;
  label: string;
  error?: string;
  busy?: boolean;
  onSubmit: (url: string) => void;
}) {
  const errorId = `${id}-error`;
  return (
    <form
      className="mt-2"
      onSubmit={(event) => {
        event.preventDefault();
        const value = new FormData(event.currentTarget).get("url");
        const url = typeof value === "string" ? value.trim() : "";
        if (url && !busy) onSubmit(url);
      }}
    >
      <label htmlFor={id} className="text-2xs font-medium text-fg-3">
        {label}
      </label>
      <div className="mt-1 flex gap-1.5">
        <input
          id={id}
          name="url"
          type="url"
          inputMode="url"
          placeholder="https://jobs.ashbyhq.com/…"
          autoComplete="off"
          spellCheck={false}
          readOnly={busy}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn(
            "h-7 min-w-0 flex-1 rounded-md border bg-surface-2 px-2 text-xs text-fg placeholder:text-fg-4 max-md:h-10",
            error ? "border-danger" : "border-line-2",
            ring,
          )}
        />
        <Button type="submit" size="sm" variant="secondary" disabled={busy} className={ring}>
          {busy ? "Checking" : "Move"}
        </Button>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 flex items-start gap-1 text-xs leading-snug text-danger">
          <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </form>
  );
}

const STATUS_LABEL: Record<ScoutStatus, string> = {
  ok: "Scout healthy",
  attention: "Needs attention",
  failed: "Last scout failed",
};

const STATUS_DOT: Record<ScoutStatus, string> = {
  ok: "bg-strong text-strong",
  attention: "bg-maybe text-maybe",
  failed: "bg-danger text-danger",
};

/** Scout status, Run scout, and Refresh listings, with live progress while running. */
export function ScoutCard({
  lastRunLabel,
  boards,
  newLastRun,
  progress,
  onRun,
  onRefresh,
  status = "ok",
  notices = [],
  onNoticeAction,
  onCandidate,
  onLink,
  collapsed = false,
}: {
  lastRunLabel: string;
  boards: number;
  newLastRun: number;
  progress?: ScoutProgress | null;
  onRun: () => void;
  /** Scout with no scoring. Same lock as Run scout; the caller refuses a second click. */
  onRefresh: () => void;
  status?: ScoutStatus;
  /** One line per problem. `action` is a button under that line. */
  notices?: ScoutNoticeItem[];
  onNoticeAction?: (index: number) => void;
  /** Use this board, for candidate `candidate` of notice `index`. */
  onCandidate?: (index: number, candidate: number) => void;
  /** A careers link pasted into notice `index`'s field. */
  onLink?: (index: number, url: string) => void;
  collapsed?: boolean;
}) {
  const fieldId = React.useId();
  const running = progress != null;
  const pct = running ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;
  const dot = running ? "bg-brand text-brand" : STATUS_DOT[status];

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          aria-label={running ? `Scouting, ${pct}%` : `Run scout. ${STATUS_LABEL[status]}`}
          title={running ? undefined : [STATUS_LABEL[status], ...notices.map(noticeText)].join("\n")}
          className="relative mx-auto flex size-9 items-center justify-center rounded-lg border border-line bg-surface-1 text-fg-2 hover:text-fg"
        >
          <Radar className={cn("size-4", running && "animate-spin text-brand-hi [animation-duration:2.4s]")} />
          <span className={cn("absolute right-1.5 top-1.5 size-1.5 rounded-full animate-pulse-dot", dot)} />
        </button>
        <button
          type="button"
          onClick={onRefresh}
          disabled={running}
          aria-label="Refresh listings"
          title="Refresh listings"
          className="mx-auto flex size-9 items-center justify-center rounded-lg border border-line bg-surface-1 text-fg-2 hover:text-fg disabled:opacity-50"
        >
          <RefreshCw className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-surface-1 p-3 shadow-hairline">
      <div className="flex items-center gap-2">
        <span className={cn("size-2 rounded-full animate-pulse-dot", dot)} />
        <span className="text-sm font-medium text-fg">{running ? "Scouting" : STATUS_LABEL[status]}</span>
        <span className="ml-auto text-xs tnum text-fg-3">{running ? `${pct}%` : lastRunLabel}</span>
      </div>

      {running ? (
        <div className="mt-2.5">
          <div className="h-1 overflow-hidden rounded-full bg-surface-4">
            <div
              className="h-full rounded-full bg-linear-to-r from-brand-lo to-brand-hi transition-[width] duration-300 ease-out-quint"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs tnum text-fg-3">
            {progress.unit ?? 'Board'} {formatCount(progress.done)} of {formatCount(progress.total)}
            <span className="text-fg-2"> · {progress.found} new</span>
          </p>
        </div>
      ) : (
        <p className="mt-1 text-xs tnum text-fg-3">
          {formatCount(boards)} boards · {newLastRun} new last run
        </p>
      )}

      {!running && notices.length ? (
        <ul className="mt-2 max-h-80 space-y-2 overflow-y-auto">
          {notices.map((notice, index) => {
            const { text, action, board, looked, candidates = [], link } = noticeObject(notice);
            const whose = board ? `${board}'s` : "its";
            return (
              <li key={action ? `${text} ${action}` : text} className="text-xs leading-snug text-fg-2">
                <div className="flex items-start gap-1.5">
                  <TriangleAlert
                    aria-hidden
                    className={cn("mt-px size-3.5 shrink-0", status === "failed" ? "text-danger" : "text-maybe")}
                  />
                  <span>{text}</span>
                </div>
                {looked ? <p className="mt-1 pl-5 text-fg-3">{looked}</p> : null}
                {candidates.length ? (
                  <ul className="mt-1.5 space-y-1.5 pl-5" aria-label={`Boards that may be ${whose} new one`}>
                    {candidates.map((candidate, ci) => (
                      <li
                        key={candidate.label}
                        className="rounded-md border border-line bg-surface-2 px-2 py-1.5"
                      >
                        <p className="font-medium text-fg">{candidate.label}</p>
                        <p className="tnum text-fg-3">{candidate.detail}</p>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className={cn("mt-1.5 h-auto min-h-7 whitespace-normal py-1 text-left", ring)}
                          onClick={() => onCandidate?.(index, ci)}
                        >
                          Use this board
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {link ? (
                  <div className="pl-5">
                    <LinkField
                      id={`${fieldId}-${index}`}
                      label={`${candidates.length ? "Or paste" : "Paste"} ${whose} new careers link`}
                      error={link.error}
                      busy={link.busy}
                      onSubmit={(url) => onLink?.(index, url)}
                    />
                  </div>
                ) : null}
                {action ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className={cn(
                      "mt-1.5 h-auto min-h-7 whitespace-normal py-1 text-left",
                      (looked || link) && "ml-5",
                      ring,
                    )}
                    onClick={() => onNoticeAction?.(index)}
                  >
                    {action}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <Button size="sm" variant="secondary" className="mt-2.5 w-full" onClick={onRun} disabled={running}>
        <Radar className={cn(running && "animate-spin [animation-duration:2.4s]")} />
        {running ? "Running scout" : "Run scout"}
      </Button>
      <Button size="sm" variant="ghost" className="mt-1.5 w-full" onClick={onRefresh} disabled={running}>
        <RefreshCw />
        Refresh listings
      </Button>
    </div>
  );
}
