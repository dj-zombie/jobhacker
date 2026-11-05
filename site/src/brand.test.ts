import { describe, expect, it } from 'vitest';
import { JOBS } from '../../ui-reference/prototype-src/src/demo/data';
import { demoClientId } from '../vite.config';
import { brandfetchLogos } from './brand';
import { BRAND_DOMAINS } from './brand-domains';

const ID = 'demo-test-id';

describe('brandfetchLogos', () => {
  it('sets no hook without a client ID, so every tile keeps its letter', () => {
    expect(brandfetchLogos('')).toBeUndefined();
  });

  it("builds the app's Logo CDN URLs for a mapped company", () => {
    const logos = brandfetchLogos(ID);
    expect(logos?.tile('Linear')).toBe(
      `https://cdn.brandfetch.io/domain/linear.app/w/128/h/128/fallback/404/type/icon?c=${ID}`,
    );
    expect(logos?.cover('Linear')).toBe(
      `https://cdn.brandfetch.io/domain/linear.app/w/256/h/256/fallback/404/type/icon?c=${ID}`,
    );
    expect(logos?.symbol('Linear', 'white')).toContain('/theme/light/fallback/404/type/symbol?');
    expect(logos?.wordmark('Linear', 'black')).toContain('/theme/dark/fallback/404/type/logo?');
  });

  it('leaves a company without a domain as its letter', () => {
    const logos = brandfetchLogos(ID);
    for (const company of ['Axion', 'Imo Online', 'Phoenix', 'Thermal Works', 'Nobody Inc']) {
      expect(logos?.tile(company)).toBeNull();
      expect(logos?.symbol(company, 'white')).toBeNull();
    }
  });

  it('maps only sample companies, and 56 of the 60', () => {
    const companies = new Set(JOBS.map((j) => j.company));
    expect([...BRAND_DOMAINS.keys()].filter((c) => !companies.has(c))).toEqual([]);
    expect(companies.size).toBe(60);
    expect([...companies].filter((c) => BRAND_DOMAINS.has(c)).length).toBe(56);
  });
});

describe('demoClientId', () => {
  it("refuses the app's client ID", () => {
    expect(() =>
      demoClientId({ DEMO_BRANDFETCH_CLIENT_ID: ID, BRANDFETCH_CLIENT_ID: ` ${ID} ` }),
    ).toThrow(/the app's Brandfetch client ID/);
  });

  it('passes a separate ID through, and an unset one as empty', () => {
    expect(demoClientId({ DEMO_BRANDFETCH_CLIENT_ID: ID, BRANDFETCH_CLIENT_ID: 'other' })).toBe(ID);
    expect(demoClientId({ BRANDFETCH_CLIENT_ID: 'other' })).toBe('');
  });
});
