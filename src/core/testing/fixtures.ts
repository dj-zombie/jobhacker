import { type Criteria, DIMENSIONS, type Dimension, type Profile } from '../config/schemas.js';
import type { Db } from '../db/client.js';
import { companiesRepo } from '../db/repo/companies.js';
import { type JobWrite, jobsRepo } from '../db/repo/jobs.js';
import { DEFAULT_PLACES } from '../pipeline/places.js';
import type { Clock } from '../util/clock.js';

/** Shared test inputs. Only `*.test.ts` files import this module. */

/** A valid scoring-model output: every dimension `fill` unless overridden. */
export function scoreOutput(
  scores: Partial<Record<Dimension, number | null>> = {},
  fill: number | null = 4,
): {
  dimensions: Record<Dimension, { score: number | null; reason: string }>;
  summary: string;
  red_flags: string[];
} {
  const dimensions = Object.fromEntries(
    DIMENSIONS.map((d) => [
      d,
      { score: d in scores ? (scores[d] ?? null) : fill, reason: `${d} because` },
    ]),
  ) as Record<Dimension, { score: number | null; reason: string }>;
  return { dimensions, summary: 'A test job.', red_flags: [] };
}

/** Insert one company and a job per entry; returns the job ids in order. */
export function seedJobs(
  db: Db,
  clock: Clock,
  rows: ReadonlyArray<Partial<JobWrite> & { title: string }>,
  company = 'Acme',
): number[] {
  const companyId = companiesRepo(db, clock).upsert({
    name: company,
    ats: 'greenhouse',
    token: company.toLowerCase(),
    active: true,
    tags: [],
  }).id;
  const repo = jobsRepo(db);
  return rows.map((row, i) => {
    const externalId = row.externalId ?? `${company}-${i}`;
    repo.upsert(
      {
        companyId,
        ats: 'greenhouse',
        externalId,
        locationRaw: 'Remote, US',
        remoteType: 'remote',
        employmentType: 'full_time',
        url: `https://example.com/${externalId}`,
        applyUrl: null,
        descriptionText: 'Build things with TypeScript.',
        compMin: null,
        compMax: null,
        compCurrency: null,
        postedAt: clock.now(),
        contentHash: `hash-${externalId}`,
        dedupeKey: `dk-${externalId}`,
        ...row,
      },
      clock.now(),
    );
    const found = repo.find('greenhouse', externalId);
    if (!found) throw new Error(`seed failed for ${externalId}`);
    return found.id;
  });
}

export function testCriteria(
  overrides: {
    maxAgeDays?: number;
    blocklist?: string[];
    cap?: number;
    weights?: Partial<Criteria['weights']>;
    /** Kris's places from `DEFAULT_PLACES`, remote in the US, and `where_default` all three. */
    withPlaces?: boolean;
  } = {},
): Criteria {
  const places: Partial<Criteria> = overrides.withPlaces
    ? {
        places: DEFAULT_PLACES.places,
        remote: { countries: DEFAULT_PLACES.remoteCountries },
        where_default: ['portland', 'phoenix', 'remote'],
      }
    : {};
  return {
    ...places,
    gates: {
      max_age_days: overrides.maxAgeDays ?? 0,
      company_blocklist: overrides.blocklist ?? [],
    },
    weights: {
      role_fit: 3,
      tech_fit: 2,
      domain_interest: 2,
      seniority_fit: 2,
      logistics_fit: 4,
      comp_fit: 1,
      ...overrides.weights,
    },
    bands: { strong: 75, maybe: 55 },
    budget: {
      prescore_floor: 0,
      max_new_scores_per_run: overrides.cap ?? 100,
    },
    llm: { scoring_model: 'claude-haiku-5-5', writing_model: 'claude-sonnet-5-5' },
  };
}

export const TEST_PREFERENCES = [
  '# Job preferences',
  '## Roles I want',
  'Senior frontend and full stack engineer roles. Developer tools.',
  "## Roles I don't want",
  'No people management. Not junior or intern.',
].join('\n');

export function testProfile(): Profile {
  return {
    contact: { name: 'Tester', email: 't@example.com', phone: '1', location: 'AZ' },
    links: {},
    summary: 'Senior engineer.',
    skills: { languages: ['TypeScript'] },
    experience: [],
    projects: [],
    education: [],
    standard_answers: {},
  };
}
