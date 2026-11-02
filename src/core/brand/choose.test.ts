import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createMigratedTestDb } from '../db/client.js';
import { domainsRepo } from '../db/repo/domains.js';
import { scoresRepo } from '../db/repo/scores.js';
import { jobs } from '../db/schema.js';
import { scoreOutput, seedJobs, testCriteria } from '../testing/fixtures.js';
import { fixedClock } from '../util/clock.js';
import { findEveryDomain } from './apply.js';
import { applyLogoChoice } from './choose.js';
import { countDomains, logoSetKeys } from './logo-set.js';

const CRITERIA = testCriteria();

function seedStrong(company = 'Acme') {
  const { db, sqlite } = createMigratedTestDb();
  const clock = fixedClock('2026-10-25T12:00:00.000Z');
  const id = seedJobs(db, clock, [{ title: 'Engineer' }], company)[0];
  if (id == null) throw new Error('seed failed');
  const job = db.select().from(jobs).where(eq(jobs.id, id)).get();
  if (!job) throw new Error('seed failed');
  db.update(jobs)
    .set({
      status: 'scored',
      gateResult: { passed: true, gate: null, detail: null },
      scoreState: 'current',
    })
    .where(eq(jobs.id, id))
    .run();
  scoresRepo(db, clock).insert({
    jobId: id,
    contentHash: job.contentHash,
    rubricVersion: 'r',
    model: 'm',
    profileHash: 'p',
    preferencesHash: 'q',
    dimensions: scoreOutput({}, 5).dimensions,
    summary: 'Strong.',
    redFlags: [],
    score: 100,
    verdict: 'strong',
  });
  return { db, sqlite, clock };
}

describe('applyLogoChoice', () => {
  it('confirms, picks, types and clears, and reduces a website URL to a hostname', () => {
    const { db, sqlite, clock } = seedStrong();
    try {
      domainsRepo(db, clock).upsertFound({
        companyKey: 'acme',
        name: 'Acme',
        domain: 'acme.com',
        source: 'url',
      });
      const confirmed = applyLogoChoice(db, clock, CRITERIA, 'Acme', { kind: 'confirm' });
      expect(confirmed).toMatchObject({
        ok: true,
        logo: { state: 'confirmed', domain: 'acme.com', source: 'url' },
      });

      const picked = applyLogoChoice(db, clock, CRITERIA, 'Acme, Inc.', {
        kind: 'pick',
        domain: 'https://WWW.Acme.io/about',
        brandId: 'brand-acme',
      });
      expect(picked).toMatchObject({
        ok: true,
        logo: { domain: 'acme.io', state: 'confirmed', source: 'picked', brandId: 'brand-acme' },
      });

      const typed = applyLogoChoice(db, clock, CRITERIA, 'Acme', {
        kind: 'type',
        domain: 'https://careers.acme.co.uk/jobs',
        markUrl: 'https://www.acme.co.uk/icon.svg',
      });
      expect(typed).toMatchObject({
        ok: true,
        logo: {
          domain: 'acme.co.uk',
          source: 'typed',
          brandId: null,
          markUrl: 'https://www.acme.co.uk/icon.svg',
          state: 'confirmed',
        },
      });
      expect(
        applyLogoChoice(db, clock, CRITERIA, 'Acme', {
          kind: 'type',
          domain: 'https://www.acme.co.uk/',
          markUrl: 'https://cdn.brandfetch.io/acme.co.uk/icon.png',
        }).ok && domainsRepo(db, clock).get('acme')?.markUrl,
      ).toBeNull();

      expect(
        applyLogoChoice(db, clock, CRITERIA, 'Acme', {
          kind: 'type',
          domain: 'not a domain',
          markUrl: null,
        }),
      ).toEqual({ ok: false, error: "That isn't a domain." });
      expect(domainsRepo(db, clock).get('acme')?.domain).toBe('acme.co.uk');

      const none = applyLogoChoice(db, clock, CRITERIA, 'Acme', { kind: 'none' });
      expect(none).toMatchObject({
        ok: true,
        logo: { state: 'none', domain: null, source: 'none', brandId: null },
      });
      expect(findEveryDomain(db, clock).written).toBe(0);
      expect(domainsRepo(db, clock).get('acme')?.state).toBe('none');

      expect(applyLogoChoice(db, clock, CRITERIA, 'Nobody', { kind: 'none' })).toEqual({
        ok: false,
        error: "That company isn't in the logo set.",
      });
    } finally {
      sqlite.close();
    }
  });

  it('counts a no-logo answer as none, not as still missing a domain', () => {
    const { db, sqlite, clock } = seedStrong('Beta');
    try {
      applyLogoChoice(db, clock, CRITERIA, 'Beta', { kind: 'none' });
      const counts = countDomains(logoSetKeys(db, clock, CRITERIA), domainsRepo(db, clock).all());
      expect(counts).toMatchObject({ total: 1, none: 1, noDomainYet: 0, confirmed: 0, found: 0 });
    } finally {
      sqlite.close();
    }
  });
});
