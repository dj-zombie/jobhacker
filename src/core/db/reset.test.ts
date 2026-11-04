import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../util/clock.js';
import type { Clock } from '../util/clock.js';
import { type Db, createDb, createMigratedTestDb, migrateDb } from './client.js';
import { eventsRepo } from './repo/events.js';
import { runsRepo } from './repo/runs.js';
import { applyReset, planReset } from './reset.js';
import {
  applications,
  companies,
  companyDomains,
  jobAreas,
  jobScores,
  jobs,
  sourceUsage,
  tableNames,
} from './schema.js';

const NOW = '2026-11-03T12:00:00.000Z';
let dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jobhacker-j14-'));
  dirs.push(dir);
  return dir;
}

interface Fixture {
  db: Db;
  sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'];
  a: number;
  b: number;
  c: number;
  greenhouse: number;
  hn: number;
}

/** The acceptance fixture. A and B stay. C, its score, its event and its company go. */
function seed(db: Db, clock: Clock): Fixture {
  const now = clock.now();
  const greenhouse = db
    .insert(companies)
    .values({ name: 'Northwind', ats: 'greenhouse', token: 'northwind', createdAt: now })
    .returning({ id: companies.id })
    .get();
  const hn = db
    .insert(companies)
    .values({ name: 'Search Co', ats: 'hn', token: 'search-co', createdAt: now })
    .returning({ id: companies.id })
    .get();
  if (!greenhouse || !hn) throw new Error('company insert failed');

  const insertJob = (companyId: number, externalId: string, ats: 'greenhouse' | 'hn') => {
    const row = db
      .insert(jobs)
      .values({
        companyId,
        ats,
        externalId,
        title: externalId,
        url: `https://example.com/${externalId}`,
        firstSeenAt: now,
        lastSeenAt: now,
        contentHash: externalId,
        dedupeKey: externalId,
      })
      .returning({ id: jobs.id })
      .get();
    if (!row) throw new Error('job insert failed');
    return row.id;
  };
  const a = insertJob(greenhouse.id, 'A', 'greenhouse');
  const b = insertJob(greenhouse.id, 'B', 'greenhouse');
  const c = insertJob(hn.id, 'C', 'hn');
  db.update(jobs).set({ status: 'scored', scoreState: 'current' }).where(eq(jobs.id, a)).run();
  db.update(jobs).set({ status: 'shortlisted', scoreState: 'current' }).where(eq(jobs.id, b)).run();
  db.update(jobs).set({ status: 'scored', scoreState: 'current' }).where(eq(jobs.id, c)).run();

  const score = (jobId: number) => {
    db.insert(jobScores)
      .values({
        jobId,
        contentHash: String(jobId),
        rubricVersion: 'r',
        model: 'm',
        score: 80,
        verdict: 'strong',
        createdAt: now,
      })
      .run();
  };
  score(a);
  score(c);

  const application = (jobId: number) => {
    const row = db
      .insert(applications)
      .values({ jobId, status: 'prepped', createdAt: now, updatedAt: now })
      .returning({ id: applications.id })
      .get();
    if (!row) throw new Error('application insert failed');
    return row.id;
  };
  const appA = application(a);
  application(b);
  eventsRepo(db, clock).append({ type: 'prep', jobId: a, applicationId: appA });
  eventsRepo(db, clock).append({ type: 'llm_usage', jobId: c });
  db.insert(jobAreas).values({ jobId: a, area: 'portland' }).run();
  db.insert(jobAreas).values({ jobId: c, area: 'remote' }).run();
  db.insert(companyDomains)
    .values({
      companyKey: 'northwind',
      name: 'Northwind',
      domain: 'northwind.example',
      state: 'confirmed',
      source: 'picked',
      updatedAt: now,
    })
    .run();
  db.insert(sourceUsage)
    .values({ sourceName: 'jsearch', day: '2026-11-03', calls: 8, estCostUsd: 0.4 })
    .run();
  const runId = runsRepo(db, clock).start('scout');
  runsRepo(db, clock).finish(runId, { ok: true, stats: { boards: 1 } });
  return { db, sqlite: db.$client, a, b, c, greenhouse: greenhouse.id, hn: hn.id };
}

function counts(sqlite: Database.Database): Record<string, number> {
  const out: Record<string, number> = {};
  for (const table of [...tableNames, 'source_usage']) {
    const row = sqlite.prepare(`select count(*) as n from "${table}"`).get() as { n: number };
    out[table] = row.n;
  }
  return out;
}

