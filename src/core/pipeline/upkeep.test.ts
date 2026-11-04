import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { MoveError, moveBoard } from '../config/companies-file.js';
import { loadConfigFile } from '../config/load.js';
import { type Criteria, companiesSchema } from '../config/schemas.js';
import { type Db, createMigratedTestDb } from '../db/client.js';
import { runsRepo } from '../db/repo/runs.js';
import { scoresRepo } from '../db/repo/scores.js';
import { companies, jobScores, jobs } from '../db/schema.js';
import { ashbyBoardUrl } from '../sources/ashby.js';
import { readCache } from '../sources/discover.js';
import { greenhouseBoardUrl } from '../sources/greenhouse.js';
import { TEST_PREFERENCES, scoreOutput, testCriteria } from '../testing/fixtures.js';
import { fixedClock } from '../util/clock.js';
import { type Http, HttpError } from '../util/http.js';
import { nullLogger } from '../util/logger.js';
import { triageJob } from './review.js';
import { scoutCard } from './scout-card.js';
import { formatScoutSummary, runScout, startScoutRun } from './scout.js';
import { relocateLatestScout } from './upkeep.js';

const NOW = '2026-11-03T12:00:00.000Z';

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

/** A config dir holding `companies.yaml`, and a discovery cache next to it. */
function configDir(companiesYaml: string, cache: Record<string, string> = {}) {
  dir = mkdtempSync(join(tmpdir(), 'jobhacker-upkeep-'));
  writeFileSync(join(dir, 'companies.yaml'), companiesYaml);
  const cachePath = join(dir, 'discover-cache.json');
  writeFileSync(cachePath, JSON.stringify({ version: 1, entries: cache }));
  return { dir, cachePath };
}

function listed(configPath: string) {
  return loadConfigFile('companies', companiesSchema, configPath).companies;
}

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(`tests/fixtures/${name}`, 'utf8'));
}

function criteria(hn: boolean): Criteria {
  return {
    ...testCriteria(),
    sources: {
      boards: { enabled: ['greenhouse', 'lever', 'ashby', 'smartrecruiters'] },
      search: {
        hn: { enabled: hn, monthly_call_budget: 100 },
        jsearch: { enabled: false, monthly_call_budget: 0 },
        jobspipe: { enabled: false, monthly_call_budget: 0, monthly_credit_budget: 0 },
      },
      workday: { enabled: false },
    },
  };
}

function hnComment(id: string, company: string, link: string) {
  return {
    objectID: id,
    comment_text: `${company} | Senior Frontend Engineer | Remote, United States | We build developer tools in TypeScript and React. Apply: ${link}`,
    created_at: NOW,
    author: 'hiring',
  };
}

/**
 * HN answers with `comments`; `boards` answers board URLs; every other URL is a 404.
 * `calls` records the board URLs asked for.
 */
function fakeHttp(
  comments: ReturnType<typeof hnComment>[],
  boards: Record<string, unknown> = {},
): Http & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async postJson() {
      throw new Error('postJson is not used by this fake');
    },
    async getJson(url) {
      if (url.includes('search_by_date')) {
        return { hits: [{ objectID: 'story1', title: 'Who is hiring? (November 2026)' }] };
      }
      if (url.includes('comment,story_')) return { hits: comments, page: 0, nbPages: 1 };
      calls.push(url);
      if (url in boards) return boards[url];
      throw new HttpError(`HTTP 404 from ${url}`, url, 404);
    },
  };
}

