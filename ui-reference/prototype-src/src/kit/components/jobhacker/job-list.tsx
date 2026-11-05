"use client";

import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { JobRow } from "./job-row";
import { lockTo, releaseLock, TargetLock } from "./target-lock";
import type { Density, JobSummary, TriageAction } from "./types";
import { useAcquire } from "./use-acquire";

const PAD = 8;

/** A row renders again only when its job, selection or density changes, so J and K touch two rows. */
const ListRow = React.memo(function ListRow({
  job,
  selected,
  density,
  onAction,
}: {
  job: JobSummary;
  selected: boolean;
  density: Density;
  onAction?: (id: string, action: TriageAction) => void;
}) {
  return (
    <JobRow
      job={job}
      selected={selected}
      density={density}
      onAction={onAction ? (action) => onAction(job.id, action) : undefined}
    />
  );
});

/**
 * Virtualized triage list. Rows are absolutely positioned by transform, so a
 * re-rank or a removed row slides every other row into place. The selection
 * is one highlight that glides to the selected row, and one target lock whose
 * corners spring after it, overshooting a little as each row is acquired. In a
 * burst of moves the lock lets go, and snaps onto the row once the moves stop. Row
 * hover effects run only while the pointer moves over the list (`data-pointer`);
 * a scroll turns them off until it moves again.
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

  // Rows hold on to one handler, which always calls the newest onAction.
  const latestAction = React.useRef(onAction);
  React.useLayoutEffect(() => {
    latestAction.current = onAction;
  });
  const act = React.useCallback((id: string, action: TriageAction) => latestAction.current?.(id, action), []);

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

  const lockRef = React.useRef<HTMLDivElement>(null);
  const placed = React.useRef(false);
  const held = React.useRef(false);
  useAcquire(
    `${selIndex}|${rowH}|${items.length}`,
    () => {
      if (selIndex < 0) return;
      const box = { top: PAD + selIndex * rowH + 1, height: rowH - 2 };
      lockTo(lockRef.current, box, !placed.current ? { instant: true } : held.current ? { spread: 6 } : {});
      placed.current = true;
      held.current = false;
    },
    () => {
      if (held.current) return;
      held.current = true;
      releaseLock(lockRef.current);
    },
  );

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
      onPointerMove={(e) => {
        if (e.currentTarget.dataset.pointer === undefined) e.currentTarget.dataset.pointer = "";
      }}
      onScroll={(e) => {
        if (e.currentTarget.dataset.pointer !== undefined) delete e.currentTarget.dataset.pointer;
      }}
      className={cn(
        "@container relative h-full overflow-x-hidden overflow-y-auto overscroll-contain px-2 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-uv-hi",
        className,
      )}
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {selIndex >= 0 ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 rounded-md bg-brand-wash ring-1 ring-inset ring-brand/45"
            style={{
              height: rowH - 4,
              transform: `translateY(${PAD + selIndex * rowH + 2}px)`,
              transition: "transform 300ms var(--ease-out-expo), height 200ms var(--ease-out-expo)",
            }}
          />
        ) : null}
        <TargetLock ref={lockRef} corner={9} className={selIndex < 0 ? "hidden" : undefined} />

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
                className={cn("h-full", !entered && v.index < 18 && "animate-rise-in", leaving && "animate-glitch-out")}
                style={!entered ? { animationDelay: `${Math.min(v.index, 18) * 22}ms` } : undefined}
              >
                <ListRow job={job} selected={selected} density={density} onAction={onAction ? act : undefined} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
