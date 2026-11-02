import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import type { CompanyConfig, Criteria } from '../config/schemas.js';
import { type Db, createMigratedTestDb } from '../db/client.js';
import { runsRepo } from '../db/repo/runs.js';
import { jobs } from '../db/schema.js';
import { FakeLlm } from '../llm/fake.js';
import { ashbyBoardUrl } from '../sources/ashby.js';
import { greenhouseBoardUrl } from '../sources/greenhouse.js';
import { leverBoardUrl } from '../sources/lever.js';
import { TEST_PREFERENCES, scoreOutput, testCriteria, testProfile } from '../testing/fixtures.js';
import { fixedClock } from '../util/clock.js';
import { type Http, HttpError } from '../util/http.js';
import { nullLogger } from '../util/logger.js';
import { parseScoutProgress, runScout, sourceKeysFromEnv, startScoutRun } from './scout.js';

let sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'];

afterEach(() => {
  sqlite?.close();
});

function freshDb(): Db {
  const made = createMigratedTestDb();
  sqlite = made.sqlite;
  return made.db;
}

function readFixture(name: string): unknown {
  const raw: unknown = JSON.parse(readFileSync(`tests/fixtures/${name}`, 'utf8'));
  return raw;
}

function company(
  partial: Pick<CompanyConfig, 'name' | 'ats' | 'token'> & { active?: boolean },
): CompanyConfig {
  return { active: partial.active ?? true, tags: [], ...partial };
}

/** Age gate off, so these discovery-focused tests don't depend on gating. */
const CRIT: Criteria = testCriteria({ cap: 150 });

