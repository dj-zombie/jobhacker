import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../util/clock.js';
import { type Db, createMigratedTestDb } from './client.js';
import { tableRowCounts } from './info.js';
import { eventsRepo } from './repo/events.js';
import { runsRepo } from './repo/runs.js';
import { companies, jobs, tableNames } from './schema.js';

let db: Db;
let sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'];

beforeEach(() => {
  const made = createMigratedTestDb();
  db = made.db;
  sqlite = made.sqlite;
});

afterEach(() => {
  sqlite.close();
});

/** Insert a company + job so repos and FK behaviour can be exercised. */
function seedJob(): number {
  const now = '2026-10-22T00:00:00.000Z';
  const company = db
    .insert(companies)
    .values({ name: 'Acme', ats: 'greenhouse', token: 'acme', createdAt: now })
    .returning({ id: companies.id })
    .get();
  const job = db
    .insert(jobs)
    .values({
      companyId: company!.id,
      ats: 'greenhouse',
      externalId: 'J1',
      title: 'Senior Frontend',
      url: 'https://example.com/j1',
      firstSeenAt: now,
      lastSeenAt: now,
      contentHash: 'c',
      dedupeKey: 'd',
    })
    .returning({ id: jobs.id })
    .get();
  return job!.id;
}

describe('migration', () => {
  it('creates all six tables with zero rows', () => {
    const counts = tableRowCounts(sqlite);
    expect(counts.map((c) => c.table)).toEqual([...tableNames]);
    expect(counts.every((c) => c.rows === 0)).toBe(true);
  });

  it('defaults new jobs to pending score state', () => {
    const jobId = seedJob();
    expect(db.select().from(jobs).where(eq(jobs.id, jobId)).get()?.scoreState).toBe('pending');
  });

  it('backfills pre-existing dimension rows as stale without overwriting later outcomes', () => {
    const jobId = seedJob();
    sqlite
      .prepare(
        `insert into job_scores
          (job_id, content_hash, rubric_version, model, score, verdict, reasons, red_flags,
           dimensions, profile_hash, preferences_hash, created_at)
         values (?, 'c', 'old-rubric', 'm', 80, 'strong', '[]', '[]', '{}', '', '', ?)`,
      )
      .run(jobId, '2026-10-22T00:00:00.000Z');
    const backfill = readFileSync('drizzle/0003_score_state_backfill.sql', 'utf8');

    sqlite.exec(backfill);
    expect(db.select().from(jobs).where(eq(jobs.id, jobId)).get()?.scoreState).toBe('stale');

    db.update(jobs).set({ scoreState: 'current' }).where(eq(jobs.id, jobId)).run();
    sqlite.exec(backfill);
    expect(db.select().from(jobs).where(eq(jobs.id, jobId)).get()?.scoreState).toBe('current');
  });
});

describe('foreign keys', () => {
  it('are enforced (rejects an orphan job)', () => {
    expect(() =>
      db
        .insert(jobs)
        .values({
          companyId: 9999,
          ats: 'greenhouse',
          externalId: 'X',
          title: 'T',
          url: 'u',
          firstSeenAt: 'n',
          lastSeenAt: 'n',
          contentHash: 'c',
          dedupeKey: 'd',
        })
        .run(),
    ).toThrowError(/FOREIGN KEY/i);
  });

  it('cascades deletes from company to job', () => {
    const jobId = seedJob();
    db.delete(companies).where(eq(companies.id, 1)).run();
    expect(db.select().from(jobs).where(eq(jobs.id, jobId)).get()).toBeUndefined();
  });
});

describe('runsRepo', () => {
  it('opens and closes a run with stats and the clock', () => {
    const clock = fixedClock('2026-10-22T08:00:00.000Z');
    const repo = runsRepo(db, clock);
    const id = repo.start('scout');

    let run = repo.get(id);
    expect(run?.startedAt).toBe('2026-10-22T08:00:00.000Z');
    expect(run?.finishedAt).toBeNull();

    clock.advance(60_000);
    repo.finish(id, { ok: true, stats: { inserted: 3 } });
    run = repo.get(id);
    expect(run?.ok).toBe(true);
    expect(run?.finishedAt).toBe('2026-10-22T08:01:00.000Z');
    expect(run?.stats).toEqual({ inserted: 3 });
  });

  it('returns the latest run of a kind', () => {
    const clock = fixedClock('2026-10-22T08:00:00.000Z');
    const repo = runsRepo(db, clock);
    repo.start('scout');
    clock.advance(1000);
    const second = repo.start('scout');
    expect(repo.latest('scout')?.id).toBe(second);
    expect(repo.latest('score')).toBeUndefined();
  });

  it('throws when finishing a run that does not exist', () => {
    const repo = runsRepo(db, fixedClock('2026-10-22T08:00:00.000Z'));
    expect(() => repo.finish(999, { ok: false })).toThrowError(/run 999 not found/);
  });
});

describe('eventsRepo', () => {
  it('appends events and reads them back by job, newest first', () => {
    const jobId = seedJob();
    const clock = fixedClock('2026-10-22T08:00:00.000Z');
    const repo = eventsRepo(db, clock);

    repo.append({ type: 'discovered', jobId, payload: { source: 'greenhouse' } });
    clock.advance(1000);
    repo.append({ type: 'scored', jobId, payload: { score: 82 } });

    const rows = repo.forJob(jobId);
    expect(rows.map((r) => r.type)).toEqual(['scored', 'discovered']);
    expect(rows[0]?.payload).toEqual({ score: 82 });
  });

  it('filters events by type', () => {
    const jobId = seedJob();
    const repo = eventsRepo(db, fixedClock('2026-10-22T08:00:00.000Z'));
    repo.append({ type: 'discovered', jobId });
    repo.append({ type: 'scored', jobId });
    expect(repo.ofType('scored')).toHaveLength(1);
  });
});
