import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { type Db, createMigratedTestDb } from '../db/client.js';
import { applicationsRepo } from '../db/repo/applications.js';
import { companiesRepo } from '../db/repo/companies.js';
import { jobsRepo } from '../db/repo/jobs.js';
import { events, companies, jobs } from '../db/schema.js';
import { FakeLlm } from '../llm/fake.js';
import { EMPLOYER_NAME_SYSTEM, groundEmployer } from '../llm/prompts/employer-name.js';
import { isPlaceholderEmployer } from '../sources/placeholder-employers.js';
import { TEST_PREFERENCES, testCriteria } from '../testing/fixtures.js';
import { type Clock, fixedClock } from '../util/clock.js';
import { dedupeKey } from '../util/hash.js';
import { nullLogger } from '../util/logger.js';
import { formatEmployerRun, nameEmployers, placeholderJobs } from './employer-names.js';
import { runScout } from './scout.js';

let sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'];
afterEach(() => sqlite?.close());

/** Job 51039's posting, recorded from JSearch on 2026-11-11 and listed there as "Remote". */
function recorded(): { job_title: string; job_description: string } {
  const body = JSON.parse(readFileSync('tests/fixtures/jsearch-details-grouped.json', 'utf8')) as {
    data: { job_title: string; job_description: string }[];
  };
  const row = body.data[0];
  if (!row) throw new Error('jsearch-details-grouped.json has no job');
  return row;
}
const RECORDED = recorded();
const OOWLISH_QUOTE =
  "Oowlish, one of Latin America's rapidly expanding software development companies, is seeking experienced technology professionals to enhance our diverse and vibrant team.";

function setup(): { db: Db; clock: Clock } {
  const t = createMigratedTestDb();
  sqlite = t.sqlite;
  return { db: t.db, clock: fixedClock('2026-11-11T22:00:00.000Z') };
}

function seed(
  db: Db,
  clock: Clock,
  externalId: string,
  opts: { company?: string; description?: string; title?: string; prepped?: boolean } = {},
): number {
  const company = opts.company ?? 'Remote';
  const title = opts.title ?? RECORDED.job_title;
  const companyId = companiesRepo(db, clock).upsert({
    name: company,
    ats: 'jsearch',
    token: company.toLowerCase(),
    active: true,
    tags: ['search'],
  }).id;
  jobsRepo(db).upsert(
    {
      companyId,
      ats: 'jsearch',
      externalId,
      title,
      locationRaw: null,
      remoteType: 'remote',
      employmentType: null,
      url: 'https://www.jobleads.com/us/job/x',
      applyUrl: 'https://www.jobleads.com/us/job/x',
      descriptionText: opts.description ?? RECORDED.job_description,
      compMin: null,
      compMax: null,
      compCurrency: null,
      postedAt: null,
      contentHash: `h-${externalId}-${opts.description?.length ?? 0}`,
      dedupeKey: dedupeKey(company, title, ''),
      sourceKind: 'search',
      sourceName: 'jsearch',
      sourceQuality: 'medium',
    },
    clock.now(),
  );
  const id = jobsRepo(db).find('jsearch', externalId)?.id ?? 0;
  if (opts.prepped) applicationsRepo(db, clock).upsertForJob({ jobId: id, status: 'prepped' });
  return id;
}

function companyOf(db: Db, jobId: number): string | undefined {
  return db
    .select({ name: companies.name })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(eq(jobs.id, jobId))
    .get()?.name;
}

function run(db: Db, clock: Clock, llm: FakeLlm, limit?: number) {
  return nameEmployers({
    db,
    llm,
    clock,
    log: nullLogger(),
    criteria: testCriteria(),
    ...(limit === undefined ? {} : { limit }),
  });
}

