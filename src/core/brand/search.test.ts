import { describe, expect, it } from 'vitest';
import { createMigratedTestDb } from '../db/client.js';
import { domainsRepo } from '../db/repo/domains.js';
import { fixedClock } from '../util/clock.js';
import { findEveryDomain } from './apply.js';
import { pickSearchMatch, saveSearchedDomain, searchHitsSchema } from './search.js';

describe('pickSearchMatch', () => {
  it('takes the one brand whose name is the company and whose domain matches', () => {
    expect(
      pickSearchMatch('Vercel', [
        { name: 'Vercel', domain: 'https://vercel.com', brandId: 'v1' },
        { name: 'Versel', domain: 'versel.com', brandId: null },
      ]),
    ).toEqual({ domain: 'vercel.com', brandId: 'v1' });
  });

  it('refuses a platform host, a name that is not the company, and a tie', () => {
    expect(
      pickSearchMatch('Lever', [{ name: 'Lever', domain: 'lever.co', brandId: null }]),
    ).toBeNull();
    expect(
      pickSearchMatch('Vercel', [{ name: 'Zeit', domain: 'vercel.com', brandId: null }]),
    ).toBeNull();
    expect(
      pickSearchMatch('Linear', [
        { name: 'Linear', domain: 'linear.app', brandId: 'a' },
        { name: 'Linear', domain: 'linear.com', brandId: 'b' },
      ]),
    ).toBeNull();
  });

  it('refuses a domain that only contains the name', () => {
    expect(
      pickSearchMatch('Berlitz', [
        { name: 'Berlitz', domain: 'berlitzinstaladora.com.br', brandId: 'b' },
      ]),
    ).toBeNull();
    expect(
      pickSearchMatch('Lively', [{ name: 'Lively', domain: 'wearlively.com', brandId: 'w' }]),
    ).toBeNull();
    expect(
      pickSearchMatch('Lively', [{ name: 'Lively, Inc.', domain: 'livelyme.com', brandId: 'l' }]),
    ).toBeNull();
    expect(
      pickSearchMatch('Notion', [{ name: 'Notion', domain: 'notionup.com', brandId: 'n' }]),
    ).toBeNull();
    expect(
      pickSearchMatch('Mobi.AI', [{ name: 'Mobi.AI', domain: 'mobi.ai', brandId: 'm' }]),
    ).toEqual({ domain: 'mobi.ai', brandId: 'm' });
  });

  it('breaks a tie when one domain label is the company name', () => {
    expect(
      pickSearchMatch('Render', [
        { name: 'Render', domain: 'render.com', brandId: 'r' },
        { name: 'Render', domain: 'renderhq.com', brandId: 'h' },
      ]),
    ).toEqual({ domain: 'render.com', brandId: 'r' });
  });

  it('parses a search response and drops the icon', () => {
    const parsed = searchHitsSchema.parse([
      { name: 'Osano', domain: 'osano.com', icon: 'https://cdn.brandfetch.io/x', brandId: 'o' },
    ]);
    expect(parsed).toEqual([{ name: 'Osano', domain: 'osano.com', brandId: 'o' }]);
    expect(searchHitsSchema.safeParse({ brands: [] }).success).toBe(false);
  });
});

describe('saveSearchedDomain', () => {
  it('stores a matching domain and leaves a job-data domain and a confirmed row alone', () => {
    const { db, sqlite } = createMigratedTestDb();
    const clock = fixedClock('2026-10-25T12:00:00.000Z');
    try {
      expect(
        saveSearchedDomain(db, clock, { name: 'Vercel', domain: 'vercel.com', brandId: 'v' }),
      ).toBe('vercel.com');
      expect(
        saveSearchedDomain(db, clock, { name: 'Vercel', domain: 'uscis.gov', brandId: null }),
      ).toBe(null);
      const row = domainsRepo(db, clock).get('vercel');
      expect(row?.source).toBe('brand_search');
      expect(row?.domain).toBe('vercel.com');
      expect(row?.brandId).toBe('v');

      domainsRepo(db, clock).upsertFound({
        companyKey: 'acme',
        name: 'Acme',
        domain: 'acme.com',
        source: 'url',
      });
      expect(
        saveSearchedDomain(db, clock, { name: 'Acme', domain: 'acme.io', brandId: null }),
      ).toBeNull();
      expect(domainsRepo(db, clock).get('acme')?.domain).toBe('acme.com');

      domainsRepo(db, clock).upsertFound({
        companyKey: 'beta',
        name: 'Beta',
        domain: 'beta.com',
        source: 'picked',
      });
      sqlite
        .prepare(`update company_domains set state = 'confirmed' where company_key = 'beta'`)
        .run();
      expect(
        saveSearchedDomain(db, clock, { name: 'Beta', domain: 'beta.com', brandId: null }),
      ).toBeNull();
      expect(domainsRepo(db, clock).get('beta')?.state).toBe('confirmed');

      findEveryDomain(db, clock);
      expect(domainsRepo(db, clock).get('vercel')?.source).toBe('brand_search');
      expect(domainsRepo(db, clock).get('vercel')?.domain).toBe('vercel.com');
    } finally {
      sqlite.close();
    }
  });
});
