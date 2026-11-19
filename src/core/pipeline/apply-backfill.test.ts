import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { type Db, createMigratedTestDb } from '../db/client.js';
import { applicationsRepo } from '../db/repo/applications.js';
import { companiesRepo } from '../db/repo/companies.js';
import { jobsRepo } from '../db/repo/jobs.js';
import { jobs } from '../db/schema.js';
import { callsThisMonth } from '../sources/budget.js';
import { JSEARCH_TIMEOUT_MS } from '../sources/jsearch.js';
import type { ApplyOption } from '../sources/types.js';
import { type Clock, fixedClock } from '../util/clock.js';
import type { Http } from '../util/http.js';
import { nullLogger } from '../util/logger.js';
import { backfillApplyOptions, backfillCandidates, formatBackfill } from './apply-backfill.js';

let sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'];
afterEach(() => sqlite?.close());

type Row = Record<string, unknown>;
const DETAILS = JSON.parse(readFileSync('tests/fixtures/jsearch-details.json', 'utf8')) as {
  data: Row[];
};
const RECORDED = DETAILS.data[0] ?? {};
const BOARD = 'https://www.learn4good.com/jobs/remote/senior-frontend/1';
const ASHBY = 'https://jobs.ashbyhq.com/fabrikam/7c1e/application';

function setup(): { db: Db; clock: Clock } {
  const t = createMigratedTestDb();
  sqlite = t.sqlite;
  return { db: t.db, clock: fixedClock('2026-11-11T18:00:00.000Z') };
}

function seed(
  db: Db,
  clock: Clock,
  externalId: string,
  opts: {
    status?: 'new' | 'shortlisted';
    prepped?: boolean;
    applyOptions?: ApplyOption[] | null;
    closed?: boolean;
    ats?: string;
    company?: string;
  } = {},
): number {
  const ats = opts.ats ?? 'jsearch';
  const company = opts.company ?? 'Fabrikam';
  const companyId = companiesRepo(db, clock).upsert({
    name: company,
    ats: ats === 'jsearch' ? 'jsearch' : 'greenhouse',
    token: `t-${ats}-${company}`,
    active: true,
    tags: [],
  }).id;
  jobsRepo(db).upsert(
    {
      companyId,
      ats: ats === 'jsearch' ? 'jsearch' : 'greenhouse',
      externalId,
      title: `Engineer ${externalId}`,
      locationRaw: 'Remote, US',
      remoteType: 'remote',
      employmentType: 'full_time',
      url: BOARD,
      applyUrl: BOARD,
      applyOptions: opts.applyOptions ?? null,
      descriptionText: 'Build things.',
      compMin: null,
      compMax: null,
      compCurrency: null,
      postedAt: null,
      contentHash: `h-${externalId}`,
      dedupeKey: `dk-${externalId}`,
      sourceKind: 'search',
      sourceName: 'jsearch',
      sourceQuality: 'medium',
    },
    clock.now(),
  );
  const id = jobsRepo(db).find(ats === 'jsearch' ? 'jsearch' : 'greenhouse', externalId)?.id ?? 0;
  db.update(jobs)
    .set({ status: opts.status ?? 'shortlisted', closedAt: opts.closed ? clock.now() : null })
    .where(eq(jobs.id, id))
    .run();
  if (opts.prepped) applicationsRepo(db, clock).upsertForJob({ jobId: id, status: 'prepped' });
  return id;
}

/** A fake HTTP client answering job-details from a map of job id to body. */
function fakeHttp(bodies: Record<string, unknown>): Http & { urls: string[]; inits: unknown[] } {
  const urls: string[] = [];
  const inits: unknown[] = [];
  return {
    urls,
    inits,
    async getJson(url, init) {
      urls.push(url);
      inits.push(init);
      const id = new URL(url).searchParams.get('job_id') ?? '';
      const body = bodies[id];
      if (body instanceof Error) throw body;
      return body ?? { status: 'OK', data: [] };
    },
    async postJson() {
      throw new Error('postJson is not used');
    },
  };
}

