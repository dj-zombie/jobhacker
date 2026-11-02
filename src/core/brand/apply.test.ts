import { describe, expect, it } from 'vitest';
import { createMigratedTestDb } from '../db/client.js';
import { domainsRepo } from '../db/repo/domains.js';
import { companyDomains } from '../db/schema.js';
import { seedJobs } from '../testing/fixtures.js';
import { fixedClock } from '../util/clock.js';
import { findEveryDomain, noteDomainTouch, refreshTouchedDomains } from './apply.js';

describe('domain writes', () => {
  it('finds a domain from stored urls and will not overwrite confirmed or none', () => {
    const { db, sqlite } = createMigratedTestDb();
    const clock = fixedClock('2026-10-25T12:00:00.000Z');
    try {
      seedJobs(db, clock, [{ title: 'Engineer', url: 'https://careers.acme.com/jobs/1' }], 'Acme');
      const first = findEveryDomain(db, clock);
      expect(first.written).toBe(1);
      expect(domainsRepo(db, clock).all()).toEqual([
        expect.objectContaining({
          companyKey: 'acme',
          domain: 'acme.com',
          state: 'found',
          source: 'url',
        }),
      ]);

      db.update(companyDomains)
        .set({ state: 'confirmed', source: 'picked', domain: 'acme.com' })
        .run();
      seedJobs(
        db,
        clock,
        [{ title: 'Other', url: 'https://careers.acme.io/jobs/2', externalId: 'other' }],
        'Acme',
      );
      const second = findEveryDomain(db, clock);
      expect(second.written).toBe(0);
      expect(second.cleared).toBe(0);
      const row = domainsRepo(db, clock).all()[0];
      expect(row?.state).toBe('confirmed');
      expect(row?.domain).toBe('acme.com');
    } finally {
      sqlite.close();
    }
  });

  it('refreshes a new company and leaves an untouched company alone', () => {
    const { db, sqlite } = createMigratedTestDb();
    const clock = fixedClock('2026-10-25T12:00:00.000Z');
    try {
      seedJobs(db, clock, [{ title: 'Engineer', url: 'https://careers.acme.com/jobs/1' }], 'Acme');
      const touches = new Map();
      noteDomainTouch(touches, 'Beta', true, 'https://beta.dev');
      const stats = refreshTouchedDomains(db, clock, touches);
      expect(stats.written).toBe(1);
      const rows = domainsRepo(db, clock).all();
      expect(rows.map((row) => row.companyKey)).toEqual(['beta']);
      expect(rows[0]?.domain).toBe('beta.dev');
      expect(rows[0]?.source).toBe('jsearch_website');
    } finally {
      sqlite.close();
    }
  });
});
