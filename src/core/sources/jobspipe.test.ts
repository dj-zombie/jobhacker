import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfigFile } from '../config/load.js';
import { type Criteria, companiesSchema, sourcesSchema } from '../config/schemas.js';
import { type Db, createMigratedTestDb } from '../db/client.js';
import { companiesRepo } from '../db/repo/companies.js';
import { jobsRepo } from '../db/repo/jobs.js';
import { jobs } from '../db/schema.js';
import { DEFAULT_PLACES } from '../pipeline/places.js';
import { scoutCard } from '../pipeline/scout-card.js';
import { runScout } from '../pipeline/scout.js';
import { computeStats, renderStats } from '../pipeline/stats.js';
import { TEST_PREFERENCES, testCriteria } from '../testing/fixtures.js';
import { fixedClock } from '../util/clock.js';
import { type Http, HttpError } from '../util/http.js';
import { nullLogger } from '../util/logger.js';
import { callsThisMonth, creditsThisMonth } from './budget.js';
import { greenhouseBoardUrl } from './greenhouse.js';
import {
  JOBSPIPE_PAGE_LIMIT,
  JOBSPIPE_SEARCH_URL,
  jobspipeAdapter,
  jobspipeBody,
  parseJobspipe,
} from './jobspipe.js';
import { jobspipeTitles, placeCities, placeRegions } from './query-gen.js';
import type { SearchQuery } from './search.js';

const NOW = '2026-10-22T12:00:00.000Z';
const DAYS = 24 * 60 * 60 * 1000;

let sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'] | undefined;
let dir: string | undefined;

