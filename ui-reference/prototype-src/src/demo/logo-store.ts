import { useSyncExternalStore } from "react";
import type { Band } from "@/components/jobhacker/types";
import type { Weights } from "@/components/jobhacker/tune-panel";
import type { DemoJob } from "./data";
import { bandFor, rank, type Thresholds } from "./model";

export type DemoLogoState = "found" | "confirmed" | "none" | "missing";

export interface DemoLogoRow {
  name: string;
  band: "strong" | "maybe";
  domain: string | null;
  state: DemoLogoState;
}

export interface LogoOverride {
  state: DemoLogoState;
  domain: string | null;
}

const EMPTY = new Map<string, LogoOverride>();
let overrides: ReadonlyMap<string, LogoOverride> = EMPTY;
let picker: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useLogoOverrides(): ReadonlyMap<string, LogoOverride> {
  return useSyncExternalStore(subscribe, () => overrides, () => EMPTY);
}

export function useLogoPicker(): string | null {
  return useSyncExternalStore(subscribe, () => picker, () => null);
}

export function openLogoPicker(name: string | null) {
  picker = name;
  emit();
}

export function applyLogo(name: string, next: LogoOverride) {
  const copy = new Map(overrides);
  copy.set(name, next);
  overrides = copy;
  emit();
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** A fake registrable domain for demo rows. Never a real company's site. */
export function demoDomain(name: string): string {
  const label = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `${label || "company"}.example`;
}

/**
 * The logo set on demo data: one row per company with a Strong or Maybe job.
 * A stable hash spreads them across found, confirmed, none and no domain yet,
 * so every segment has rows before anyone clicks.
 */
export function companyLogoRows(
  jobs: readonly DemoJob[],
  weights: Weights,
  thresholds: Thresholds,
  applied: ReadonlyMap<string, LogoOverride>,
): DemoLogoRow[] {
  const best = new Map<string, "strong" | "maybe">();
  for (const job of jobs) {
    if (!job.dims || job.state === "skipped" || job.state === "archived") continue;
    const band: Band = bandFor(rank(job.dims, weights), thresholds);
    if (band !== "strong" && band !== "maybe") continue;
    const prev = best.get(job.company);
    if (!prev || band === "strong") best.set(job.company, band);
  }
  const rows: DemoLogoRow[] = [];
  for (const [name, band] of best) {
    const over = applied.get(name);
    if (over) {
      rows.push({ name, band, domain: over.domain, state: over.state });
      continue;
    }
    const bucket = hash(name) % 6;
    if (bucket === 0) rows.push({ name, band, domain: null, state: "missing" });
    else if (bucket === 1) rows.push({ name, band, domain: null, state: "none" });
    else if (bucket === 2) rows.push({ name, band, domain: demoDomain(name), state: "confirmed" });
    else rows.push({ name, band, domain: demoDomain(name), state: "found" });
  }
  rows.sort((a, b) => {
    if (a.band !== b.band) return a.band === "strong" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return rows;
}

export function logosMissing(rows: readonly DemoLogoRow[]): number {
  return rows.filter((row) => row.state === "missing").length;
}
