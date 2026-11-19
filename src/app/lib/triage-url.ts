import type { TriageView } from '../../core/pipeline/triage-view.js';

/**
 * The triage views' URL state (J5): `where` and `seen` live in the search params, so a copied URL
 * reopens the same view. Shared by the server pages and the client, so no server imports here.
 */

export const TRIAGE_PATH: Record<TriageView, string> = {
  top: '/matches',
  new: '/new',
  shortlist: '/shortlist',
  unscored: '/unscored',
};

/**
 * Legacy `?view=` values and where they live now. The J4 queue used `matches/new/shortlist/
 * unscored`; the J6 weights panel used `review/ranked`. J23 moved Top matches off `/` to
 * `/matches` (D168), so `matches/review/ranked` land there. Pure, so both route pages can call it.
 */
const MOVED_VIEW: Record<string, string> = {
  matches: '/matches',
  review: '/matches',
  ranked: '/matches',
  new: '/new',
  shortlist: '/shortlist',
  unscored: '/unscored',
};

/** The path a legacy `?view=` link should redirect to, keeping `where`/`seen`, or null. */
export function legacyViewHref(
  view: string | undefined,
  keep: { where?: string; seen?: string; industry?: string },
): string | null {
  if (!view) return null;
  const moved = MOVED_VIEW[view];
  if (!moved) return null;
  const p = new URLSearchParams();
  if (keep.where) p.set('where', keep.where);
  if (keep.seen) p.set('seen', keep.seen);
  if (keep.industry) p.set('industry', keep.industry);
  const q = p.toString().replaceAll('%2C', ',');
  return `${moved}${q ? `?${q}` : ''}`;
}

export const SEEN_VALUES = ['any', '24h', '7d', '30d'] as const;
export type Seen = (typeof SEEN_VALUES)[number];

export const SEEN_HOURS: Record<Seen, number | null> = {
  any: null,
  '24h': 24,
  '7d': 168,
  '30d': 720,
};

export const SEEN_LABEL: Record<Seen, string> = {
  any: 'Any time',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

export function parseSeen(raw: string | null | undefined): Seen {
  return SEEN_VALUES.find((s) => s === raw) ?? 'any';
}

/**
 * `?where=` as area ids: absent means `defaults`, `anywhere` means `[]`. Unknown ids are dropped
 * (a renamed place in an old link), and a value with none left falls back to `defaults`.
 */
export function parseWhereParam(
  raw: string | null | undefined,
  known: readonly string[],
  defaults: readonly string[],
): string[] {
  if (raw == null || raw === '') return [...defaults];
  const parts = raw.split(',').map((p) => p.trim().toLowerCase());
  if (parts.includes('anywhere')) return [];
  const ids = known.filter((id) => parts.includes(id));
  return ids.length ? ids : [...defaults];
}

/**
 * `?industry=` as one configured id. Absent, `all`, `any`, or an unknown id
 * means every industry.
 */
export function parseIndustryParam(
  raw: string | null | undefined,
  known: readonly string[],
): string | null {
  if (raw == null || raw === '') return null;
  const id = raw.trim().toLowerCase();
  if (id === 'all' || id === 'any') return null;
  return known.includes(id) ? id : null;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/**
 * Where ⌘K sends a job. A job the current Where would hide switches to Anywhere (PLACES § 7).
 * A time filter is dropped: it can hide the job, and the row then isn't in the list.
 * A weak job opens on the weak segment; anything else opens on All matches.
 */
export function paletteJobHref(
  query: string,
  job: { areas: readonly string[]; band: 'strong' | 'maybe' | 'no' },
  whereDefault: readonly string[],
): string {
  const params = new URLSearchParams(query.replace(/^\?/, ''));
  const whereRaw = params.get('where');
  const where = whereRaw === 'anywhere' ? [] : whereRaw ? whereRaw.split(',') : whereDefault;
  const hidden = where.length > 0 && !job.areas.some((area) => where.includes(area));
  if (hidden) params.set('where', 'anywhere');
  if (job.band === 'no') params.set('segment', 'weak');
  else params.delete('segment');
  params.delete('seen');
  params.delete('industry');
  const qs = params.toString().replaceAll('%2C', ',');
  return qs ? `/matches?${qs}` : '/matches';
}

/** The query string for a view's state; the default Where and Seen are left out. */
export function triageQuery(
  where: readonly string[],
  seen: Seen,
  defaults: readonly string[],
  known: readonly string[],
  industry?: string | null,
): string {
  const p = new URLSearchParams();
  if (!sameSet(where, defaults)) {
    p.set('where', where.length ? known.filter((id) => where.includes(id)).join(',') : 'anywhere');
  }
  if (seen !== 'any') p.set('seen', seen);
  if (industry) p.set('industry', industry);
  const q = p.toString().replaceAll('%2C', ',');
  return q ? `?${q}` : '';
}
