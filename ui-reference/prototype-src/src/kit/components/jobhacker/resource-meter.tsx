import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/format";

/**
 * A metered resource: a label, a value against an optional budget, and a bar that grows in once.
 * When usage reaches `warnAt` of the budget the bar turns hazard orange and a line says so, so a
 * near-limit source never reads by color alone. With no `max` it's a plain readout, e.g. the
 * model calls this month. Presentational.
 */
export function ResourceMeter({
  label,
  value,
  max,
  unit,
  warnAt = 0.85,
  className,
}: {
  label: string;
  value: number;
  /** The budget. Omit for an uncapped readout. */
  max?: number;
  /** A suffix on the numbers, e.g. "credits". */
  unit?: string;
  /** Fraction of the budget at which the bar warns. */
  warnAt?: number;
  className?: string;
}) {
  const ratio = max ? Math.min(1, value / max) : 0;
  const warn = max != null && ratio >= warnAt;
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="hud-label truncate text-fg-3">{label}</span>
        <span className="font-mono text-2xs tnum text-fg-2">
          {formatCount(value)}
          {max != null ? <span className="text-fg-4">/{formatCount(max)}</span> : null}
          {unit ? <span className="ml-1 text-fg-4">{unit}</span> : null}
        </span>
      </div>
      {max != null ? (
        <span className="mt-1.5 block h-1.5 w-full overflow-hidden bg-surface-3">
          <span
            className={cn("block h-full origin-left animate-bar-grow", warn ? "bg-danger" : "bg-strong/70")}
            style={{ width: `${Math.max(ratio * 100, 1)}%` }}
          />
        </span>
      ) : null}
      {warn ? (
        <p className="mt-1 flex items-center gap-1 text-2xs text-danger">
          <TriangleAlert aria-hidden className="size-3 shrink-0" />
          Near the monthly limit
        </p>
      ) : null}
    </div>
  );
}