function fileDb(): { dir: string; path: string; db: Db; sqlite: Database.Database } {
  const dir = tempDir();
  const path = join(dir, 'queue.db');
  if (path.endsWith('jobhacker.db')) throw new Error('refusing the live database name');
  const opened = createDb(path);
  migrateDb(opened.db);
  return { dir, path, db: opened.db, sqlite: opened.sqlite };
}

describe('planReset and applyReset', () => {
  it('keeps applications and clears the rest of the queue', async () => {
    const made = createMigratedTestDb();
    const clock = fixedClock(NOW);
    const fx = seed(made.db, clock);
    const dir = tempDir();
    const before = planReset(made.db);
    expect(before).toMatchObject({
      jobs: 3,
      jobsWithApplication: 2,
      jobsWithoutApplication: 1,
      jobScores: 2,
      applications: 2,
      companyDomains: 1,
      sourceUsage: 1,
      companiesRemoved: 1,
      runs: 1,
      eventsRemoved: 1,
    });

    const result = await applyReset({
      db: made.db,
      sqlite: made.sqlite,
      destDir: dir,
      clock,
    });
    expect(result.before).toEqual(before);
    expect(existsSync(result.backupPath)).toBe(true);
    const copy = new Database(result.backupPath, { readonly: true });
    expect(counts(copy).jobs).toBe(3);
    copy.close();

    const left = made.db.select().from(jobs).all();
    expect(left.map((job) => job.id).sort()).toEqual([fx.a, fx.b].sort());
    const jobA = left.find((job) => job.id === fx.a);
    const jobB = left.find((job) => job.id === fx.b);
    expect(jobA?.status).toBe('unscored');
    expect(jobA?.scoreState).toBe('pending');
    expect(jobB?.status).toBe('shortlisted');
    expect(jobB?.scoreState).toBe('current');
    expect(made.db.select().from(jobScores).all()).toHaveLength(0);
    expect(made.db.select().from(applications).all()).toHaveLength(2);
    expect(
      made.db
        .select()
        .from(jobAreas)
        .all()
        .map((row) => row.jobId),
    ).toEqual([fx.a]);
    const events = made.sqlite.prepare('select job_id from events').all() as { job_id: number }[];
    expect(events.map((row) => row.job_id)).toEqual([fx.a]);
    expect(
      made.db
        .select()
        .from(companies)
        .all()
        .map((row) => row.id),
    ).toEqual([fx.greenhouse]);
    expect(made.db.select().from(companyDomains).all()).toHaveLength(1);
    expect(made.db.select().from(sourceUsage).all()).toHaveLength(1);
    expect(counts(made.sqlite).runs).toBe(0);
    expect(result.after).toMatchObject({
      jobs: 2,
      jobsWithApplication: 2,
      jobsWithoutApplication: 0,
      jobScores: 0,
      applications: 2,
      companyDomains: 1,
      sourceUsage: 1,
      companiesRemoved: 0,
      runs: 0,
      eventsRemoved: 0,
    });
    made.sqlite.close();
  });

  it('turns kept automated jobs unscored and leaves human statuses', async () => {
    const made = createMigratedTestDb();
    const clock = fixedClock(NOW);
    const company = made.db
      .insert(companies)
      .values({ name: 'Board', ats: 'lever', token: 'board', createdAt: NOW })
      .returning({ id: companies.id })
      .get();
    const emptyBoard = made.db
      .insert(companies)
      .values({ name: 'Empty', ats: 'ashby', token: 'empty', createdAt: NOW })
      .returning({ id: companies.id })
      .get();
    const pipe = made.db
      .insert(companies)
      .values({ name: 'Pipe', ats: 'jobspipe', token: 'pipe', createdAt: NOW })
      .returning({ id: companies.id })
      .get();
    const keptSearch = made.db
      .insert(companies)
      .values({ name: 'Kept Search', ats: 'jsearch', token: 'kept', createdAt: NOW })
      .returning({ id: companies.id })
      .get();
    if (!company || !emptyBoard || !pipe || !keptSearch) throw new Error('company insert failed');
    const add = (externalId: string, companyId: number, ats: 'lever' | 'jobspipe' | 'jsearch') => {
      const row = made.db
        .insert(jobs)
        .values({
          companyId,
          ats,
          externalId,
          title: externalId,
          url: `https://example.com/${externalId}`,
          firstSeenAt: NOW,
          lastSeenAt: NOW,
          contentHash: externalId,
          dedupeKey: externalId,
        })
        .returning({ id: jobs.id })
        .get();
      if (!row) throw new Error('job insert failed');
      return row.id;
    };
    const statuses = ['new', 'filtered_out', 'unscored', 'skipped', 'archived'] as const;
    for (const status of statuses) {
      const id = add(status, company.id, 'lever');
      made.db.update(jobs).set({ status, scoreState: 'current' }).where(eq(jobs.id, id)).run();
      made.db.insert(applications).values({ jobId: id, createdAt: NOW, updatedAt: NOW }).run();
    }
    add('gone', pipe.id, 'jobspipe');
    const stay = add('stay', keptSearch.id, 'jsearch');
    made.db.insert(applications).values({ jobId: stay, createdAt: NOW, updatedAt: NOW }).run();

    await applyReset({ db: made.db, sqlite: made.sqlite, destDir: tempDir(), clock });
    const left = made.db.select().from(jobs).all();
    const byTitle = Object.fromEntries(left.map((job) => [job.title, job]));
    for (const status of ['new', 'filtered_out', 'unscored'] as const) {
      expect(byTitle[status]?.status).toBe('unscored');
      expect(byTitle[status]?.scoreState).toBe('pending');
    }
    expect(byTitle.skipped?.status).toBe('skipped');
    expect(byTitle.skipped?.scoreState).toBe('current');
    expect(byTitle.archived?.status).toBe('archived');
    expect(byTitle.stay?.status).toBe('unscored');
    expect(byTitle.stay?.scoreState).toBe('pending');
    const names = made.db
      .select()
      .from(companies)
      .all()
      .map((row) => row.name)
      .sort();
    expect(names).toEqual(['Board', 'Empty', 'Kept Search']);
    made.sqlite.close();
  });

  it('refuses a live scout or score run before writing a backup', async () => {
    const made = createMigratedTestDb();
    const clock = fixedClock(NOW);
    seed(made.db, clock);
    runsRepo(made.db, clock).start('scout');
    const dir = tempDir();
    const before = counts(made.sqlite);
    await expect(
      applyReset({ db: made.db, sqlite: made.sqlite, destDir: dir, clock }),
    ).rejects.toThrow(/scout is running/i);
    expect(readdirSync(dir)).toEqual([]);
    expect(counts(made.sqlite)).toEqual(before);

    made.sqlite.close();
    const scoreDb = createMigratedTestDb();
    const scoreClock = fixedClock(NOW);
    seed(scoreDb.db, scoreClock);
    const scoreId = runsRepo(scoreDb.db, scoreClock).start('score');
    runsRepo(scoreDb.db, scoreClock).progress(scoreId, {
      progress: { done: 0, total: 1, found: 0 },
      first: [],
      jobIds: null,
      beatAt: NOW,
    });
    const scoreDir = tempDir();
    await expect(
      applyReset({ db: scoreDb.db, sqlite: scoreDb.sqlite, destDir: scoreDir, clock: scoreClock }),
    ).rejects.toThrow(/score run is already going/i);
    expect(readdirSync(scoreDir)).toEqual([]);
    scoreDb.sqlite.close();
  });

  it('allows a finished run, an abandoned scout, and a stalled score run', async () => {
    const made = createMigratedTestDb();
    const started = fixedClock('2026-11-03T08:00:00.000Z');
    seed(made.db, started);
    runsRepo(made.db, started).start('scout');
    const stalled = runsRepo(made.db, started).start('score');
    runsRepo(made.db, started).progress(stalled, {
      progress: { done: 0, total: 1, found: 0 },
      first: [],
      jobIds: null,
      beatAt: '2026-11-03T08:00:00.000Z',
    });
    const later = fixedClock('2026-11-03T12:01:00.000Z');
    const result = await applyReset({
      db: made.db,
      sqlite: made.sqlite,
      destDir: tempDir(),
      clock: later,
    });
    expect(result.after.runs).toBe(0);
    expect(result.after.jobs).toBe(2);
    made.sqlite.close();
  });

  it('indexes every foreign key a reset deletes through', () => {
    const { sqlite } = createMigratedTestDb();
    const missing: string[] = [];
    for (const table of [...tableNames, 'source_usage']) {
      const leading = new Set(
        (sqlite.prepare(`pragma index_list("${table}")`).all() as { name: string }[]).map(
          (index) =>
            (
              sqlite.prepare(`pragma index_info("${index.name}")`).all() as {
                seqno: number;
                name: string;
              }[]
            ).find((column) => column.seqno === 0)?.name,
        ),
      );
      const keys = sqlite.prepare(`pragma foreign_key_list("${table}")`).all() as {
        table: string;
        from: string;
      }[];
      for (const key of keys) {
        if ((key.table === 'jobs' || key.table === 'companies') && !leading.has(key.from)) {
          missing.push(`${table}.${key.from}`);
        }
      }
    }
    expect(missing).toEqual([]);
    sqlite.close();
  });
});

