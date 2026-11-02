"use client";

import { Radar, TriangleAlert } from "lucide-react";
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
 * Health of the unattended scout. `attention`: the last run had errors, a metered source is at
 * its monthly budget, or model spend is past the soft cap. `failed`: the last run failed.
 */
export type ScoutStatus = "ok" | "attention" | "failed";

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

/** Scout status and the Run scout action, with live progress while running. */
export function ScoutCard({
  lastRunLabel,
  boards,
  newLastRun,
  progress,
  onRun,
  status = "ok",
  notices = [],
  collapsed = false,
}: {
  lastRunLabel: string;
  boards: number;
  newLastRun: number;
  progress?: ScoutProgress | null;
  onRun: () => void;
  status?: ScoutStatus;
  /** One short line per problem, e.g. "JSearch is at its monthly budget". */
  notices?: string[];
  collapsed?: boolean;
}) {
  const running = progress != null;
  const pct = running ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;
  const dot = running ? "bg-brand text-brand" : STATUS_DOT[status];

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onRun}
        disabled={running}
        aria-label={running ? `Scouting, ${pct}%` : `Run scout. ${STATUS_LABEL[status]}`}
        title={running ? undefined : [STATUS_LABEL[status], ...notices].join("\n")}
        className="relative mx-auto flex size-9 items-center justify-center rounded-lg border border-line bg-surface-1 text-fg-2 hover:text-fg"
      >
        <Radar className={cn("size-4", running && "animate-spin text-brand-hi [animation-duration:2.4s]")} />
        <span className={cn("absolute right-1.5 top-1.5 size-1.5 rounded-full animate-pulse-dot", dot)} />
      </button>
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
        <ul className="mt-2 space-y-1">
          {notices.map((n) => (
            <li key={n} className="flex items-start gap-1.5 text-xs leading-snug text-fg-2">
              <TriangleAlert
                aria-hidden
                className={cn("mt-px size-3.5 shrink-0", status === "failed" ? "text-danger" : "text-maybe")}
              />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <Button size="sm" variant="secondary" className="mt-2.5 w-full" onClick={onRun} disabled={running}>
        <Radar className={cn(running && "animate-spin [animation-duration:2.4s]")} />
        {running ? "Running scout" : "Run scout"}
      </Button>
    </div>
  );
}
