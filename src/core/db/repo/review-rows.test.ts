import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../../util/clock.js';
import { createMigratedTestDb } from '../client.js';
import { jobs } from '../schema.js';
import { companiesRepo } from './companies.js';
import { jobsRepo } from './jobs.js';
import { scoresRepo } from './scores.js';

let sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'];

afterEach(() => {
  sqlite?.close();
});

describe('reviewRows', () => {
  it('puts a fillable remote job ahead of a higher-prescore onsite job and a search hit', () => {
    const made = createMigratedTestDb();
    sqlite = made.sqlite;
    const clock = fixedClock('2026-10-23T00:00:00.000Z');
    const companies = companiesRepo(made.db, clock);
    const writes = jobsRepo(made.db);
    const now = '2026-10-23T00:00:00.000Z';

    const onsite = companies.upsert({
      name: 'Onsite Co',
      ats: 'greenhouse',
      token: 'onsite',
      active: true,
      tags: [],
    });
    const remote = companies.upsert({
      name: 'Remote Co',
      ats: 'lever',
      token: 'remote',
      active: true,
      tags: [],
    });
    const search = companies.upsert({
      name: 'Search Co',
      ats: 'hn',
      token: 'search',
      active: true,
      tags: ['search'],
    });

    const seed = (
      companyId: number,
      ats: 'greenhouse' | 'lever' | 'hn',
      externalId: string,
      title: string,
      remoteType: 'remote' | 'onsite',
      prescore: number,
    ) => {
      writes.upsert(
        {
          companyId,
          ats,
          externalId,
          title,
          locationRaw: remoteType,
          remoteType,
          employmentType: null,
          url: `https://example.com/${externalId}`,
          applyUrl: null,
          descriptionText: title,
          compMin: null,
          compMax: null,
          compCurrency: null,
          postedAt: '2026-10-01T00:00:00.000Z',
          contentHash: externalId,
          dedupeKey: externalId,
        },
        now,
      );
      made.db
        .update(jobs)
        .set({
          prescore,
          gateResult: { passed: true, gate: null, detail: null },
          status: 'unscored',
          scoreState: 'pending',
        })
        .where(eq(jobs.externalId, externalId))
        .run();
    };

    seed(onsite.id, 'greenhouse', 'onsite', 'Staff Engineer', 'onsite', 0.99);
    seed(remote.id, 'lever', 'remote', 'Senior Frontend Engineer', 'remote', 0.4);
    seed(remote.id, 'lever', 'remote-2', 'Other Frontend Engineer', 'remote', 0.2);
    seed(search.id, 'hn', 'search', 'Senior Frontend Engineer', 'remote', 0.95);

    expect(
      scoresRepo(made.db, clock)
        .reviewRows()
        .map((row) => row.company),
    ).toEqual(['Remote Co', 'Onsite Co', 'Search Co']);
  });
});
