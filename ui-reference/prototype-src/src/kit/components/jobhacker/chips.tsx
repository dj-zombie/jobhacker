import type * as React from "react";
import { Globe, Building2, MapPin, Shuffle, HelpCircle, CircleOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RemoteType, TriageState } from "./types";

const REMOTE: Record<RemoteType, { label: string; icon: React.ElementType; cls: string }> = {
  remote: { label: "Remote", icon: Globe, cls: "text-info bg-info-wash ring-info/20" },
  hybrid: { label: "Hybrid", icon: Shuffle, cls: "text-fg-2 bg-surface-3 ring-line-2" },
  onsite: { label: "On-site", icon: Building2, cls: "text-fg-2 bg-surface-3 ring-line-2" },
  unknown: { label: "Unclear", icon: HelpCircle, cls: "text-fg-3 bg-surface-2 ring-line" },
};

export function RemoteChip({ remote, className }: { remote: RemoteType; className?: string }) {
  const r = REMOTE[remote];
  const Icon = r.icon;
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 text-2xs font-medium ring-1 ring-inset",
        r.cls,
        className,
      )}
    >
      <Icon className="size-3" />
      {r.label}
    </span>
  );
}

const STATE: Partial<Record<TriageState, { label: string; cls: string }>> = {
  shortlisted: { label: "Shortlisted", cls: "text-brand-hi bg-brand-wash ring-brand/25" },
  prepped: { label: "Prepped", cls: "text-brand-hi bg-brand-wash ring-brand/25" },
  submitted: { label: "Submitted", cls: "text-strong bg-strong-wash ring-strong/25" },
  skipped: { label: "Skipped", cls: "text-fg-3 bg-surface-3 ring-line-2" },
  archived: { label: "Archived", cls: "text-fg-3 bg-surface-3 ring-line-2" },
};

export function StateChip({ state, className }: { state: TriageState; className?: string }) {
  const s = STATE[state];
  if (!s) return null;
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full px-1.5 text-2xs font-medium ring-1 ring-inset",
        s.cls,
        className,
      )}
    >
      {s.label}
    </span>
  );
}

/** A posting the sources no longer list. The word carries it; the color does not. */
export function ClosedChip({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-danger-wash px-1.5 text-2xs font-medium text-danger ring-1 ring-inset ring-danger/25",
        className,
      )}
    >
      <CircleOff className="size-3" />
      Closed
    </span>
  );
}

/** Thin 0–1 meter for the lexical prescore on unscored jobs. */
export function PrescoreMeter({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} title={`Prescore ${value.toFixed(2)}`}>
      <span className="h-1 w-8 overflow-hidden rounded-full bg-surface-4">
        <span className="block h-full rounded-full bg-fg-3" style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      <span className="text-2xs tnum text-fg-3">{value.toFixed(2)}</span>
    </span>
  );
}

/** Small round separator between inline metadata. */
export function Sep() {
  return <span aria-hidden className="size-0.5 shrink-0 rounded-full bg-fg-4" />;
}

/** Marks a job that's in one of the user's places. Brand-colored: it's "yours". */
export function PlaceChip({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-brand-wash px-1.5 text-2xs font-medium text-brand-hi ring-1 ring-inset ring-brand/25",
        className,
      )}
    >
      <MapPin className="size-3" />
      {label}
    </span>
  );
}