describe('harvest after each scout', () => {
  it('appends an unknown Ashby board a hit links, and skips listed, cached and unreadable links', async () => {
    const db = freshDb();
    const clock = fixedClock(NOW);
    const config = configDir(
      [
        'companies:',
        '  - name: Listed Co',
        '    ats: ashby',
        '    token: listed-co',
        '    active: false',
        '    tags: []',
        '',
      ].join('\n'),
      { 'ashby:cached-miss': 'miss' },
    );
    const http = fakeHttp(
      [
        hnComment('c1', 'NewCo', 'https://jobs.ashbyhq.com/newco/2f1e8a7c-1b2d'),
        hnComment('c2', 'Listed Co', 'https://jobs.ashbyhq.com/Listed-Co/99'),
        hnComment('c3', 'Cached Miss', 'https://jobs.ashbyhq.com/cached-miss'),
        hnComment('c4', 'Work Co', 'https://apply.workable.com/work-co/j/AB12CD/'),
        hnComment('c5', 'Plain Co', 'https://example.com/careers'),
      ],
      { [ashbyBoardUrl('newco')]: fixture('ashby-ramp.json') },
    );

    const result = await runScout({
      db,
      http,
      clock,
      log: nullLogger(),
      companies: listed(config.dir),
      criteria: criteria(true),
      preferences: TEST_PREFERENCES,
      upkeep: config,
    });

    expect(result.stats.harvest).toEqual({
      linked: 3,
      known: 2,
      probed: 1,
      added: 1,
      waiting: 0,
      errors: 0,
      unreadable: 1,
      unreadable_by_ats: { workable: 1 },
    });
    expect(http.calls).toEqual([ashbyBoardUrl('newco')]);
    expect(listed(config.dir)).toContainEqual({
      name: 'NewCo',
      ats: 'ashby',
      token: 'newco',
      active: true,
      tags: ['search-link'],
    });
    expect(readCache(config.cachePath).entries['ashby:newco']).toBe('hit');
    // Harvest only adds boards. Every hit is still stored.
    expect(db.select().from(jobs).where(eq(jobs.ats, 'hn')).all()).toHaveLength(5);
    expect(formatScoutSummary(result)).toContain(
      'harvest: 3 board links (2 listed or known), 1 probed, 1 added, 0 waiting, 0 errors, 1 unreadable (workable 1)',
    );
  });

  it('with 25 new links, probes 20 and leaves 5 for the next run', async () => {
    const db = freshDb();
    const clock = fixedClock(NOW);
    const config = configDir('companies: []\n');
    const comments = Array.from({ length: 25 }, (_, i) => {
      const n = String(i + 1).padStart(2, '0');
      return hnComment(`c${n}`, `Company ${n}`, `https://jobs.ashbyhq.com/company-${n}/1`);
    });
    const http = fakeHttp(comments);
    const deps = {
      db,
      http,
      clock,
      log: nullLogger(),
      companies: listed(config.dir),
      criteria: criteria(true),
      preferences: TEST_PREFERENCES,
      upkeep: config,
    };

    const first = await runScout(deps);
    expect(first.stats.harvest).toMatchObject({ linked: 25, known: 0, probed: 20, waiting: 5 });
    expect(http.calls).toHaveLength(20);

    clock.advance(60_000);
    const second = await runScout(deps);
    expect(second.stats.harvest).toMatchObject({ linked: 25, known: 20, probed: 5, waiting: 0 });
    expect(http.calls).toHaveLength(25);
    expect(new Set(http.calls).size).toBe(25);
  });

  it('is off when the caller passes no upkeep', async () => {
    const db = freshDb();
    const result = await runScout({
      db,
      http: fakeHttp([hnComment('c1', 'NewCo', 'https://jobs.ashbyhq.com/newco/1')]),
      clock: fixedClock(NOW),
      log: nullLogger(),
      companies: [],
      criteria: criteria(true),
      preferences: TEST_PREFERENCES,
    });
    expect(result.stats.harvest).toBeNull();
    expect(formatScoutSummary(result)).toContain('harvest: off');
  });
});

