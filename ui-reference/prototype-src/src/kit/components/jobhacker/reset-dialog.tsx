"use client";

import { Eraser, X } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatCount } from "@/lib/format";

/** The counts `planReset` returns. The dialog lists these and nothing it computed itself. */
export interface ResetCounts {
  jobs: number;
  jobsWithApplication: number;
  jobsWithoutApplication: number;
  jobScores: number;
  applications: number;
  companyDomains: number;
  sourceUsage: number;
  companiesRemoved: number;
  runs: number;
  eventsRemoved: number;
}

const ROWS: { label: string; value: (plan: ResetCounts) => number }[] = [
  { label: "jobs", value: (plan) => plan.jobs },
  { label: "with an application", value: (plan) => plan.jobsWithApplication },
  { label: "without an application", value: (plan) => plan.jobsWithoutApplication },
  { label: "scores", value: (plan) => plan.jobScores },
  { label: "applications", value: (plan) => plan.applications },
  { label: "company logos", value: (plan) => plan.companyDomains },
  { label: "source budget rows", value: (plan) => plan.sourceUsage },
  { label: "search companies removed", value: (plan) => plan.companiesRemoved },
  { label: "runs", value: (plan) => plan.runs },
  { label: "events removed", value: (plan) => plan.eventsRemoved },
];

const ring =
  "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-uv-hi";

/**
 * Start fresh. Confirm stays disabled until the field equals RESET.
 * Cancel closes. The parent writes, and only from Confirm.
 */
export function ResetDialog({
  open,
  onOpenChange,
  plan,
  phase,
  busy = false,
  error = null,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: ResetCounts | null;
  phase: "confirm" | "done";
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = React.useState("");
  React.useEffect(() => {
    if (!open) setTyped("");
  }, [open]);
  const ready = typed === "RESET" && plan != null && !busy && phase === "confirm";
  const done = phase === "done";

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-md overflow-hidden p-0">
        <div aria-hidden className="hazard-warn h-1" />
        <div className="scanlines-light flex items-start gap-3 border-b border-line px-5 py-4">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 ring-1 ring-line-2">
            <Eraser className="size-4 text-brand-hi" />
          </span>
          <div className="min-w-0">
            <DialogTitle className="text-md font-semibold text-fg">
              {done ? "Queue cleared" : "Start fresh"}
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs text-fg-3">
              {done
                ? "Applications, follow-ups, company logos, and the source budget are unchanged. A backup was taken first."
                : "Empties the queue you have not acted on. Applications, follow-ups, company logos, and the source budget stay. A backup is taken first."}
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
        {plan ? (
          <ul className="max-h-[50vh] overflow-y-auto py-1">
            {ROWS.map((row) => (
              <li key={row.label} className="flex items-baseline justify-between gap-4 px-5 py-1.5 text-sm">
                <span className="text-fg-2">{row.label}</span>
                <span className="font-mono text-xs tnum text-fg">{formatCount(row.value(plan))}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-6 text-sm text-fg-3">{error ? error : "Counting the queue…"}</p>
        )}
        {done ? (
          <div className="flex justify-end border-t border-line px-5 py-3">
            <Button type="button" variant="secondary" className={ring} onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        ) : (
          <form
            className="border-t border-line px-5 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (ready) onConfirm();
            }}
          >
            <label htmlFor="reset-confirm" className="text-xs font-medium text-fg-2">
              Type RESET to confirm
            </label>
            <input
              id="reset-confirm"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={busy || plan == null}
              className={`mt-1.5 h-9 w-full rounded-md border border-line-2 bg-surface-1 px-3 font-mono text-sm text-fg ${ring}`}
            />
            {error && plan ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
            <div className="mt-3 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className={ring}
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="destructive" className={ring} disabled={!ready}>
                {busy ? "Clearing…" : "Confirm"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
