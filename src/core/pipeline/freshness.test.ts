import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import type { Criteria } from '../config/schemas.js';
import { type Db, createMigratedTestDb } from '../db/client.js';
import { companiesRepo } from '../db/repo/companies.js';
import { jobsRepo } from '../db/repo/jobs.js';
import { jobs } from '../db/schema.js';
import { TEST_PREFERENCES, testCriteria } from '../testing/fixtures.js';
import { fixedClock } from '../util/clock.js';
import type { Http } from '../util/http.js';
import { nullLogger } from '../util/logger.js';
import { runScout } from './scout.js';

const NOW = '2026-10-22T12:00:00.000Z';
const OLD = '2026-08-01T00:00:00.000Z';
const YESTERDAY = '2026-10-21T12:00:00.000Z';

let sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'];

afterEach(() => {
  sqlite?.close();
});

function freshDb(): Db {
  const made = createMigratedTestDb();
  sqlite = made.sqlite;
  return made.db;
}

function criteria(which: { hn?: boolean; jsearch?: boolean; jsearchBudget?: number }): Criteria {
  return {
    ...testCriteria(),
    sources: {
      boards: { enabled: ['greenhouse'] },
      search: {
        hn: { enabled: which.hn ?? false, monthly_call_budget: 100 },
        jsearch: {
          enabled: which.jsearch ?? false,
          monthly_call_budget: which.jsearchBudget ?? 200,
        },
        jobspipe: { enabled: false, monthly_call_budget: 0, monthly_credit_budget: 0 },
      },
      workday: { enabled: false },
    },
  };
}

function seedSearch(
  db: Db,
  row: {
    ats: 'hn' | 'jsearch';
    externalId: string;
    postedAt: string | null;
    firstSeenAt?: string;
    status?: 'new' | 'shortlisted';
  },
): void {
  const clock = fixedClock(NOW);
  const company = companiesRepo(db, clock).upsert({
    name: row.externalId,
    ats: row.ats,
    token: row.externalId,
    active: true,
    tags: ['search'],
  });
  jobsRepo(db).upsert(
    {
      companyId: company.id,
      ats: row.ats,
      externalId: row.externalId,
      title: row.externalId,
      locationRaw: 'Remote',
      remoteType: 'remote',
      employmentType: 'full_time',
      url: `https://example.com/${row.externalId}`,
      applyUrl: null,
      descriptionText: 'A stored posting.',
      compMin: null,
      compMax: null,
      compCurrency: null,
      postedAt: row.postedAt,
      contentHash: `h-${row.externalId}`,
      dedupeKey: `d-${row.externalId}`,
      sourceKind: 'search',
      sourceName: row.ats,
      sourceQuality: row.ats === 'hn' ? 'low' : 'medium',
    },
    NOW,
  );
  db.update(jobs)
    .set({
      postedAt: row.postedAt,
      ...(row.firstSeenAt ? { firstSeenAt: row.firstSeenAt } : {}),
      ...(row.status ? { status: row.status } : {}),
    })
    .where(and(eq(jobs.ats, row.ats), eq(jobs.externalId, row.externalId)))
    .run();
}

function job(db: Db, ats: 'hn' | 'jsearch', externalId: string) {
  return jobsRepo(db).find(ats, externalId);
}

const HN_COMMENT =
  'Northwind | Senior Frontend Engineer | Remote, United States | We are hiring a senior frontend engineer to build developer tools in TypeScript and React for product teams that ship weekly.';

function hnHttp(mode: 'ok' | 'fail'): Http {
  return {
    async postJson() {
      throw new Error('postJson is not used by this fake');
    },
    async getJson(url) {
      if (mode === 'fail') throw new Error(`HN down ${url}`);
      if (url.includes('search_by_date')) {
        return { hits: [{ objectID: 'story1', title: 'Who is hiring? (October 2026)' }] };
      }
      if (url.includes('comment,story_')) {
        return {
          hits: [
            {
              objectID: 'kept',
              comment_text: HN_COMMENT,
              created_at: NOW,
              author: 'hiring',
            },
          ],
          page: 0,
          nbPages: 1,
        };
      }
      throw new Error(`unexpected ${url}`);
    },
  };
}