function runCli(args: string[], dbPath: string, backupDir: string) {
  return spawnSync('pnpm', ['exec', 'tsx', 'src/cli/index.ts', 'reset', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, DATABASE_PATH: dbPath, JOBHACKER_BACKUP_DIR: backupDir },
  });
}

describe('pnpm cli reset', { timeout: 60_000 }, () => {
  it('dry run prints the plan, writes nothing, and takes no backup', () => {
    const made = fileDb();
    seed(made.db, fixedClock(NOW));
    const before = counts(made.sqlite);
    made.sqlite.close();
    const backupDir = tempDir();
    const result = runCli([], made.path, backupDir);
    console.log(result.stdout);
    console.log(result.stderr);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('nothing written');
    expect(result.stdout).toContain('without an application');
    expect(readdirSync(backupDir)).toEqual([]);
    const again = new Database(made.path, { readonly: true });
    expect(counts(again)).toEqual(before);
    again.close();
  });

  it('reset --yes applies the plan and leaves a backup that opens', () => {
    const made = fileDb();
    seed(made.db, fixedClock(NOW));
    made.sqlite.close();
    const backupDir = tempDir();
    const result = runCli(['--yes'], made.path, backupDir);
    console.log(result.stdout);
    console.log(result.stderr);
    expect(result.status).toBe(0);
    const backup = result.stdout.match(/backup\s+(\S+)/)?.[1];
    expect(backup).toBeTruthy();
    if (!backup) return;
    expect(existsSync(backup)).toBe(true);
    const copy = new Database(backup, { readonly: true });
    expect((copy.prepare('select count(*) as n from jobs').get() as { n: number }).n).toBe(3);
    copy.close();
    const after = new Database(made.path, { readonly: true });
    const jobsLeft = after
      .prepare('select external_id, status, score_state from jobs order by external_id')
      .all() as {
      external_id: string;
      status: string;
      score_state: string;
    }[];
    expect(jobsLeft).toEqual([
      { external_id: 'A', status: 'unscored', score_state: 'pending' },
      { external_id: 'B', status: 'shortlisted', score_state: 'current' },
    ]);
    expect((after.prepare('select count(*) as n from job_scores').get() as { n: number }).n).toBe(
      0,
    );
    expect((after.prepare('select count(*) as n from applications').get() as { n: number }).n).toBe(
      2,
    );
    expect((after.prepare('select job_id from events').all() as { job_id: number }[]).length).toBe(
      1,
    );
    const companiesLeft = after.prepare('select ats from companies').all() as { ats: string }[];
    expect(companiesLeft.map((row) => row.ats)).toEqual(['greenhouse']);
    expect(
      (after.prepare('select count(*) as n from company_domains').get() as { n: number }).n,
    ).toBe(1);
    expect((after.prepare('select calls from source_usage').get() as { calls: number }).calls).toBe(
      8,
    );
    expect((after.prepare('select count(*) as n from runs').get() as { n: number }).n).toBe(0);
    expect((after.prepare('select count(*) as n from job_areas').get() as { n: number }).n).toBe(1);
    after.close();
  });

  it('a live scout makes reset and reset --yes exit 1 with no backup', () => {
    const made = fileDb();
    seed(made.db, fixedClock(NOW));
    made.sqlite
      .prepare(`insert into runs (kind, started_at) values ('scout', ?)`)
      .run(new Date().toISOString());
    const before = counts(made.sqlite);
    made.sqlite.close();
    const backupDir = tempDir();
    const dry = runCli([], made.path, backupDir);
    const yes = runCli(['--yes'], made.path, backupDir);
    console.log(dry.stderr);
    console.log(yes.stderr);
    expect(dry.status).toBe(1);
    expect(yes.status).toBe(1);
    expect(dry.stderr).toMatch(/scout is running/i);
    expect(yes.stderr).toMatch(/scout is running/i);
    expect(readdirSync(backupDir)).toEqual([]);
    const after = new Database(made.path, { readonly: true });
    expect(counts(after)).toEqual(before);
    after.close();
  });
});
