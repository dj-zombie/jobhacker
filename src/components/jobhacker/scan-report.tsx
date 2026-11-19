import * as React from "react";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/format";

export interface ScanRow {
  /** The service name, e.g. an ATS: "greenhouse". */
  service: string;
  /** Hosts up on that service, e.g. active boards. */
  count: number;
}

/**
 * An nmap-style scan report: each service (an ATS) is a row of "hosts up" (active boards), with a
 * proportional bar that grows in once. An honest port-scan read of real telemetry: the boards
 * JobHacker sweeps are public ATS endpoints, hit as a polite client, never scraped. The green
 * "open" carries a word, not color alone. Presentational; pass the rows in.
 */
export function ScanReport({
  rows,
  unit = "hosts",
  caption,
  footer,
  className,
}: {
  rows: ScanRow[];
  /** The count column's heading, e.g. "hosts" or "postings". */
  unit?: string;
  /** A line above the table, e.g. "JHMAP 1.0 · 336 hosts up". */
  caption?: string;
  /** A line below the table, e.g. the harvested total. */
  footer?: React.ReactNode;
  className?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className={cn("font-mono text-2xs", className)}>
      {caption ? <p className="mb-2.5 tnum text-fg-3">{caption}</p> : null}
      <div className="grid grid-cols-[3.25rem_5rem_1fr_2.75rem] items-center gap-x-2 gap-y-1.5">
        <span className="hud-label text-fg-4">state</span>
        <span className="hud-label text-fg-4">service</span>
        <span aria-hidden />
        <span className="hud-label text-right text-fg-4">{unit}</span>
        {rows.map((r, i) => (
          <React.Fragment key={r.service}>
            <span className="flex items-center gap-1 text-strong">
              <span aria-hidden className="size-1.5 rounded-full bg-strong shadow-[0_0_6px_var(--color-strong)]" />
              open
            </span>
            <span className="truncate text-fg-2">{r.service}</span>
            <span className="relative h-1.5 w-full overflow-hidden bg-surface-3">
              <span
                className="absolute inset-y-0 left-0 block origin-left animate-bar-grow bg-strong/55"
                style={{ width: `${(r.count / max) * 100}%`, animationDelay: `${i * 70}ms` }}
              />
            </span>
            <span className="text-right tnum text-fg">{formatCount(r.count)}</span>
          </React.Fragment>
        ))}
      </div>
      {footer ? <p className="mt-2.5 border-t border-line pt-2 tnum text-fg-3">{footer}</p> : null}
    </div>
  );
}
