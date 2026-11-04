import { REMOTE_AREA } from '../config/schemas.js';
import type { SearchQuery } from './search.js';

/**
 * How far back a JSearch query looks, and how old an open JSearch job must be
 * before a successful pass closes it. One number for both (J12).
 */
export const SEARCH_SINCE_DAYS = 30;

/** ISO timestamp `SEARCH_SINCE_DAYS` before `nowIso`. */
export function searchSinceIso(nowIso: string): string {
  return new Date(Date.parse(nowIso) - SEARCH_SINCE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** One of Kris's places as a search location, e.g. `{ area: 'portland', location: 'Portland, OR' }`. */
export interface SearchPlace {
  area: string;
  location: string;
  /** Cities for JobsPipe `city_or`, including each `extra` city. */
  cities?: readonly string[];
  /** `US-` plus each two-letter state, including states named in `extra`. */
  regions?: readonly string[];
}

const TITLE_LIMIT = 60;

/** Cities of a place, plus the city in each `extra` ("Vancouver, WA"). */
export function placeCities(place: {
  cities: readonly string[];
  extra?: readonly string[];
}): string[] {
  const cities = [...place.cities];
  for (const extra of place.extra ?? []) {
    const city = extraCity(extra);
    if (!city) continue;
    if (cities.some((existing) => existing.toLowerCase() === city.toLowerCase())) continue;
    cities.push(city);
  }
  return cities;
}

/** `US-OR` for each two-letter state, including the states of `extra`. Full names are skipped. */
export function placeRegions(place: {
  states: readonly string[];
  extra?: readonly string[];
}): string[] {
  const regions: string[] = [];
  const add = (state: string) => {
    const code = state.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return;
    const region = `US-${code}`;
    if (!regions.includes(region)) regions.push(region);
  };
  for (const state of place.states) add(state);
  for (const extra of place.extra ?? []) {
    const state = /,\s*([A-Za-z]{2})\s*$/.exec(extra)?.[1];
    if (state) add(state);
  }
  return regions;
}

function extraCity(extra: string): string | null {
  const city = /^(.+?),\s*[A-Za-z]{2}\s*$/.exec(extra.trim())?.[1]?.trim();
  return city ? city : null;
}

/**
 * Titles for one JobsPipe request. A leading "senior" is dropped: seniority is
 * a scored dimension, and the title filter is a literal substring. Spelling
 * variants are added only for frontend and full stack. Nothing else is added.
 * At most 60 phrases, which is what `job_title_or` accepts.
 */
export function jobspipeTitles(titles: readonly string[]): string[] {
  const out: string[] = [];
  for (const title of titles) {
    for (const variant of titleVariants(title.replace(/^senior\s+/i, '').trim())) {
      if (!variant || out.includes(variant)) continue;
      out.push(variant);
      if (out.length >= TITLE_LIMIT) return out;
    }
  }
  return out;
}

function titleVariants(title: string): string[] {
  const front = expandToken(title, /\bfront[\s-]?end\b/i, ['frontend', 'front-end', 'front end']);
  return front.flatMap((next) =>
    expandToken(next, /\bfull[\s-]?stack\b/i, ['full stack', 'full-stack', 'fullstack']),
  );
}

function expandToken(title: string, pattern: RegExp, forms: readonly string[]): string[] {
  if (!pattern.test(title)) return [title];
  const out: string[] = [];
  for (const form of forms) {
    const next = title.replace(pattern, form);
    if (!out.includes(next)) out.push(next);
  }
  return out;
}

/**
 * One JobsPipe query per area: remote first, then each place in the order the
 * queries name them (the `where_default` places). Every title of that area is
 * in the one request.
 */
export function jobspipeQueries(queries: readonly SearchQuery[]): SearchQuery[] {
  const order: string[] = [];
  const groups = new Map<string, SearchQuery[]>();
  for (const query of queries) {
    const area = query.area ?? '';
    const group = groups.get(area);
    if (!group) {
      order.push(area);
      groups.set(area, [query]);
    } else {
      group.push(query);
    }
  }
  const remoteFirst = [
    ...order.filter((area) => area === REMOTE_AREA),
    ...order.filter((area) => area !== REMOTE_AREA),
  ];
  const out: SearchQuery[] = [];
  for (const area of remoteFirst) {
    const group = groups.get(area);
    const first = group?.[0];
    if (!group || !first) continue;
    out.push({ ...first, titles: jobspipeTitles(group.flatMap((query) => query.titles)) });
  }
  return out;
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
  remoteCountries: readonly string[] = [],
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
  const since = searchSinceIso(nowIso);
  const countries = [...remoteCountries];
  return titles.flatMap((title): SearchQuery[] => [
    {
      titles: [title],
      location,
      remoteOnly,
      since,
      area: REMOTE_AREA,
      remoteCountries: countries,
    },
    ...places.map((place) => ({
      titles: [title],
      location: place.location,
      remoteOnly: false,
      since,
      area: place.area,
      cities: place.cities ? [...place.cities] : undefined,
      regions: place.regions ? [...place.regions] : undefined,
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
