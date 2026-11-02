"use client";

import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { JobRow } from "./job-row";
import type { Density, JobSummary, TriageAction } from "./types";

const PAD = 8;

/**
 * Virtualized triage list. Rows are absolutely positioned by transform, so a
 * re-rank or a removed row slides every other row into place. The selection
 * is one highlight element that glides to the selected row.
 */
export function JobList({
  items,
  selectedId,
  onSelect,
  onAction,
  density = "comfortable",
  leavingId,
  emptyState,
  className,
  "aria-label": ariaLabel = "Jobs",
}: {
  items: JobSummary[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  onAction?: (id: string, action: TriageAction) => void;
  density?: Density;
  /** A row playing its exit animation before it's removed. */
  leavingId?: string | null;
  emptyState?: React.ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  const parentRef = React.useRef<HTMLDivElement>(null);
  const rowH = density === "compact" ? 44 : 66;

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowH,
    overscan: 10,
    paddingStart: PAD,
    paddingEnd: PAD,
    getItemKey: (i) => items[i]?.id ?? i,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the row height (density) changes
  React.useEffect(() => {
    virtualizer.measure();
  }, [rowH, virtualizer]);

  const selIndex = selectedId ? items.findIndex((j) => j.id === selectedId) : -1;

  React.useEffect(() => {
    if (selIndex >= 0) virtualizer.scrollToIndex(selIndex, { align: "auto" });
  }, [selIndex, virtualizer]);

  // Stagger the first screenful of rows in on mount, then stop animating entries.
  const [entered, setEntered] = React.useState(false);
  React.useEffect(() => {
    const t = window.setTimeout(() => setEntered(true), 800);
    return () => window.clearTimeout(t);
  }, []);

  if (items.length === 0) return <>{emptyState}</>;

  return (
    <div
      ref={parentRef}
      role="listbox"
      aria-label={ariaLabel}
      aria-activedescendant={selectedId ? `job-${selectedId}` : undefined}
      tabIndex={0}
      className={cn(
        "@container relative h-full overflow-x-hidden overflow-y-auto overscroll-contain px-2 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-hi",
        className,
      )}
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {selIndex >= 0 ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 rounded-lg bg-brand-wash ring-1 ring-inset ring-brand/35"
            style={{
              height: rowH - 4,
              transform: `translateY(${PAD + selIndex * rowH + 2}px)`,
              transition: "transform 300ms var(--ease-out-expo), height 200ms var(--ease-out-expo)",
            }}
          />
        ) : null}

        {virtualizer.getVirtualItems().map((v) => {
          const job = items[v.index];
          if (!job) return null;
          const selected = job.id === selectedId;
          const leaving = job.id === leavingId;
          return (
            <div
              key={v.key}
              id={`job-${job.id}`}
              role="option"
              aria-selected={selected}
              tabIndex={-1}
              onClick={() => onSelect(job.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(job.id);
                }
              }}
              className="absolute inset-x-0 top-0 overflow-hidden py-0.5"
              style={{
                height: rowH,
                transform: `translateY(${v.start}px)`,
                transition: "transform 320ms var(--ease-out-expo)",
              }}
            >
              <div
                className={cn(
                  "h-full transition-[translate,opacity] duration-200 ease-out-quint",
                  !entered && v.index < 18 && "animate-rise-in",
                  leaving && "translate-x-8 opacity-0",
                )}
                style={!entered ? { animationDelay: `${Math.min(v.index, 18) * 22}ms` } : undefined}
              >
                <JobRow
                  job={job}
                  selected={selected}
                  density={density}
                  onAction={onAction ? (a) => onAction(job.id, a) : undefined}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