describe('runScout', () => {
  it('inserts fixture jobs, refreshes them, then closes a posting removed from the fixture', async () => {
    const db = freshDb();
    const clock = fixedClock('2026-10-22T12:00:00.000Z');
    const greenhouse = readFixture('greenhouse-discord.json') as { jobs: { id: number }[] };
    const lever = readFixture('lever-spotify.json');
    const ashby = readFixture('ashby-ramp.json');
    const http: Http = {
      async getJson(url) {
        if (url === greenhouseBoardUrl('discord')) return greenhouse;
        if (url === leverBoardUrl('spotify')) return lever;
        if (url === ashbyBoardUrl('ramp')) return ashby;
        throw new Error(`unexpected ${url}`);
      },
    };
    const companies = [
      company({ name: 'Discord', ats: 'greenhouse', token: 'discord' }),
      company({ name: 'Spotify', ats: 'lever', token: 'spotify' }),
      company({ name: 'Ramp', ats: 'ashby', token: 'ramp' }),
      company({ name: 'Quiet', ats: 'lever', token: 'quiet', active: false }),
    ];

    const first = await runScout({
      db,
      http,
      clock,
      log: nullLogger(),
      companies,
      criteria: CRIT,
      preferences: TEST_PREFERENCES,
    });
    expect(first.ok).toBe(true);
    expect(first.stats.inserted).toBe(8);
    expect(first.stats.updated).toBe(0);
    expect(first.stats.closed).toBe(0);
    expect(first.stats.errors).toEqual([]);
    expect(first.stats.scoring).toBe('skipped');
    expect(runsRepo(db, clock).get(first.runId)?.ok).toBe(true);

    clock.advance(60_000);
    const second = await runScout({
      db,
      http,
      clock,
      log: nullLogger(),
      companies,
      criteria: CRIT,
      preferences: TEST_PREFERENCES,
    });
    expect(second.stats.inserted).toBe(0);
    expect(second.stats.updated).toBe(8);
    expect(second.stats.closed).toBe(0);
    const refreshed = db.select().from(jobs).where(eq(jobs.externalId, '8464570002')).get();
    expect(refreshed?.firstSeenAt).toBe('2026-10-22T12:00:00.000Z');
    expect(refreshed?.lastSeenAt).toBe('2026-10-22T12:01:00.000Z');
    expect(refreshed?.closedAt).toBeNull();

    const removed = greenhouse.jobs.pop();
    expect(removed?.id).toBe(8464570002);
    clock.advance(60_000);
    const third = await runScout({
      db,
      http,
      clock,
      log: nullLogger(),
      companies,
      criteria: CRIT,
      preferences: TEST_PREFERENCES,
    });
    expect(third.stats.closed).toBe(1);
    expect(third.stats.inserted).toBe(0);
    const closed = db.select().from(jobs).where(eq(jobs.externalId, '8464570002')).get();
    expect(closed?.closedAt).toBe('2026-10-22T12:02:00.000Z');
    const stillOpen = db.select().from(jobs).where(eq(jobs.externalId, '8806482002')).get();
    expect(stillOpen?.closedAt).toBeNull();
    expect(stillOpen?.lastSeenAt).toBe('2026-10-22T12:02:00.000Z');
  });

  it('records a 404 and still finishes, without closing jobs from the failed board', async () => {
    const db = freshDb();
    const clock = fixedClock('2026-10-22T12:00:00.000Z');
    const greenhouse = readFixture('greenhouse-discord.json');
    let discordFails = false;
    const calls: string[] = [];
    const http: Http = {
      async getJson(url) {
        calls.push(url);
        if (url === greenhouseBoardUrl('discord')) {
          if (discordFails) throw new HttpError(`HTTP 404 from ${url}`, url, 404);
          return greenhouse;
        }
        if (url === leverBoardUrl('spotify')) return readFixture('lever-spotify.json');
        throw new Error(`unexpected ${url}`);
      },
    };
    const companies = [
      company({ name: 'Discord', ats: 'greenhouse', token: 'discord' }),
      company({ name: 'Spotify', ats: 'lever', token: 'spotify' }),
      company({ name: 'Quiet', ats: 'lever', token: 'quiet', active: false }),
    ];

    const first = await runScout({
      db,
      http,
      clock,
      log: nullLogger(),
      companies,
      criteria: CRIT,
      preferences: TEST_PREFERENCES,
    });
    expect(first.stats.inserted).toBe(5);

    discordFails = true;
    calls.length = 0;
    clock.advance(1000);
    const second = await runScout({
      db,
      http,
      clock,
      log: nullLogger(),
      companies,
      criteria: CRIT,
      preferences: TEST_PREFERENCES,
    });
    expect(second.ok).toBe(true);
    expect(second.stats.boards_ok).toBe(1);
    expect(second.stats.boards_failed).toBe(1);
    expect(second.stats.errors).toHaveLength(1);
    expect(second.stats.errors[0]?.message).toMatch(/HTTP 404/);
    expect(second.stats.errors[0]?.token).toBe('discord');
    expect(second.stats.closed).toBe(0);
    expect(runsRepo(db, clock).get(second.runId)?.finishedAt).toBeTruthy();
    expect(runsRepo(db, clock).get(second.runId)?.ok).toBe(true);
    const discordJobs = db.select().from(jobs).where(eq(jobs.ats, 'greenhouse')).all();
    expect(discordJobs.length).toBeGreaterThan(0);
    expect(discordJobs.every((job) => job.closedAt === null)).toBe(true);
    expect(calls).not.toContain(leverBoardUrl('quiet'));
  });

  it('fails the run when every board fails', async () => {
    const db = freshDb();
    const clock = fixedClock('2026-10-22T12:00:00.000Z');
    const http: Http = {
      async getJson(url) {
        throw new HttpError(`HTTP 404 from ${url}`, url, 404);
      },
    };
    const result = await runScout({
      db,
      http,
      clock,
      log: nullLogger(),
      companies: [company({ name: 'Missing', ats: 'greenhouse', token: 'missing' })],
      criteria: CRIT,
      preferences: TEST_PREFERENCES,
    });
    expect(result.ok).toBe(false);
    expect(result.stats.errors).toHaveLength(1);
    expect(runsRepo(db, clock).get(result.runId)?.error).toBe('every board failed');
    expect(db.select().from(jobs).all()).toHaveLength(0);
  });

  it('does not close jobs when every posting on a previously good board fails to parse', async () => {
    const db = freshDb();
    const clock = fixedClock('2026-10-22T12:00:00.000Z');
    let broken = false;
    const http: Http = {
      async getJson() {
        if (broken) return { jobs: [{ id: 1 }, { title: 'no url' }] };
        return readFixture('greenhouse-discord.json');
      },
    };
    const companies = [company({ name: 'Discord', ats: 'greenhouse', token: 'discord' })];
    await runScout({
      db,
      http,
      clock,
      log: nullLogger(),
      companies,
      criteria: CRIT,
      preferences: TEST_PREFERENCES,
    });
    broken = true;
    const second = await runScout({
      db,
      http,
      clock,
      log: nullLogger(),
      companies,
      criteria: CRIT,
      preferences: TEST_PREFERENCES,
    });
    expect(second.ok).toBe(false);
    expect(second.stats.errors[0]?.message).toMatch(/none could be parsed/);
    expect(second.stats.closed).toBe(0);
    expect(
      db
        .select()
        .from(jobs)
        .all()
        .every((job) => job.closedAt === null),
    ).toBe(true);
  });

  it('flags a later posting with the same company, title, and location', async () => {
    const db = freshDb();
    const clock = fixedClock('2026-10-22T12:00:00.000Z');
    const http: Http = {
      async getJson(url) {
        const id =
          url === greenhouseBoardUrl('a') ? 101 : url === greenhouseBoardUrl('b') ? 202 : 0;
        if (id === 0) throw new Error(`unexpected ${url}`);
        return {
          jobs: [
            {
              id,
              title: 'Staff Engineer',
              absolute_url: `https://boards.greenhouse.io/x/jobs/${id}`,
              location: { name: 'Remote' },
              content: '<p>Build things.</p>',
              first_published: '2026-10-01T00:00:00.000Z',
            },
            {
              id: id + 1,
              title: 'Other Role',
              absolute_url: `https://boards.greenhouse.io/x/jobs/${id + 1}`,
              location: { name: `Austin ${id}` },
              content: '<p>Something else.</p>',
              first_published: '2026-10-01T00:00:00.000Z',
            },
          ],
        };
      },
    };
    const result = await runScout({
      db,
      http,
      clock,
      log: nullLogger(),
      companies: [
        company({ name: 'Acme', ats: 'greenhouse', token: 'a' }),
        company({ name: 'Acme', ats: 'greenhouse', token: 'b' }),
      ],
      criteria: CRIT,
      preferences: TEST_PREFERENCES,
    });
    expect(result.stats.duplicates).toBe(1);
    const rows = db.select().from(jobs).where(eq(jobs.title, 'Staff Engineer')).all();
    const canonical = rows.find((job) => job.duplicateOf === null);
    const duplicate = rows.find((job) => job.duplicateOf !== null);
    expect(canonical?.externalId).toBe('101');
    expect(duplicate?.duplicateOf).toBe(canonical?.id);
    const other = db.select().from(jobs).where(eq(jobs.title, 'Other Role')).all();
    expect(other.every((job) => job.duplicateOf === null)).toBe(true);
  });

  it('gates after upserting and records which gate excluded each job', async () => {
    const db = freshDb();
    const clock = fixedClock('2026-10-22T12:00:00.000Z');
    const http: Http = {
      async getJson() {
        return readFixture('lever-spotify.json');
      },
    };
    const result = await runScout({
      db,
      http,
      clock,
      log: nullLogger(),
      companies: [company({ name: 'Spotify', ats: 'lever', token: 'spotify' })],
      criteria: testCriteria({ blocklist: ['spotify'] }),
      preferences: TEST_PREFERENCES,
    });
    expect(result.stats.gates?.gated.blocklist).toBe(3);
    expect(result.stats.gates?.passed).toBe(0);
    const rows = db.select().from(jobs).all();
    expect(rows.every((job) => job.status === 'filtered_out')).toBe(true);
    expect(rows.every((job) => job.gateResult?.gate === 'blocklist')).toBe(true);
  });

  it('prescores the survivors and scores them when scoring deps are given', async () => {
    const db = freshDb();
    const clock = fixedClock('2026-10-22T12:00:00.000Z');
    const http: Http = {
      async getJson() {
        return readFixture('lever-spotify.json');
      },
    };
    const llm = new FakeLlm({ responder: () => scoreOutput() });
    const result = await runScout({
      db,
      http,
      clock,
      log: nullLogger(),
      companies: [company({ name: 'Spotify', ats: 'lever', token: 'spotify' })],
      criteria: CRIT,
      preferences: TEST_PREFERENCES,
      scoring: { llm, profile: testProfile() },
    });
    expect(result.stats.prescored).toBe(3);
    expect(result.stats.scoring).not.toBe('skipped');
    if (result.stats.scoring !== 'skipped') expect(result.stats.scoring.scored).toBe(3);
    const rows = db.select().from(jobs).all();
    expect(rows.every((job) => job.prescore !== null && job.status === 'scored')).toBe(true);
  });

  it('closes every open job when a board responds with an empty list', async () => {
    const db = freshDb();
    const clock = fixedClock('2026-10-22T12:00:00.000Z');
    let empty = false;
    const http: Http = {
      async getJson() {
        return empty ? [] : readFixture('lever-spotify.json');
      },
    };
    const companies = [company({ name: 'Spotify', ats: 'lever', token: 'spotify' })];
    await runScout({
      db,
      http,
      clock,
      log: nullLogger(),
      companies,
      criteria: CRIT,
      preferences: TEST_PREFERENCES,
    });
    empty = true;
    const second = await runScout({
      db,
      http,
      clock,
      log: nullLogger(),
      companies,
      criteria: CRIT,
      preferences: TEST_PREFERENCES,
    });
    expect(second.ok).toBe(true);
    expect(second.stats.closed).toBe(3);
    expect(
      db
        .select()
        .from(jobs)
        .all()
        .every((job) => job.closedAt === '2026-10-22T12:00:00.000Z'),
    ).toBe(true);
  });
});

