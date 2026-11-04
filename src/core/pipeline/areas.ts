import { notExists, sql } from 'drizzle-orm';
import { ANYWHERE, type Criteria, REMOTE_AREA } from '../config/schemas.js';
import type { Db } from '../db/client.js';
import { areasRepo } from '../db/repo/areas.js';
import { jobAreas, jobs } from '../db/schema.js';
import { type SearchPlace, placeCities, placeRegions } from '../sources/query-gen.js';
import type { RemoteType } from '../sources/types.js';
import { type Classification, type PlacesConfig, classifyPlaces } from './places.js';

/**
 * Kris's areas (PLACES § 2–6): the classifier's config from `criteria.yaml`,
 * the Where values, and the `job_areas` rows. A view filter and a scoring
 * order, never a gate (invariant 8).
 */

type PlacesCriteria = Pick<Criteria, 'places' | 'remote' | 'where_default'>;

/** `places` plus `remote.countries`, in the classifier's shape. */
export function placesConfigFrom(criteria: PlacesCriteria): PlacesConfig {
  return {
    places: criteria.places ?? [],
    remoteCountries: criteria.remote?.countries ?? [],
  };
}

/** Every area id in config order: the places, then `remote`. */
export function areaIds(criteria: PlacesCriteria): string[] {
  return [...(criteria.places ?? []).map((place) => place.id), REMOTE_AREA];
}

/** The areas a view and a scoring batch start from. Empty means anywhere. */
export function whereDefault(criteria: PlacesCriteria): string[] {
  return criteria.where_default ?? [];
}

/**
 * A Where value: comma-separated area ids, or `anywhere` (returned as `[]`).
 * Unknown ids throw rather than silently matching nothing.
 */
export function parseWhere(value: string, criteria: PlacesCriteria): string[] {
  const parts = value
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (parts.includes(ANYWHERE)) {
    if (parts.length > 1) throw new Error(`"${ANYWHERE}" can't be combined with areas`);
    return [];
  }
  const known = areaIds(criteria);
  const unknown = parts.filter((part) => !known.includes(part));
  if (parts.length === 0 || unknown.length > 0) {
    throw new Error(
      `unknown area "${unknown.join(', ') || value}"; use ${[...known, ANYWHERE].join(', ')}`,
    );
  }
  return known.filter((id) => parts.includes(id));
}

export function areaLabel(criteria: PlacesCriteria, id: string): string {
  if (id === REMOTE_AREA) return 'Remote';
  return criteria.places?.find((place) => place.id === id)?.label ?? id;
}

/** "Portland, Phoenix or Remote", or "Anywhere" for an empty Where. */
export function whereLabel(criteria: PlacesCriteria, areas: readonly string[]): string {
  if (areas.length === 0) return 'Anywhere';
  const labels = areas.map((id) => areaLabel(criteria, id));
  if (labels.length === 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`;
}

/** Stored areas in config order, for display. */
export function sortAreas(criteria: PlacesCriteria, areas: readonly string[]): string[] {
  const order = areaIds(criteria);
  return [...areas].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/**
 * Each place in `where_default` as a search location from its first city and
 * state: "Portland, OR" (PLACES § 8.1). Remote is searched separately.
 */
export function searchPlaces(criteria: PlacesCriteria): SearchPlace[] {
  const wanted = whereDefault(criteria);
  const places = (criteria.places ?? []).filter((place) => wanted.includes(place.id));
  return places.map((place) => ({
    area: place.id,
    location: [place.cities[0], place.states[0]].filter(Boolean).join(', '),
    cities: placeCities(place),
    regions: placeRegions(place),
  }));
}

export interface AreaInput {
  title: string;
  locationRaw: string | null;
  remoteType: RemoteType;
}

/** The classifier on a stored job. Company names are never an input. */
export function classifyJob(job: AreaInput, cfg: PlacesConfig): Classification {
  return classifyPlaces(
    { location: job.locationRaw ?? '', remote: job.remoteType, title: job.title },
    cfg,
  );
}

/**
 * The scorer's location fact (PLACES § 6), so the logistics score follows the
 * same geography as the filter. Classified live, because only the classifier
 * has the evidence.
 */
export function locationFact(job: AreaInput, criteria: PlacesCriteria): string {
  const cfg = placesConfigFrom(criteria);
  const classified = classifyJob(job, cfg);
  if (classified.areas.length === 0) {
    const where = job.locationRaw?.trim() || 'no location';
    return `Location classified as: none of the candidate's places ("${where}")`;
  }
  const parts = classified.areas.map((id) =>
    id === REMOTE_AREA
      ? `Remote (${cfg.remoteCountries.join(', ')})`
      : `${areaLabel(criteria, id)} area (matched "${classified.evidence[id] ?? ''}")`,
  );
  return `Location classified as: ${parts.join('; ')}`;
}

export interface ApplyAreasResult {
  /** Jobs classified: every row in `jobs`, open or not. */
  jobs: number;
  /** Jobs whose stored areas changed. */
  changed: number;
}

/**
 * Classify every job and store its areas. Deterministic and idempotent, so it
 * runs on every scout and after any `places` edit; only changed jobs are written.
 */
export function applyAreas(db: Db, criteria: PlacesCriteria): ApplyAreasResult {
  const cfg = placesConfigFrom(criteria);
  const repo = areasRepo(db);
  const stored = repo.all();
  const rows = db
    .select({
      id: jobs.id,
      title: jobs.title,
      locationRaw: jobs.locationRaw,
      remoteType: jobs.remoteType,
    })
    .from(jobs)
    .all();
  const changes: { jobId: number; areas: string[] }[] = [];
  for (const row of rows) {
    const areas = classifyJob(row, cfg).areas;
    const before = stored.get(row.id) ?? [];
    const same = before.length === areas.length && areas.every((area) => before.includes(area));
    if (!same) changes.push({ jobId: row.id, areas });
  }
  repo.replace(changes);
  return { jobs: rows.length, changed: changes.length };
}

export interface AreaCount {
  /** An area id, or `none` for jobs in none of them. */
  area: string;
  label: string;
  /** Every stored job. */
  total: number;
  /** Open, not a duplicate, past the gates: what a view can show. */
  visible: number;
}

const visibleCase = sql<number>`coalesce(sum(case when ${jobs.duplicateOf} is null and ${jobs.closedAt} is null and json_extract(${jobs.gateResult}, '$.passed') = 1 then 1 else 0 end), 0)`;

/** Jobs per area in config order, then `none`. A job in two areas counts in both. */
export function areaCounts(db: Db, criteria: PlacesCriteria): AreaCount[] {
  const grouped = db
    .select({ area: jobAreas.area, total: sql<number>`count(*)`, visible: visibleCase })
    .from(jobAreas)
    .innerJoin(jobs, sql`${jobs.id} = ${jobAreas.jobId}`)
    .groupBy(jobAreas.area)
    .all();
  const byArea = new Map(grouped.map((row) => [row.area, row]));
  const none = db
    .select({ total: sql<number>`count(*)`, visible: visibleCase })
    .from(jobs)
    .where(
      notExists(
        db.select({ one: sql`1` }).from(jobAreas).where(sql`${jobAreas.jobId} = ${jobs.id}`),
      ),
    )
    .get();
  return [
    ...areaIds(criteria).map((area) => ({
      area,
      label: areaLabel(criteria, area),
      total: byArea.get(area)?.total ?? 0,
      visible: byArea.get(area)?.visible ?? 0,
    })),
    { area: 'none', label: 'none', total: none?.total ?? 0, visible: none?.visible ?? 0 },
  ];
}