afterEach(() => {
  sqlite?.close();
  sqlite = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function freshDb(): Db {
  const made = createMigratedTestDb();
  sqlite = made.sqlite;
  return made.db;
}

function daysBefore(days: number): string {
  return new Date(Date.parse(NOW) - days * DAYS).toISOString();
}

function criteria(
  options: {
    enabled?: boolean;
    calls?: number;
    credits?: number;
    places?: boolean;
  } = {},
): Criteria {
  return {
    ...testCriteria(options.places ? { withPlaces: true } : {}),
    sources: {
      boards: { enabled: ['greenhouse', 'lever', 'ashby'] },
      search: {
        hn: { enabled: false, monthly_call_budget: 0 },
        jsearch: { enabled: false, monthly_call_budget: 0 },
        jobspipe: {
          enabled: options.enabled ?? true,
          monthly_call_budget: options.calls ?? 200,
          monthly_credit_budget: options.credits ?? 1000,
        },
      },
      workday: { enabled: false },
    },
  };
}

function pipeBody(
  jobs: Record<string, unknown>[],
  creditsCharged = 1,
  creditsRemaining = 90,
): unknown {
  return {
    metadata: { credits_charged: creditsCharged, credits_remaining: creditsRemaining },
    data: jobs,
  };
}

function posting(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '100',
    job_title: 'Frontend Engineer',
    company: 'Northwind',
    url: 'https://example.com/jobs/100',
    source_url: 'https://example.com/jobs/100',
    sources: [{ provider: 'linkedin' }],
    location: 'Remote',
    remote: true,
    date_posted: '2026-10-20T00:00:00+00:00',
    description: '<p>Build tools.</p>',
    ...over,
  };
}

function fixture(): unknown {
  return JSON.parse(readFileSync('tests/fixtures/jobspipe-search.json', 'utf8'));
}

describe('parseJobspipe', () => {
  it('reads the recorded search: external id, company, url and apply url', () => {
    const raw = fixture();
    const text = readFileSync('tests/fixtures/jobspipe-search.json', 'utf8');
    expect(text).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const parsed = parseJobspipe(raw);
    expect(parsed.credits_charged).toBeLessThanOrEqual(5);
    expect(parsed.hits.length).toBeGreaterThan(0);
    for (const hit of parsed.hits) {
      expect(hit.posting.externalId).toMatch(/^[^:]+:.+$/);
      expect(hit.companyName.length).toBeGreaterThan(0);
      expect(hit.posting.url).toMatch(/^https?:\/\//);
      expect(hit.posting.applyUrl).toMatch(/^https?:\/\//);
      expect(hit.posting.ats).toBe('jobspipe');
    }
    expect(JSON.stringify(parsed.hits)).not.toContain('recruiter@');
  });

  it('skips a posting with no company, ignores estimated pay, and throws when data is missing', () => {
    const raw = fixture() as { data: Record<string, unknown>[] };
    const first = { ...raw.data[0] };
    const skipped = parseJobspipe({
      metadata: { credits_charged: 0, credits_remaining: 9 },
      data: [{ ...first, company: null, company_object: null }],
    });
    expect(skipped.hits).toHaveLength(0);
    expect(skipped.skipped.some((reason) => reason.startsWith('no company'))).toBe(true);

    const estimated = parseJobspipe(
      pipeBody([
        posting({
          salary_type: 'estimated',
          min_annual_salary: 180000,
          max_annual_salary: 220000,
          salary_currency: 'USD',
          estimated_min_annual_salary_usd: 180000,
          estimated_max_annual_salary_usd: 220000,
          recruiter_emails: ['recruiter@northwind.example'],
          applicant_count: 40,
        }),
        posting({
          id: '101',
          salary_type: 'observed',
          min_annual_salary: 120000,
          max_annual_salary: 140000,
          salary_currency: 'usd',
          estimated_min_annual_salary_usd: 90000,
        }),
      ]),
    );
    expect(estimated.hits[0]?.posting.compMin).toBeNull();
    expect(estimated.hits[0]?.posting.compMax).toBeNull();
    expect(estimated.hits[0]?.posting.compCurrency).toBeNull();
    expect(estimated.hits[1]?.posting.compMin).toBe(120000);
    expect(estimated.hits[1]?.posting.compMax).toBe(140000);
    expect(estimated.hits[1]?.posting.compCurrency).toBe('USD');
    expect(JSON.stringify(estimated.hits)).not.toContain('recruiter@northwind.example');
    expect(JSON.stringify(estimated.hits)).not.toContain('90000');

    expect(() => parseJobspipe({ metadata: { credits_charged: 0, credits_remaining: 1 } })).toThrow(
      /no listings/,
    );
  });
});

describe('jobspipe request', () => {
  it('asks for remote countries, a place by city and region, and title spellings', () => {
    const remote = jobspipeBody(
      {
        titles: ['frontend engineer'],
        remoteOnly: true,
        since: NOW,
        area: 'remote',
        remoteCountries: ['US'],
      },
      25,
    );
    expect(remote.remote).toBe(true);
    expect(remote.job_country_code_or).toEqual(['US']);
    expect(remote).not.toHaveProperty('include_technologies');
    expect(remote).not.toHaveProperty('city_or');

    const portland = DEFAULT_PLACES.places[0];
    if (!portland) throw new Error('portland missing');
    const query: SearchQuery = {
      titles: jobspipeTitles(['senior frontend engineer', 'senior full stack engineer']),
      remoteOnly: false,
      since: NOW,
      area: 'portland',
      cities: placeCities(portland),
      regions: placeRegions(portland),
    };
    const body = jobspipeBody(query, 10);
    expect(body.limit).toBe(10);
    expect(body.city_or).toContain('Vancouver');
    expect(body.region_or).toEqual(['US-OR', 'US-WA']);
    expect(body.job_country_code_or).toEqual(['US']);
    expect(body.posted_at_max_age_days).toBe(30);
    expect(body.order_by).toEqual([{ field: 'posted_at', desc: true }]);
    expect(body).not.toHaveProperty('include_technologies');
    expect(body).not.toHaveProperty('remote');
    expect(jobspipeTitles(['senior frontend engineer'])).toEqual([
      'frontend engineer',
      'front-end engineer',
      'front end engineer',
    ]);
    expect(jobspipeTitles(['senior full stack engineer'])).toEqual([
      'full stack engineer',
      'full-stack engineer',
      'fullstack engineer',
    ]);
    expect(jobspipeTitles(['audio software engineer'])).toEqual(['audio software engineer']);
    expect(body.job_title_or).toEqual([
      'frontend engineer',
      'front-end engineer',
      'front end engineer',
      'full stack engineer',
      'full-stack engineer',
      'fullstack engineer',
    ]);
  });

  it('keeps an older criteria file valid and still strict', () => {
    const parsed = sourcesSchema.parse({
      boards: { enabled: ['greenhouse'] },
      search: {
        jsearch: { enabled: false, monthly_call_budget: 0 },
        jobspipe: { enabled: true, monthly_call_budget: 200 },
        hn: { enabled: false, monthly_call_budget: 0 },
      },
      workday: { enabled: false },
    });
    expect(parsed.search.jobspipe.monthly_credit_budget).toBe(0);
    expect(() =>
      sourcesSchema.parse({
        boards: { enabled: ['greenhouse'] },
        search: {
          jsearch: { enabled: false, monthly_call_budget: 0 },
          jobspipe: { enabled: false, monthly_call_budget: 0, extra: true },
          hn: { enabled: false, monthly_call_budget: 0 },
        },
        workday: { enabled: false },
      }),
    ).toThrow();
  });
});

describe('jobspipe budget', () => {
  it('makes no call when the credit budget or the call budget is spent', async () => {
    const posts: unknown[] = [];
    const http: Http = {
      async getJson() {
        throw new Error('get');
      },
      async postJson(_url, body) {
        posts.push(body);
        return pipeBody([posting()]);
      },
    };
    const stopped = { credits: 0, calls: 0 };
    await jobspipeAdapter.search(remoteQuery(), {
      http,
      key: 'k',
      creditsLeft: () => 0,
      charge: () => {
        stopped.calls += 1;
        return true;
      },
      stopForCredits: () => {
        stopped.credits += 1;
      },
    });
    expect(posts).toHaveLength(0);
    expect(stopped.credits).toBe(1);
    expect(stopped.calls).toBe(0);

    await jobspipeAdapter.search(remoteQuery(), {
      http,
      key: 'k',
      creditsLeft: () => 100,
      charge: () => false,
    });
    expect(posts).toHaveLength(0);
  });

  it('sends limit 10 when 10 credits are left, and records the credits charged', async () => {
    const db = freshDb();
    const bodies: unknown[] = [];
    let remaining = 0;
    const http: Http = {
      async getJson() {
        throw new Error('no boards');
      },
      async postJson(_url, body) {
        bodies.push(body);
        const limit = (body as { limit: number }).limit;
        expect(limit).toBeLessThanOrEqual(JOBSPIPE_PAGE_LIMIT);
        return pipeBody([posting()], 4, 86);
      },
    };
    const result = await runScout({
      db,
      http,
      clock: fixedClock(NOW),
      log: nullLogger(),
      companies: [],
      criteria: criteria({ credits: 10 }),
      preferences: TEST_PREFERENCES,
      sourceKeys: { jobspipe: 'test-key' },
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ limit: 10 });
    expect(result.stats.jobspipe.calls).toEqual([{ credits: 4 }]);
    expect(result.stats.jobspipe.credits_remaining).toBe(86);
    expect(callsThisMonth(db, 'jobspipe', NOW)).toBe(1);
    expect(creditsThisMonth(db, 'jobspipe', NOW)).toBe(4);
    const text = renderStats(
      computeStats({ db, clock: fixedClock(NOW), criteria: criteria({ credits: 10 }) }),
    );
    expect(text).toContain('jobspipe 1/200 calls · 4/10 credits');
    expect(text).toMatch(/search\s+\d+ open jobs only from search:.*jobspipe/);
    remaining = result.stats.jobspipe.credits_remaining ?? 0;
    expect(remaining).toBe(86);
  });

  it('a 402 stops the rest of the run and the card says the credits are gone', async () => {
    const db = freshDb();
    seedPipe(db, 'old', daysBefore(31));
    let posts = 0;
    const http: Http = {
      async getJson() {
        throw new Error('no boards');
      },
      async postJson(url) {
        posts += 1;
        throw new HttpError(`HTTP 402 from ${url}: out of credits`, url, 402);
      },
    };
    const result = await runScout({
      db,
      http,
      clock: fixedClock(NOW),
      log: nullLogger(),
      companies: [],
      criteria: criteria({ places: true }),
      preferences: TEST_PREFERENCES,
      sourceKeys: { jobspipe: 'test-key' },
    });
    expect(posts).toBe(1);
    expect(result.stats.closed).toBe(0);
    const card = scoutCard(db, fixedClock(NOW), criteria({ places: true }));
    expect(card.notices.map((notice) => notice.text)).toContain(
      "JobsPipe is out of credits (402). Its free credits don't refill. Buying a package is your call.",
    );
  });

  it('a credit budget of 0 is a budget stop and closes nothing', async () => {
    const db = freshDb();
    seedPipe(db, 'old', daysBefore(31));
    let posts = 0;
    const result = await runScout({
      db,
      http: {
        async getJson() {
          throw new Error('no boards');
        },
        async postJson() {
          posts += 1;
          return pipeBody([posting()]);
        },
      },
      clock: fixedClock(NOW),
      log: nullLogger(),
      companies: [],
      criteria: criteria({ credits: 0 }),
      preferences: TEST_PREFERENCES,
      sourceKeys: { jobspipe: 'test-key' },
    });
    expect(posts).toBe(0);
    expect(result.stats.search_skipped_budget).toBeGreaterThan(0);
    expect(result.stats.closed).toBe(0);
    expect(callsThisMonth(db, 'jobspipe', NOW)).toBe(0);
  });
});

describe('jobspipe close and scout', () => {
  it('closes a job posted 31 days ago only when every area call succeeded', async () => {
    const db = freshDb();
    seedPipe(db, 'old', daysBefore(31), 'shortlisted');
    seedPipe(db, 'young', daysBefore(29));
    const result = await runScout({
      db,
      http: pipeHttp(),
      clock: fixedClock(NOW),
      log: nullLogger(),
      companies: [],
      criteria: criteria({ places: true }),
      preferences: TEST_PREFERENCES,
      sourceKeys: { jobspipe: 'test-key' },
    });
    expect(result.stats.jobspipe.calls).toHaveLength(3);
    expect(job(db, 'old')?.closedAt).toBe(NOW);
    expect(job(db, 'old')?.status).toBe('shortlisted');
    expect(job(db, 'young')?.closedAt).toBeNull();
  });

  it('a throw closes none', async () => {
    const db = freshDb();
    seedPipe(db, 'old', daysBefore(31));
    let posts = 0;
    const result = await runScout({
      db,
      http: {
        async getJson() {
          throw new Error('no boards');
        },
        async postJson() {
          posts += 1;
          throw new Error('JobsPipe down');
        },
      },
      clock: fixedClock(NOW),
      log: nullLogger(),
      companies: [],
      criteria: criteria({ places: true }),
      preferences: TEST_PREFERENCES,
      sourceKeys: { jobspipe: 'test-key' },
    });
    expect(posts).toBe(1);
    expect(job(db, 'old')?.closedAt).toBeNull();
    expect(result.stats.closed).toBe(0);
  });

  it('a call-budget stop closes none', async () => {
    const db = freshDb();
    seedPipe(db, 'old', daysBefore(31));
    let posts = 0;
    const result = await runScout({
      db,
      http: {
        async getJson() {
          throw new Error('no boards');
        },
        async postJson() {
          posts += 1;
          return pipeBody([posting()]);
        },
      },
      clock: fixedClock(NOW),
      log: nullLogger(),
      companies: [],
      criteria: criteria({ calls: 0 }),
      preferences: TEST_PREFERENCES,
      sourceKeys: { jobspipe: 'test-key' },
    });
    expect(posts).toBe(0);
    expect(job(db, 'old')?.closedAt).toBeNull();
  });

  it('dedupes against a board job, harvests a new Greenhouse board, and names a missing key', async () => {
    const db = freshDb();
    dir = mkdtempSync(join(tmpdir(), 'jobhacker-j16-'));
    const companiesYaml = [
      'companies:',
      '  - name: Acme',
      '    ats: greenhouse',
      '    token: acme',
      '    active: true',
      '    tags: []',
      '',
    ].join('\n');
    writeFileSync(join(dir, 'companies.yaml'), companiesYaml);
    const cachePath = join(dir, 'discover-cache.json');
    writeFileSync(cachePath, JSON.stringify({ version: 1, entries: {} }));
    const listed = [
      { name: 'Acme', ats: 'greenhouse' as const, token: 'acme', active: true, tags: [] },
    ];
    const http: Http = {
      async getJson(url) {
        if (url === greenhouseBoardUrl('acme')) {
          return {
            jobs: [
              {
                id: 1,
                title: 'Engineer',
                absolute_url: 'https://boards.greenhouse.io/acme/jobs/1',
                content: 'Build tools.',
                location: { name: 'Remote' },
                first_published: '2026-10-01T00:00:00.000Z',
                company_name: 'Acme',
              },
            ],
          };
        }
        if (url === greenhouseBoardUrl('newco')) {
          return {
            jobs: [
              {
                id: 99,
                title: 'Designer',
                absolute_url: 'https://boards.greenhouse.io/newco/jobs/99',
                content: 'Design tools.',
                location: { name: 'Austin, TX' },
                first_published: '2026-10-01T00:00:00.000Z',
                company_name: 'NewCo',
              },
            ],
          };
        }
        throw new Error(`unexpected ${url}`);
      },
      async postJson(url) {
        expect(url).toBe(JOBSPIPE_SEARCH_URL);
        return pipeBody([
          posting({
            id: '1',
            company: 'Acme',
            job_title: 'Engineer',
            location: 'Remote',
            sources: [{ provider: 'linkedin' }],
            url: 'https://www.linkedin.com/jobs/view/1',
            source_url: 'https://www.linkedin.com/jobs/view/1',
          }),
          posting({
            id: '99',
            company: 'NewCo',
            job_title: 'Designer',
            location: 'Austin, TX',
            sources: [{ provider: 'greenhouse' }],
            url: 'https://example.com/newco',
            source_url: 'https://boards.greenhouse.io/newco/jobs/99',
          }),
        ]);
      },
    };
    const result = await runScout({
      db,
      http,
      clock: fixedClock(NOW),
      log: nullLogger(),
      companies: listed,
      criteria: criteria(),
      preferences: TEST_PREFERENCES,
      sourceKeys: { jobspipe: 'test-key' },
      upkeep: { dir, cachePath },
    });
    const board = db.select().from(jobs).where(eq(jobs.ats, 'greenhouse')).all();
    const acme = board.find((row) => row.externalId === '1');
    const pipe = db.select().from(jobs).where(eq(jobs.externalId, 'linkedin:1')).get();
    expect(acme?.duplicateOf).toBeNull();
    expect(pipe?.duplicateOf).toBe(acme?.id);
    expect(result.stats.harvest?.added).toBe(1);
    const written = loadConfigFile('companies', companiesSchema, dir).companies;
    expect(written).toContainEqual({
      name: 'NewCo',
      ats: 'greenhouse',
      token: 'newco',
      active: true,
      tags: ['search-link'],
    });

    sqlite?.close();
    const bare = freshDb();
    await runScout({
      db: bare,
      http: {
        async getJson() {
          throw new Error('no boards');
        },
        async postJson() {
          throw new Error('must not call');
        },
      },
      clock: fixedClock(NOW),
      log: nullLogger(),
      companies: [],
      criteria: criteria(),
      preferences: TEST_PREFERENCES,
    });
    const card = scoutCard(bare, fixedClock(NOW), criteria());
    expect(card.notices.map((notice) => notice.text)).toContain(
      'JobsPipe failed: the API key is not set. Add it and run scout again.',
    );
  });
});

function remoteQuery(): SearchQuery {
  return {
    titles: ['frontend engineer'],
    remoteOnly: true,
    since: NOW,
    area: 'remote',
    remoteCountries: ['US'],
  };
}

function pipeHttp(): Http {
  return {
    async getJson() {
      throw new Error('no boards');
    },
    async postJson() {
      return pipeBody([posting({ id: 'from-api', company: 'InHits' })]);
    },
  };
}

function seedPipe(db: Db, externalId: string, postedAt: string, status?: 'shortlisted'): void {
  const clock = fixedClock(NOW);
  const company = companiesRepo(db, clock).upsert({
    name: externalId,
    ats: 'jobspipe',
    token: externalId,
    active: true,
    tags: ['search'],
  });
  jobsRepo(db).upsert(
    {
      companyId: company.id,
      ats: 'jobspipe',
      externalId,
      title: externalId,
      locationRaw: 'Remote',
      remoteType: 'remote',
      employmentType: null,
      url: `https://example.com/${externalId}`,
      applyUrl: `https://example.com/${externalId}`,
      descriptionText: 'A stored posting.',
      compMin: null,
      compMax: null,
      compCurrency: null,
      postedAt,
      contentHash: `h-${externalId}`,
      dedupeKey: `d-${externalId}`,
      sourceKind: 'search',
      sourceName: 'jobspipe',
      sourceQuality: 'medium',
    },
    NOW,
  );
  if (status) {
    db.update(jobs).set({ status, postedAt }).where(eq(jobs.externalId, externalId)).run();
  } else {
    db.update(jobs).set({ postedAt }).where(eq(jobs.externalId, externalId)).run();
  }
}

function job(db: Db, externalId: string) {
  return db.select().from(jobs).where(eq(jobs.externalId, externalId)).get();
}