describe('relocation in a scout', () => {
  it('records where a 404 board may have moved, and the card offers it', async () => {
    const db = freshDb();
    const clock = fixedClock(NOW);
    const config = configDir(
      [
        'companies:',
        '  - name: Acme',
        '    ats: greenhouse',
        '    token: acme',
        '    active: true',
        '    tags: []',
        '',
      ].join('\n'),
    );
    const http = fakeHttp([], { [ashbyBoardUrl('acme')]: fixture('ashby-ramp.json') });
    const result = await runScout({
      db,
      http,
      clock,
      log: nullLogger(),
      companies: listed(config.dir),
      criteria: criteria(false),
      preferences: TEST_PREFERENCES,
      upkeep: config,
    });
    expect(result.stats.relocation).toEqual([
      {
        ats: 'greenhouse',
        token: 'acme',
        name: 'Acme',
        looked: ['lever', 'ashby', 'smartrecruiters'],
        matched_hits: 0,
        unanswered: [],
        candidates: [{ ats: 'ashby', token: 'acme', name: 'Acme', postings: 3, via: 'name' }],
      },
    ]);
    // Relocation only offers. The failed board stays as it was.
    expect(listed(config.dir)).toHaveLength(1);
    expect(scoutCard(db, clock, criteria(false)).notices).toContainEqual({
      text: 'Acme: the Greenhouse board returned 404. The listing page is gone.',
      retire: { ats: 'greenhouse', token: 'acme', name: 'Acme' },
      relocate: {
        looked:
          'Looked on Lever, Ashby and SmartRecruiters, and in your search results: found 1 board',
        candidates: [{ ats: 'ashby', token: 'acme', name: 'Acme', postings: 3 }],
      },
    });
  });

  it('boards:relocate writes its result onto the latest finished scout', async () => {
    const db = freshDb();
    const clock = fixedClock(NOW);
    const config = configDir('companies: []\n');
    const runs = runsRepo(db, clock);
    const id = runs.start('scout');
    runs.finish(id, {
      ok: true,
      stats: {
        boards_ok: 1,
        errors: [
          {
            company: 'Immunefi',
            ats: 'greenhouse',
            token: 'immunefi',
            message: `HTTP 404 from ${greenhouseBoardUrl('immunefi')}`,
          },
          { company: 'Slow', ats: 'lever', token: 'slow', message: 'HTTP 503 from x' },
        ],
      },
    });
    const result = await relocateLatestScout({
      db,
      clock,
      http: fakeHttp([]),
      log: nullLogger(),
      dir: config.dir,
      cachePath: config.cachePath,
      enabled: ['greenhouse', 'lever', 'ashby'],
    });
    expect(result?.relocations.map((r) => `${r.ats}/${r.token}`)).toEqual(['greenhouse/immunefi']);
    const stored = runs.get(id)?.stats as { boards_ok: number; relocation: unknown[] };
    expect(stored.boards_ok).toBe(1);
    expect(stored.relocation).toHaveLength(1);
    expect(scoutCard(db, clock, criteria(false)).notices[0]?.relocate?.looked).toBe(
      'Looked on Lever and Ashby, and in your search results: no new board',
    );
  });
});

