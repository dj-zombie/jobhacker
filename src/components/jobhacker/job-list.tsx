"use client";

import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { JobRow } from "./job-row";
import { lockTo, releaseLock, TargetLock } from "./target-lock";
import type { Density, JobSummary, TriageAction } from "./types";
import { useAcquire } from "./use-acquire";

const PAD = 8;

/**
 * A comfortable row's height before it renders: a 22px title line, a 16px meta
 * line and the 50px score column, plus a line when the title or the meta looks
 * long. Measuring corrects it.
 */
function estimateRow(job: JobSummary | undefined): number {
  if (!job) return 66;
  const meta = job.company.length + job.location.length + (job.compLabel?.length ?? 0);
  const text = 42 + (job.title.length > 44 ? 22 : 0) + (meta > 56 ? 18 : 0);
  return Math.max(text, 50) + 16;
}

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
  const compact = density === "compact";
  const rowH = compact ? 44 : 66;

  // Rows hold on to one handler, which always calls the newest onAction.
  const latestAction = React.useRef(onAction);
  React.useLayoutEffect(() => {
    latestAction.current = onAction;
  });
  const act = React.useCallback((id: string, action: TriageAction) => latestAction.current?.(id, action), []);

  // Comfortable rows wrap, so each is measured once it renders. The estimate guesses a second title line.
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (compact ? rowH : estimateRow(items[i])),
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
  const virtualItems = virtualizer.getVirtualItems();
  const selRow = selIndex >= 0 ? virtualizer.measurementsCache[selIndex] : undefined;
  const selTop = selRow?.start ?? PAD;
  const selH = selRow?.size ?? rowH;
  const box = { top: selTop + 1, height: selH - 2 };
  const boxRef = React.useRef(box);
  boxRef.current = box;

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
      lockTo(lockRef.current, boxRef.current, !placed.current ? { instant: true } : held.current ? { spread: 6 } : {});
      placed.current = true;
      held.current = false;
    },
    () => {
      if (held.current) return;
      held.current = true;
      releaseLock(lockRef.current);
    },
  );

  // A row measured or re-wrapped under a resting selection: the lock follows without replaying the acquire.
  const lastSel = React.useRef(selIndex);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the selected row's measured box changes
  React.useLayoutEffect(() => {
    const moved = lastSel.current !== selIndex;
    lastSel.current = selIndex;
    if (moved || !placed.current || held.current || selIndex < 0) return;
    lockTo(lockRef.current, boxRef.current, { instant: true });
  }, [selIndex, box.top, box.height]);

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
              height: selH - 4,
              transform: `translateY(${selTop + 2}px)`,
              transition: "transform 300ms var(--ease-out-expo), height 200ms var(--ease-out-expo)",
            }}
          />
        ) : null}
        <TargetLock ref={lockRef} corner={9} className={selIndex < 0 ? "hidden" : undefined} />

        {virtualItems.map((v) => {
          const job = items[v.index];
          if (!job) return null;
          const selected = job.id === selectedId;
          const leaving = job.id === leavingId;
          return (
            <div
              key={v.key}
              ref={virtualizer.measureElement}
              data-index={v.index}
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
                transform: `translateY(${v.start}px)`,
                transition: "transform 320ms var(--ease-out-expo)",
              }}
            >
              <div
                className={cn(!entered && v.index < 18 && "animate-rise-in", leaving && "animate-glitch-out")}
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
