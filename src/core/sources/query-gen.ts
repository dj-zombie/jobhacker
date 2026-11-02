import { REMOTE_AREA } from '../config/schemas.js';
import type { SearchQuery } from './search.js';

/** One of Kris's places as a search location, e.g. `{ area: 'portland', location: 'Portland, OR' }`. */
export interface SearchPlace {
  area: string;
  location: string;
}

/**
 * Turn the prose in `preferences.md` into a handful of search queries.
 * Phrases are taken only from the "Roles I want" and "Where I can work"
 * sections, so editing those sections changes the next run's queries.
 * Each title runs remote and, for each of `places`, in that place
 * (PLACES § 8.1), interleaved title by title so any run of consecutive
 * queries covers the areas evenly.
 */
export function generateQueries(
  preferences: string,
  nowIso: string,
  places: readonly SearchPlace[] = [],
): SearchQuery[] {
  const want = section(preferences, 'Roles I want');
  const where = section(preferences, 'Where I can work');
  const titles: string[] = [];
  if (/front-?end|frontend/i.test(want)) titles.push('senior frontend engineer');
  if (/full-?stack/i.test(want)) titles.push('senior full stack engineer');
  if (/\baudio\b/i.test(want)) titles.push('audio software engineer');
  if (/developer tools|tools engineering/i.test(want)) titles.push('developer tools engineer');
  if (/product engineering/i.test(want)) titles.push('senior product engineer');
  if (titles.length === 0) titles.push('senior software engineer');

  const remoteOnly = /\bremote\b/i.test(where);
  const location = /\bunited states\b|\bu\.s\.\b|\bus\b/i.test(where) ? 'United States' : undefined;
  const since = new Date(Date.parse(nowIso) - 30 * 24 * 60 * 60 * 1000).toISOString();
  return titles.flatMap((title): SearchQuery[] => [
    { titles: [title], location, remoteOnly, since, area: REMOTE_AREA },
    ...places.map((place) => ({
      titles: [title],
      location: place.location,
      remoteOnly: false,
      since,
      area: place.area,
    })),
  ]);
}

/**
 * The slice of `queries` one run sends: `perRun` of them, starting where the
 * month's previous calls stopped, so the monthly budget splits evenly across
 * every query instead of the first ones taking it all.
 */
export function queriesForRun(
  queries: readonly SearchQuery[],
  callsSoFar: number,
  perRun: number,
): SearchQuery[] {
  if (queries.length === 0) return [];
  const start = callsSoFar % queries.length;
  const rotated = [...queries.slice(start), ...queries.slice(0, start)];
  return rotated.slice(0, Math.min(perRun, queries.length));
}

/** Text under a `##` heading, up to the next heading of the same or higher level. */
export function section(markdown: string, heading: string): string {
  const lines = markdown.split('\n');
  const wanted = heading.trim().toLowerCase();
  let capturing = false;
  const out: string[] = [];
  for (const line of lines) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    if (match) {
      const level = match[1]?.length ?? 0;
      const title = match[2]?.trim().toLowerCase() ?? '';
      if (capturing && level <= 2) break;
      if (level === 2 && title === wanted) capturing = true;
      continue;
    }
    if (capturing) out.push(line);
  }
  return out.join('\n');
}