describe('moving a board keeps its jobs', () => {
  const BOARD = [
    'companies:',
    '  # a comment that must survive',
    '  - name: Coinhako',
    '    ats: ashby',
    '    token: coinhako',
    '    active: true',
    '    tags: [crypto]',
    '',
  ].join('\n');

  it('a moved board with a scored, shortlisted posting keeps its id, score and status', async () => {
    const db = freshDb();
    const clock = fixedClock(NOW);
    const config = configDir(BOARD);
    const ramp = fixture('ashby-ramp.json');
    const scout = async (boards: Record<string, unknown>) =>
      runScout({
        db,
        http: fakeHttp([], boards),
        clock,
        log: nullLogger(),
        companies: listed(config.dir),
        criteria: criteria(false),
        preferences: TEST_PREFERENCES,
        upkeep: config,
      });

    await scout({ [ashbyBoardUrl('coinhako')]: ramp });
    const before = db.select().from(jobs).all();
    expect(before).toHaveLength(3);
    const posting = before[0];
    if (!posting) throw new Error('no posting');
    const oldCompany = posting.companyId;
    scoresRepo(db, clock).insert({
      jobId: posting.id,
      contentHash: posting.contentHash,
      rubricVersion: 'r2',
      model: 'm',
      profileHash: 'p',
      preferencesHash: 'q',
      dimensions: scoreOutput({}, 4).dimensions,
      summary: 'summary',
      redFlags: [],
      score: 80,
      verdict: 'strong',
    });
    triageJob(db, clock, { jobId: posting.id, action: 'shortlist' });

    clock.advance(60_000);
    const gone = await scout({});
    expect(gone.stats.errors.map((e) => e.token)).toEqual(['coinhako']);

    const moved = moveBoard(
      { dir: config.dir, db, clock },
      { ats: 'ashby', token: 'coinhako' },
      {
        ats: 'ashby',
        token: 'sbi-coinhako',
        name: 'SBI Coinhako',
      },
    );
    expect(moved.how).toBe('appended');
    const file = readFileSync(join(config.dir, 'companies.yaml'), 'utf8');
    expect(file).toContain('# a comment that must survive');
    expect(listed(config.dir)).toEqual([
      { name: 'Coinhako', ats: 'ashby', token: 'coinhako', active: false, tags: ['crypto'] },
      { name: 'SBI Coinhako', ats: 'ashby', token: 'sbi-coinhako', active: true, tags: ['crypto'] },
    ]);
    expect(db.select().from(companies).where(eq(companies.token, 'coinhako')).get()?.active).toBe(
      false,
    );

    clock.advance(60_000);
    const after = await scout({ [ashbyBoardUrl('sbi-coinhako')]: ramp });
    expect(after.stats.errors).toEqual([]);
    const newCompany = db.select().from(companies).where(eq(companies.token, 'sbi-coinhako')).get();
    const job = db.select().from(jobs).where(eq(jobs.id, posting.id)).get();
    expect(job?.companyId).toBe(newCompany?.id);
    expect(job?.companyId).not.toBe(oldCompany);
    expect(job?.externalId).toBe(posting.externalId);
    expect(job?.status).toBe('shortlisted');
    expect(job?.closedAt).toBeNull();
    expect(db.select().from(jobScores).where(eq(jobScores.jobId, posting.id)).all()).toHaveLength(
      1,
    );
    expect(db.select().from(jobs).all()).toHaveLength(3);
  });

  it('a move while a scout is live is refused, and nothing changes', () => {
    const db = freshDb();
    const clock = fixedClock(NOW);
    const config = configDir(BOARD);
    startScoutRun(db, clock);
    expect(() =>
      moveBoard(
        { dir: config.dir, db, clock },
        { ats: 'ashby', token: 'coinhako' },
        {
          ats: 'ashby',
          token: 'sbi-coinhako',
          name: 'SBI Coinhako',
        },
      ),
    ).toThrow(MoveError);
    expect(readFileSync(join(config.dir, 'companies.yaml'), 'utf8')).toBe(BOARD);
  });

  it('a move to a board already listed and off turns it back on, and never deletes', () => {
    const db = freshDb();
    const clock = fixedClock(NOW);
    const config = configDir(
      `${BOARD}  - name: SBI Coinhako\n    ats: ashby\n    token: SBI-Coinhako\n    active: false\n    tags: []\n`,
    );
    const moved = moveBoard(
      { dir: config.dir, db, clock },
      { ats: 'ashby', token: 'coinhako' },
      {
        ats: 'ashby',
        token: 'sbi-coinhako',
        name: 'SBI Coinhako',
      },
    );
    expect(moved.how).toBe('reactivated');
    expect(listed(config.dir).map((c) => `${c.token}:${c.active}`)).toEqual([
      'coinhako:false',
      'SBI-Coinhako:true',
    ]);
    expect(() =>
      moveBoard(
        { dir: config.dir, db, clock },
        { ats: 'ashby', token: 'SBI-Coinhako' },
        {
          ats: 'ashby',
          token: 'sbi-coinhako',
          name: 'x',
        },
      ),
    ).toThrow(/the board that failed/);
  });
});