describe('groundEmployer', () => {
  const posting = { title: 'Senior Frontend Engineer', description: RECORDED.job_description };

  it('keeps a name and a quote that are both in the posting', () => {
    expect(
      groundEmployer({ employer: 'Oowlish', quote: OOWLISH_QUOTE }, posting, isPlaceholderEmployer),
    ).toEqual({ name: 'Oowlish', quote: OOWLISH_QUOTE });
  });

  it('refuses a name the posting never says, a made-up quote, and a placeholder', () => {
    expect(
      groundEmployer(
        { employer: 'CodiLime', quote: OOWLISH_QUOTE },
        posting,
        isPlaceholderEmployer,
      ),
    ).toEqual({ name: null, reason: 'the name is not in the posting' });
    expect(
      groundEmployer(
        { employer: 'Oowlish', quote: 'Oowlish is a Fortune 500 company.' },
        posting,
        isPlaceholderEmployer,
      ),
    ).toEqual({ name: null, reason: "the quote is not the posting's words" });
    expect(
      groundEmployer({ employer: 'Remote', quote: null }, posting, isPlaceholderEmployer),
    ).toEqual({ name: null, reason: 'the model gave a placeholder' });
    expect(groundEmployer({ employer: null, quote: null }, posting, isPlaceholderEmployer)).toEqual(
      { name: null, reason: 'the posting names no employer' },
    );
  });
});

describe('nameEmployers', () => {
  it('names Oowlish from the recorded posting and moves the job to that company', async () => {
    const { db, clock } = setup();
    const id = seed(db, clock, 'remote-1', { prepped: true });
    const llm = new FakeLlm({
      responder: (request) => {
        expect(request.system).toBe(EMPLOYER_NAME_SYSTEM);
        expect(request.user).toContain('Listed employer: Remote');
        expect(request.user).toContain('Oowlish, one of Latin America');
        return { employer: 'Oowlish', quote: OOWLISH_QUOTE };
      },
    });
    const result = await run(db, clock, llm);
    expect(llm.callCount).toBe(1);
    expect(companyOf(db, id)).toBe('Oowlish');
    const job = db.select().from(jobs).where(eq(jobs.id, id)).get();
    expect(job?.dedupeKey).toBe(dedupeKey('Oowlish', RECORDED.job_title, ''));
    expect(job?.title).toBe(RECORDED.job_title);
    expect(job?.descriptionText).toBe(RECORDED.job_description);
    expect(result.lines).toEqual([
      {
        jobId: id,
        title: RECORDED.job_title,
        listedAs: 'Remote',
        named: 'Oowlish',
        outcome: 'named',
      },
    ]);
    const read = db.select().from(events).where(eq(events.type, 'employer_read')).all();
    expect(read.map((e) => e.payload)).toEqual([
      { from: 'Remote', to: 'Oowlish', quote: OOWLISH_QUOTE, content_hash: job?.contentHash },
    ]);
    expect(db.select().from(events).where(eq(events.type, 'llm_usage')).all()).toHaveLength(1);
    expect(placeholderJobs(db)).toEqual([]);
    expect(formatEmployerRun(result)).toContain('"Remote" → Oowlish');
  });

  it('keeps the placeholder when the model names a company the posting never mentions', async () => {
    const { db, clock } = setup();
    const id = seed(db, clock, 'remote-2');
    const llm = new FakeLlm({
      responses: { 'employer-name': { employer: 'CodiLime', quote: OOWLISH_QUOTE } },
    });
    const result = await run(db, clock, llm);
    expect(companyOf(db, id)).toBe('Remote');
    expect(result.lines[0]).toMatchObject({
      outcome: 'not named',
      reason: 'the name is not in the posting',
    });
    expect(formatEmployerRun(result)).toContain('"Remote" kept: the name is not in the posting');
  });

  it('asks a posting that names no employer once, and again only when its text changes', async () => {
    const { db, clock } = setup();
    const description = 'Our client, a fast-growing fintech, needs a senior engineer.';
    const id = seed(db, clock, 'conf-1', { company: 'Confidential', description });
    const llm = new FakeLlm({ responses: { 'employer-name': { employer: null, quote: null } } });
    await run(db, clock, llm);
    const second = await run(db, clock, llm);
    expect(llm.callCount).toBe(1);
    expect(second).toMatchObject({ lines: [], unchanged: 1, waiting: 0 });
    seed(db, clock, 'conf-1', {
      company: 'Confidential',
      description: `${description} Apply now.`,
    });
    await run(db, clock, llm);
    expect(llm.callCount).toBe(2);
    expect(companyOf(db, id)).toBe('Confidential');
  });

  it('records a parse failure after one retry and changes nothing', async () => {
    const { db, clock } = setup();
    const id = seed(db, clock, 'bad');
    const llm = new FakeLlm({ responses: { 'employer-name': 'not json' } });
    const result = await run(db, clock, llm);
    expect(llm.attempts).toBe(2);
    expect(result.lines[0]?.outcome).toBe('error');
    expect(companyOf(db, id)).toBe('Remote');
    const usage = db.select().from(events).where(eq(events.type, 'llm_usage')).all();
    expect(usage.map((e) => e.payload)).toMatchObject([{ prompt: 'employer-name', failed: true }]);
  });

  it('makes no call with --limit 0, and leaves real employers alone', async () => {
    const { db, clock } = setup();
    seed(db, clock, 'remote-3');
    seed(db, clock, 'named', { company: 'Initech' });
    const llm = new FakeLlm({ responses: {} });
    const result = await run(db, clock, llm, 0);
    expect(llm.callCount).toBe(0);
    expect(result).toMatchObject({ lines: [], waiting: 1, calls: 0 });
  });

  it('re-keys copies so dedupe follows the named employer', async () => {
    const { db, clock } = setup();
    const first = seed(db, clock, 'copy-a', { company: 'Confidential' });
    const second = seed(db, clock, 'copy-b', { company: 'Confidential' });
    const lone = seed(db, clock, 'lone', { company: 'Confidential' });
    db.update(jobs).set({ duplicateOf: first }).where(eq(jobs.id, second)).run();
    db.update(jobs).set({ duplicateOf: lone }).where(eq(jobs.id, first)).run();
    let asked = 0;
    const llm = new FakeLlm({
      responder: () => {
        asked += 1;
        return asked <= 2
          ? { employer: 'Oowlish', quote: OOWLISH_QUOTE }
          : { employer: null, quote: null };
      },
    });
    const result = await run(db, clock, llm);
    expect(result.lines.map((l) => l.named)).toEqual(['Oowlish', 'Oowlish', null]);
    const row = (id: number) => db.select().from(jobs).where(eq(jobs.id, id)).get();
    const pointers = [row(first)?.duplicateOf, row(second)?.duplicateOf].filter((v) => v != null);
    expect(pointers).toHaveLength(1);
    expect([first, second]).toContain(pointers[0]);
    expect(row(lone)?.duplicateOf).toBeNull();
    expect(result.duplicates).toEqual({ before: 2, after: 1 });
  });
});