describe('scout progress', () => {
  it('records boards done before each later board is fetched, then finishes without that progress', async () => {
    const db = freshDb();
    const clock = fixedClock('2026-10-22T12:00:00.000Z');
    const seen: number[] = [];
    const http: Http = {
      async getJson(url) {
        const progress = parseScoutProgress(runsRepo(db, clock).latest('scout')?.stats);
        if (progress?.unit === 'Board') seen.push(progress.done);
        if (url === greenhouseBoardUrl('discord')) return readFixture('greenhouse-discord.json');
        if (url === leverBoardUrl('spotify')) return readFixture('lever-spotify.json');
        throw new Error(`unexpected ${url}`);
      },
    };
    const result = await runScout({
      db,
      http,
      clock,
      log: nullLogger(),
      companies: [
        company({ name: 'Discord', ats: 'greenhouse', token: 'discord' }),
        company({ name: 'Spotify', ats: 'lever', token: 'spotify' }),
      ],
      criteria: CRIT,
      preferences: TEST_PREFERENCES,
    });
    expect(seen).toEqual([0, 1]);
    expect(result.ok).toBe(true);
    expect(parseScoutProgress(runsRepo(db, clock).get(result.runId)?.stats)).toBeNull();
  });

  it('refuses to open a second scout while one is live', () => {
    const db = freshDb();
    const clock = fixedClock('2026-10-22T12:00:00.000Z');
    startScoutRun(db, clock);
    expect(() => startScoutRun(db, clock)).toThrow(/scout is running/i);
  });
});

describe('sourceKeysFromEnv', () => {
  it('reads every source key the CLI and the app pass to runScout', () => {
    const env = {
      JSEARCH_API_KEY: 'j',
      WORKABLE_API_KEY: 'w',
      TEAMTAILOR_API_KEY: 't',
      OTHER: 'x',
    };
    expect(sourceKeysFromEnv(env)).toEqual({ jsearch: 'j', workable: 'w', teamtailor: 't' });
    expect(sourceKeysFromEnv({})).toEqual({
      jsearch: undefined,
      workable: undefined,
      teamtailor: undefined,
    });
  });
});
