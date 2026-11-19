import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { type Db, createMigratedTestDb } from '../db/client.js';
import { companiesRepo } from '../db/repo/companies.js';
import { jobs } from '../db/schema.js';
import { seedJobs } from '../testing/fixtures.js';
import { type Clock, fixedClock } from '../util/clock.js';
import { targetCompanyReport } from './target.js';

let sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'];

afterEach(() => {
  sqlite?.close();
});

function setup(): { db: Db; clock: Clock } {
  const made = createMigratedTestDb();
  sqlite = made.sqlite;
  return { db: made.db, clock: fixedClock('2026-11-09T12:00:00.000Z') };
}

describe('targetCompanyReport', () => {
  it('counts a company once, and a stored company with no open job is seen', () => {
    const { db, clock } = setup();
    seedJobs(db, clock, [{ title: 'One' }, { title: 'Two' }], 'Riot Games');
    companiesRepo(db, clock).upsert({
      name: 'Ghost Co',
      ats: 'greenhouse',
      token: 'ghost',
      active: true,
      tags: [],
    });
    const closed = seedJobs(db, clock, [{ title: 'Old' }], 'Nike');
    db.update(jobs)
      .set({ closedAt: clock.now() })
      .where(eq(jobs.id, closed[0] ?? 0))
      .run();

    expect(targetCompanyReport(db, ['Riot', 'Riot Games', 'Nike', 'Ghost', 'Nope'])).toEqual({
      openJobs: 2,
      unscoredJobs: 2,
      unseen: ['Nope'],
    });
  });

  it('is empty for an empty list', () => {
    const { db } = setup();
    expect(targetCompanyReport(db, [])).toEqual({ openJobs: 0, unscoredJobs: 0, unseen: [] });
  });
});