describe('scout after search:employers', () => {
  it('a later JSearch sighting listed as "Remote" keeps the employer read from the posting', async () => {
    const { db, clock } = setup();
    const id = seed(db, clock, 'seen-again');
    await run(
      db,
      clock,
      new FakeLlm({
        responses: { 'employer-name': { employer: 'Oowlish', quote: OOWLISH_QUOTE } },
      }),
    );
    const body = {
      data: [
        {
          job_id: 'seen-again',
          job_title: RECORDED.job_title,
          employer_name: 'Remote',
          employer_website: 'https://remote.com',
          job_apply_link: 'https://www.jobleads.com/us/job/x',
          job_description: RECORDED.job_description,
          job_is_remote: true,
          job_posted_at_datetime_utc: '2026-11-11T00:00:00.000Z',
        },
      ],
    };
    const base = testCriteria();
    await runScout({
      db,
      http: {
        async postJson() {
          throw new Error('postJson is not used by this fake');
        },
        async getJson() {
          return body;
        },
      },
      clock,
      log: nullLogger(),
      companies: [],
      criteria: {
        ...base,
        sources: {
          boards: { enabled: ['greenhouse'] },
          search: {
            hn: { enabled: false, monthly_call_budget: 0 },
            jsearch: { enabled: true, monthly_call_budget: 200 },
            jobspipe: { enabled: false, monthly_call_budget: 0, monthly_credit_budget: 0 },
          },
          workday: { enabled: false },
        },
      },
      preferences: TEST_PREFERENCES,
      sourceKeys: { jsearch: 'test-key' },
    });
    expect(companyOf(db, id)).toBe('Oowlish');
    const row = db.select().from(jobs).where(eq(jobs.id, id)).get();
    expect(row?.dedupeKey).toBe(dedupeKey('Oowlish', row?.title ?? '', row?.locationRaw ?? ''));
  });
});
