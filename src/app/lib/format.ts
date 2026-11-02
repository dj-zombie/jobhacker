import type { Band, RemoteType, TriageState } from '@/components/jobhacker';
import { DIMENSIONS, type Dimension, type Weights } from '../../core/config/schemas.js';
import type { JobStatus, Verdict } from '../../core/db/schema.js';

/** Pure display helpers and row shapes shared by server and client components (no DB access). */

/** One row of the queue, ranked or unscored. */
export interface QueueItem {
  jobId: number;
  company: string;
  title: string;
  locationRaw: string | null;
  remoteType: string;
  url: string;
  compMin: number | null;
  compMax: number | null;
  compCurrency: string | null;
  status: JobStatus;
  /** Ranked 0–100 with the weights in use; null on the unscored tab. */
  score: number | null;
  verdict: Verdict | null;
  stale: boolean;
  /** Compact dimension scores, e.g. "R4 T4 D3 S5 L5 C–". */
  dims: string | null;
  prescore: number | null;
  /** Exact persisted scoring/defer state for an unscored job. */
  note: string | null;
  /** Registrable company domain, or null when the tile stays a monogram. */
  domain: string | null;
  /** `company_domains.source`, when a row exists. Typed tiles do not use Brandfetch. */
  logoSource: string | null;
  /** The site's own icon, only for a typed domain. */
  markUrl: string | null;
}

export const DIMENSION_LABELS: Record<Dimension, string> = {
  role_fit: 'Role',
  tech_fit: 'Tech',
  domain_interest: 'Domain',
  seniority_fit: 'Seniority',
  logistics_fit: 'Logistics',
  comp_fit: 'Comp',
};

/** `?w=3,2,2,2,4,1` ↔ weights, in `DIMENSIONS` order. */
export function encodeWeights(w: Weights): string {
  return DIMENSIONS.map((d) => w[d]).join(',');
}

export function decodeWeights(raw: string | undefined): Weights | null {
  if (!raw) return null;
  const parts = raw.split(',').map(Number);
  if (parts.length !== DIMENSIONS.length) return null;
  if (!parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 10)) return null;
  return Object.fromEntries(DIMENSIONS.map((d, i) => [d, parts[i] ?? 0])) as Weights;
}

export function sameWeights(a: Weights, b: Weights): boolean {
  return DIMENSIONS.every((d) => a[d] === b[d]);
}

export function locationLabel(row: { locationRaw: string | null; remoteType: string }): string {
  // Some sources send empty parts ("Sydney, , Australia"); drop them for display only.
  const parts = (row.locationRaw ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : row.remoteType;
}

export function compLabel(row: {
  compMin: number | null;
  compMax: number | null;
  compCurrency: string | null;
}): string {
  if (row.compMin == null && row.compMax == null) return '—';
  const currency = row.compCurrency ? ` ${row.compCurrency}` : '';
  if (row.compMin != null && row.compMax != null) {
    return `${short(row.compMin)}–${short(row.compMax)}${currency}`;
  }
  return `${short((row.compMin ?? row.compMax) as number)}${currency}`;
}

function short(value: number): string {
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(value);
}

/** The kit's band for a stored verdict: `no` is the kit's "Weak". */
export function bandOf(verdict: Verdict): Band {
  return verdict;
}

/** The triage state chip for a job, or null when the job is still just new or scored. */
export function triageStateOf(status: string): TriageState | null {
  return status === 'shortlisted' || status === 'skipped' || status === 'archived' ? status : null;
}

export function remoteTypeOf(value: string): RemoteType {
  return value === 'remote' || value === 'hybrid' || value === 'onsite' ? value : 'unknown';
}