function jsearchBody() {
  return {
    data: [
      {
        job_id: 'from-api',
        job_title: 'Senior Frontend Engineer',
        employer_name: 'InHits',
        job_apply_link: 'https://example.com/from-api',
        job_description: 'Frontend engineer for developer tools, TypeScript and React.',
        job_city: 'Portland',
        job_state: 'OR',
        job_country: 'United States',
        job_is_remote: true,
        job_posted_at_datetime_utc: YESTERDAY,
      },
    ],
  };
}

describe('close search listings', () => {
  it('an HN success closes a job missing from the feed', async () => {
    const db = freshDb();
    seedSearch(db, { ats: 'hn', externalId: 'kept', postedAt: NOW, status: 'shortlisted' });
    db.update(jobs).set({ closedAt: OLD }).where(eq(jobs.externalId, 'kept')).run();
    seedSearch(db, { ats: 'hn', externalId: 'gone', postedAt: NOW, status: 'shortlisted' });
    const result = await runScout({
      db,
      http: hnHttp('ok'),
      clock: fixedClock(NOW),
      log: nullLogger(),
      companies: [],
      criteria: criteria({ hn: true }),
      preferences: TEST_PREFERENCES,
    });
    expect(job(db, 'hn', 'gone')?.closedAt).toBe(NOW);
    expect(job(db, 'hn', 'gone')?.status).toBe('shortlisted');
    expect(job(db, 'hn', 'kept')?.closedAt).toBeNull();
    expect(result.stats.closed_shortlisted).toBe(1);
    expect(result.stats.closed).toBe(1);
  });

  it('an HN success keeps a comment that is in the response even when it is not ingested', async () => {
    const db = freshDb();
    seedSearch(db, { ats: 'hn', externalId: 'still-listed', postedAt: OLD, status: 'shortlisted' });
    seedSearch(db, { ats: 'hn', externalId: 'short-reply', postedAt: NOW });
    seedSearch(db, { ats: 'hn', externalId: 'kept', postedAt: NOW });
    seedSearch(db, { ats: 'hn', externalId: 'gone', postedAt: NOW });
    const result = await runScout({
      db,
      http: {
        async postJson() {
          throw new Error('postJson is not used by this fake');
        },
        async getJson(url) {
          if (url.includes('search_by_date')) {
            return { hits: [{ objectID: 'story1', title: 'Who is hiring? (October 2026)' }] };
          }
          if (url.includes('comment,story_')) {
            return {
              hits: [
                {
                  objectID: 'still-listed',
                  comment_text: HN_COMMENT,
                  created_at: OLD,
                  author: 'hiring',
                },
                { objectID: 'short-reply', comment_text: 'Hi', created_at: NOW, author: 'x' },
                {
                  objectID: 'kept',
                  comment_text: HN_COMMENT,
                  created_at: NOW,
                  author: 'hiring',
                },
              ],
              page: 0,
              nbPages: 1,
            };
          }
          throw new Error(`unexpected ${url}`);
        },
      },
      clock: fixedClock(NOW),
      log: nullLogger(),
      companies: [],
      criteria: criteria({ hn: true }),
      preferences: TEST_PREFERENCES,
    });
    expect(job(db, 'hn', 'gone')?.closedAt).toBe(NOW);
    expect(job(db, 'hn', 'still-listed')?.closedAt).toBeNull();
    expect(job(db, 'hn', 'still-listed')?.status).toBe('shortlisted');
    expect(job(db, 'hn', 'short-reply')?.closedAt).toBeNull();
    expect(job(db, 'hn', 'kept')?.closedAt).toBeNull();
    expect(result.stats.closed).toBe(1);
  });

  it('an HN response that does not parse closes none', async () => {
    const db = freshDb();
    seedSearch(db, { ats: 'hn', externalId: 'stays', postedAt: OLD, status: 'shortlisted' });
    const result = await runScout({
      db,
      http: {
        async postJson() {
          throw new Error('postJson is not used by this fake');
        },
        async getJson() {
          return { error: 'not a story list' };
        },
      },
      clock: fixedClock(NOW),
      log: nullLogger(),
      companies: [],
      criteria: criteria({ hn: true }),
      preferences: TEST_PREFERENCES,
    });
    expect(job(db, 'hn', 'stays')?.closedAt).toBeNull();
    expect(result.stats.closed).toBe(0);
    expect(result.stats.errors.some((error) => error.ats === 'hn')).toBe(true);
  });

  it('an HN thread this run does not finish reading closes none', async () => {
    const db = freshDb();
    seedSearch(db, { ats: 'hn', externalId: 'page-0', postedAt: NOW, status: 'shortlisted' });
    seedSearch(db, { ats: 'hn', externalId: 'absent', postedAt: NOW, status: 'shortlisted' });
    db.update(jobs).set({ lastSeenAt: OLD }).where(eq(jobs.externalId, 'page-0')).run();
    const result = await runScout({
      db,
      http: {
        async postJson() {
          throw new Error('postJson is not used by this fake');
        },
        async getJson(url) {
          if (url.includes('search_by_date')) {
            return { hits: [{ objectID: 'story1', title: 'Who is hiring? (October 2026)' }] };
          }
          const page = Number(new URL(url).searchParams.get('page') ?? '0');
          return {
            hits: [
              {
                objectID: `page-${page}`,
                comment_text: HN_COMMENT,
                created_at: NOW,
                author: 'hiring',
              },
            ],
            page,
            nbPages: 9,
          };
        },
      },
      clock: fixedClock(NOW),
      log: nullLogger(),
      companies: [],
      criteria: criteria({ hn: true }),
      preferences: TEST_PREFERENCES,
    });
    expect(job(db, 'hn', 'page-0')?.closedAt).toBeNull();
    expect(job(db, 'hn', 'page-0')?.lastSeenAt).toBe(NOW);
    expect(job(db, 'hn', 'absent')?.closedAt).toBeNull();
    expect(result.stats.closed).toBe(0);
    expect(result.stats.errors.some((error) => error.ats === 'hn')).toBe(true);
  });

  it('an HN failure closes none', async () => {
    const db = freshDb();
    seedSearch(db, { ats: 'hn', externalId: 'stays', postedAt: NOW, status: 'shortlisted' });
    const result = await runScout({
      db,
      http: hnHttp('fail'),
      clock: fixedClock(NOW),
      log: nullLogger(),
      companies: [],
      criteria: criteria({ hn: true }),
      preferences: TEST_PREFERENCES,
    });
    expect(job(db, 'hn', 'stays')?.closedAt).toBeNull();
    expect(result.stats.closed).toBe(0);
    expect(result.stats.closed_shortlisted).toBe(0);
    expect(result.stats.errors.some((error) => error.ats === 'hn')).toBe(true);
  });

  it('a JSearch success closes a job older than 30 days and leaves a job posted yesterday that was not in the hits', async () => {
    const db = freshDb();
    seedSearch(db, { ats: 'jsearch', externalId: 'old', postedAt: OLD, status: 'shortlisted' });
    seedSearch(db, {
      ats: 'jsearch',
      externalId: 'undated',
      postedAt: null,
      firstSeenAt: OLD,
    });
    seedSearch(db, { ats: 'jsearch', externalId: 'young', postedAt: YESTERDAY });
    const result = await runScout({
      db,
      http: {
        async postJson() {
          throw new Error('postJson is not used by this fake');
        },
        async getJson() {
          return jsearchBody();
        },
      },
      clock: fixedClock(NOW),
      log: nullLogger(),
      companies: [],
      criteria: criteria({ jsearch: true }),
      preferences: TEST_PREFERENCES,
      sourceKeys: { jsearch: 'test-key' },
    });
    expect(job(db, 'jsearch', 'old')?.closedAt).toBe(NOW);
    expect(job(db, 'jsearch', 'old')?.status).toBe('shortlisted');
    expect(job(db, 'jsearch', 'undated')?.closedAt).toBe(NOW);
    expect(job(db, 'jsearch', 'young')?.closedAt).toBeNull();
    expect(job(db, 'jsearch', 'from-api')?.closedAt).toBeNull();
    expect(result.stats.closed).toBe(2);
    expect(result.stats.closed_shortlisted).toBe(1);
  });

  it('a JSearch response that does not parse closes none', async () => {
    const db = freshDb();
    seedSearch(db, { ats: 'jsearch', externalId: 'old', postedAt: OLD, status: 'shortlisted' });
    const result = await runScout({
      db,
      http: {
        async postJson() {
          throw new Error('postJson is not used by this fake');
        },
        async getJson() {
          return { status: 'error', message: 'invalid key' };
        },
      },
      clock: fixedClock(NOW),
      log: nullLogger(),
      companies: [],
      criteria: criteria({ jsearch: true }),
      preferences: TEST_PREFERENCES,
      sourceKeys: { jsearch: 'test-key' },
    });
    expect(job(db, 'jsearch', 'old')?.closedAt).toBeNull();
    expect(result.stats.closed).toBe(0);
    expect(result.stats.errors.some((error) => error.ats === 'jsearch')).toBe(true);
  });

  it('a JSearch failure closes none', async () => {
    const db = freshDb();
    seedSearch(db, { ats: 'jsearch', externalId: 'old', postedAt: OLD, status: 'shortlisted' });
    const result = await runScout({
      db,
      http: {
        async postJson() {
          throw new Error('postJson is not used by this fake');
        },
        async getJson(url) {
          throw new Error(`JSearch down ${url}`);
        },
      },
      clock: fixedClock(NOW),
      log: nullLogger(),
      companies: [],
      criteria: criteria({ jsearch: true }),
      preferences: TEST_PREFERENCES,
      sourceKeys: { jsearch: 'test-key' },
    });
    expect(job(db, 'jsearch', 'old')?.closedAt).toBeNull();
    expect(result.stats.closed).toBe(0);
    expect(result.stats.errors.some((error) => error.ats === 'jsearch')).toBe(true);
  });

  it('a JSearch budget skip closes none', async () => {
    const db = freshDb();
    seedSearch(db, { ats: 'jsearch', externalId: 'old', postedAt: OLD });
    let calls = 0;
    const result = await runScout({
      db,
      http: {
        async postJson() {
          throw new Error('postJson is not used by this fake');
        },
        async getJson() {
          calls += 1;
          throw new Error('budget skip must not fetch');
        },
      },
      clock: fixedClock(NOW),
      log: nullLogger(),
      companies: [],
      criteria: criteria({ jsearch: true, jsearchBudget: 0 }),
      preferences: TEST_PREFERENCES,
      sourceKeys: { jsearch: 'test-key' },
    });
    expect(calls).toBe(0);
    expect(result.stats.search_skipped_budget).toBeGreaterThan(0);
    expect(job(db, 'jsearch', 'old')?.closedAt).toBeNull();
    expect(result.stats.closed).toBe(0);
    expect(result.stats.errors).toEqual([]);
  });

  it('a later upsert clears closed_at', () => {
    const db = freshDb();
    seedSearch(db, { ats: 'hn', externalId: 'back', postedAt: OLD, status: 'shortlisted' });
    db.update(jobs).set({ closedAt: NOW }).where(eq(jobs.externalId, 'back')).run();
    expect(job(db, 'hn', 'back')?.closedAt).toBe(NOW);
    const companyId = job(db, 'hn', 'back')?.companyId;
    if (companyId === undefined) throw new Error('missing seeded job');
    jobsRepo(db).upsert(
      {
        companyId,
        ats: 'hn',
        externalId: 'back',
        title: 'back',
        locationRaw: 'Remote',
        remoteType: 'remote',
        employmentType: 'full_time',
        url: 'https://example.com/back',
        applyUrl: null,
        descriptionText: 'A stored posting.',
        compMin: null,
        compMax: null,
        compCurrency: null,
        postedAt: YESTERDAY,
        contentHash: 'h-back',
        dedupeKey: 'd-back',
        sourceKind: 'search',
        sourceName: 'hn',
        sourceQuality: 'low',
      },
      NOW,
    );
    const reopened = job(db, 'hn', 'back');
    expect(reopened?.closedAt).toBeNull();
    expect(reopened?.status).toBe('shortlisted');
  });
});