function details(jobId: string, applyOptions: unknown[] | null, applyLink = BOARD): unknown {
  return {
    status: 'OK',
    data: [{ ...RECORDED, job_id: jobId, job_apply_link: applyLink, apply_options: applyOptions }],
  };
}

describe('backfillApplyOptions', () => {
  it('selects open shortlisted or prepped JSearch jobs with no options, prepped first', () => {
    const { db, clock } = setup();
    const a = seed(db, clock, 'a');
    const b = seed(db, clock, 'b', { status: 'new', prepped: true });
    seed(db, clock, 'c', { status: 'new' });
    seed(db, clock, 'd', { applyOptions: [] });
    seed(db, clock, 'e', { closed: true });
    seed(db, clock, 'f', { ats: 'greenhouse' });
    expect(backfillCandidates(db, 20).map((c) => c.id)).toEqual([b, a]);
    expect(backfillCandidates(db, 1).map((c) => c.id)).toEqual([b]);
  });

  it('stores the options, re-ranks apply_url, and leaves url, title and status alone', async () => {
    const { db, clock } = setup();
    const id = seed(db, clock, 'x');
    const before = db.select().from(jobs).where(eq(jobs.id, id)).get();
    const http = fakeHttp({
      x: details('x', [
        { publisher: 'learn4good', apply_link: BOARD, is_direct: false },
        { publisher: 'Fabrikam', apply_link: ASHBY, is_direct: false },
      ]),
    });
    const result = await backfillApplyOptions(
      { db, http, clock, log: nullLogger(), key: 'test-key', budget: 200 },
      { max: 20 },
    );
    expect(http.urls).toEqual(['https://api.openwebninja.com/jsearch/job-details?job_id=x']);
    expect(http.inits[0]).toEqual({
      headers: { 'x-api-key': 'test-key' },
      maxTries: 1,
      timeoutMs: JSEARCH_TIMEOUT_MS,
    });
    const after = db.select().from(jobs).where(eq(jobs.id, id)).get();
    expect(after?.applyUrl).toBe(ASHBY);
    expect(after?.applyOptions).toHaveLength(2);
    expect(after?.url).toBe(before?.url);
    expect(after?.title).toBe(before?.title);
    expect(after?.descriptionText).toBe(before?.descriptionText);
    expect(after?.companyId).toBe(before?.companyId);
    expect(after?.status).toBe(before?.status);
    expect(result.lines).toEqual([
      {
        jobId: id,
        title: 'Engineer x',
        before: 'learn4good.com',
        after: 'jobs.ashbyhq.com',
        options: 2,
        direct: 0,
        outcome: 'updated',
      },
    ]);
    expect(callsThisMonth(db, 'jsearch', clock.now())).toBe(1);
    expect(formatBackfill(result)).toContain(
      `${id}  Engineer x  learn4good.com → jobs.ashbyhq.com  2 options · 0 direct`,
    );
  });

  it("keeps another company's form out of apply_url, and ties nothing to a placeholder", async () => {
    const { db, clock } = setup();
    const other = seed(db, clock, 'other', { company: 'Initech' });
    const placeholder = seed(db, clock, 'placeholder', { company: 'Remote' });
    const options = [
      { publisher: 'learn4good', apply_link: BOARD, is_direct: false },
      { publisher: 'Fabrikam', apply_link: ASHBY, is_direct: true },
    ];
    const http = fakeHttp({
      other: details('other', options),
      placeholder: details('placeholder', options),
    });
    await backfillApplyOptions({ db, http, clock, log: nullLogger(), key: 'k', budget: 200 });
    const row = (id: number) => db.select().from(jobs).where(eq(jobs.id, id)).get();
    expect(row(other)?.applyUrl).toBe(BOARD);
    expect(row(other)?.applyOptions).toHaveLength(2);
    expect(row(placeholder)?.applyUrl).toBe(BOARD);
  });

  it('stores nothing when JSearch sends back a different job than the one asked for', async () => {
    const { db, clock } = setup();
    const id = seed(db, clock, 'asked');
    const http = fakeHttp({
      asked: details('someone-else', [{ publisher: 'Fabrikam', apply_link: ASHBY }]),
    });
    const result = await backfillApplyOptions({
      db,
      http,
      clock,
      log: nullLogger(),
      key: 'k',
      budget: 200,
    });
    const after = db.select().from(jobs).where(eq(jobs.id, id)).get();
    expect(after?.applyOptions).toBeNull();
    expect(after?.applyUrl).toBe(BOARD);
    expect(result.lines).toMatchObject([{ jobId: id, outcome: 'other job', options: null }]);
    expect(formatBackfill(result)).toContain('JSearch sent back a different job; nothing stored');
  });

  it('stores [] for a job with no options, and leaves null with "not found" for empty data', async () => {
    const { db, clock } = setup();
    const none = seed(db, clock, 'none');
    const gone = seed(db, clock, 'gone');
    const http = fakeHttp({ none: details('none', null) });
    const result = await backfillApplyOptions({
      db,
      http,
      clock,
      log: nullLogger(),
      key: 'k',
      budget: 200,
    });
    const row = (id: number) => db.select().from(jobs).where(eq(jobs.id, id)).get();
    expect(row(none)?.applyOptions).toEqual([]);
    expect(row(none)?.applyUrl).toBe(BOARD);
    expect(row(gone)?.applyOptions).toBeNull();
    expect(result.lines.map((l) => l.outcome)).toEqual(['updated', 'not found']);
    expect(formatBackfill(result)).toMatch(/gone .*not found/);
  });

  it('re-ranks stored options against the current list with no call', async () => {
    const { db, clock } = setup();
    const id = seed(db, clock, 'kept', {
      applyOptions: [
        { publisher: 'learn4good', url: BOARD, direct: false },
        { publisher: 'Fabrikam', url: ASHBY, direct: false },
      ],
    });
    seed(db, clock, 'same', {
      applyOptions: [{ publisher: 'learn4good', url: BOARD, direct: false }],
    });
    const http = fakeHttp({});
    const result = await backfillApplyOptions({
      db,
      http,
      clock,
      log: nullLogger(),
      key: 'k',
      budget: 200,
    });
    expect(http.urls).toEqual([]);
    expect(result.reranked).toEqual({ checked: 2, changed: 1 });
    expect(db.select().from(jobs).where(eq(jobs.id, id)).get()?.applyUrl).toBe(ASHBY);
    expect(result.lines).toMatchObject([
      { jobId: id, outcome: 're-ranked', after: 'jobs.ashbyhq.com' },
    ]);
    expect(formatBackfill(result)).toContain('2 options · 0 direct · stored, no call');
    expect(callsThisMonth(db, 'jsearch', clock.now())).toBe(0);
  });

  it('stops at the budget and says so', async () => {
    const { db, clock } = setup();
    seed(db, clock, 'p');
    seed(db, clock, 'q');
    const http = fakeHttp({ p: details('p', []), q: details('q', []) });
    const result = await backfillApplyOptions({
      db,
      http,
      clock,
      log: nullLogger(),
      key: 'k',
      budget: 1,
    });
    expect(http.urls).toHaveLength(1);
    expect(result.stoppedAtBudget).toEqual({ calls: 1, budget: 1 });
    expect(formatBackfill(result)).toContain(
      'stopped: JSearch is at its monthly budget (1/1 calls)',
    );
    expect(callsThisMonth(db, 'jsearch', clock.now())).toBe(1);
  });

  it('records a failed call and moves on, without a retry', async () => {
    const { db, clock } = setup();
    const bad = seed(db, clock, 'bad');
    seed(db, clock, 'ok');
    const http = fakeHttp({ bad: new Error('timeout after 45000ms'), ok: details('ok', []) });
    const result = await backfillApplyOptions({
      db,
      http,
      clock,
      log: nullLogger(),
      key: 'k',
      budget: 200,
    });
    expect(http.urls).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({ jobId: bad, outcome: 'error' });
    expect(result.lines[1]?.outcome).toBe('updated');
    expect(callsThisMonth(db, 'jsearch', clock.now())).toBe(2);
  });
});
