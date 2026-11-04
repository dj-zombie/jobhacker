import { describe, expect, it } from 'vitest';
import { registrableDomain } from './domain.js';
import { LOGO_TILE_PX } from './logo-url.js';
import {
  companyHeaderLogos,
  companyLogoSrc,
  pageOrigins,
  registrableHost,
  sameSiteIconUrl,
  siteIconFromHtml,
} from './site-icon.js';

const PTOWN = `
<link rel="preload" as="image" href="/1.png"/>
<img alt="Google Logo" src="/1.png"/>
<link rel="icon" href="./icon.svg" type="svg"/>
<link rel="icon" href="/icon.svg?9e83fe76c07028cd" type="image/svg+xml" sizes="any"/>
<link rel="icon" href="https://cdn.brandfetch.io/ptown.tech/icon.png"/>
`;

describe('site icons', () => {
  it('agrees with registrableDomain', () => {
    for (const value of ['https://www.ptown.tech/', 'careers.acme.co.uk', 'not a domain']) {
      expect(registrableHost(value)).toBe(registrableDomain(value));
    }
  });

  it('takes the site icon and ignores a Google image in the page', () => {
    expect(siteIconFromHtml(PTOWN, 'https://www.ptown.tech/', 'ptown.tech')).toBe(
      'https://www.ptown.tech/icon.svg',
    );
  });

  it('rejects an icon on another host', () => {
    expect(sameSiteIconUrl('https://cdn.brandfetch.io/ptown.tech/icon.png', 'ptown.tech')).toBe(
      null,
    );
    expect(sameSiteIconUrl('https://evil.com/icon.svg', 'ptown.tech')).toBeNull();
    expect(sameSiteIconUrl('http://www.ptown.tech/icon.svg', 'ptown.tech')).toBeNull();
    expect(sameSiteIconUrl('https://www.ptown.tech/icon.svg?9e83fe76c07028cd', 'ptown.tech')).toBe(
      'https://www.ptown.tech/icon.svg?9e83fe76c07028cd',
    );
  });

  it('reads the host that was typed before www and the bare domain', () => {
    expect(pageOrigins('https://www.ptown.tech/about', 'ptown.tech')).toEqual([
      'https://www.ptown.tech/',
      'https://ptown.tech/',
    ]);
  });

  it('never asks Brandfetch for a typed domain', () => {
    const clientId = 'client';
    expect(
      companyLogoSrc({
        domain: 'ptown.tech',
        source: 'typed',
        markUrl: 'https://www.ptown.tech/icon.svg',
        clientId,
        size: LOGO_TILE_PX,
      }),
    ).toBe('https://www.ptown.tech/icon.svg');
    expect(
      companyLogoSrc({
        domain: 'ptown.tech',
        source: 'typed',
        markUrl: null,
        clientId,
        size: LOGO_TILE_PX,
      }),
    ).toBeNull();
    expect(
      companyLogoSrc({
        domain: 'acme.com',
        source: 'picked',
        markUrl: 'https://acme.com/icon.svg',
        clientId,
        size: LOGO_TILE_PX,
      }),
    ).toBe('https://cdn.brandfetch.io/domain/acme.com/w/128/h/128/fallback/404/type/icon?c=client');
  });
});

describe('companyHeaderLogos', () => {
  const clientId = 'client';

  it('gives a Brandfetch company its cover and both logo themes', () => {
    expect(
      companyHeaderLogos({ domain: 'acme.com', source: 'found', markUrl: null, clientId }),
    ).toEqual({
      cover:
        'https://cdn.brandfetch.io/domain/acme.com/w/256/h/256/fallback/404/type/icon?c=client',
      symbolOnDark:
        'https://cdn.brandfetch.io/domain/acme.com/w/512/h/512/theme/light/fallback/404/type/symbol?c=client',
      symbolOnLight:
        'https://cdn.brandfetch.io/domain/acme.com/w/512/h/512/theme/dark/fallback/404/type/symbol?c=client',
      wordmarkOnDark:
        'https://cdn.brandfetch.io/domain/acme.com/h/72/theme/light/fallback/404/type/logo?c=client',
      wordmarkOnLight:
        'https://cdn.brandfetch.io/domain/acme.com/h/72/theme/dark/fallback/404/type/logo?c=client',
    });
  });

  it('gives a typed domain only its site icon, and a no-logo company nothing', () => {
    const noMarks = {
      symbolOnDark: null,
      symbolOnLight: null,
      wordmarkOnDark: null,
      wordmarkOnLight: null,
    };
    expect(
      companyHeaderLogos({
        domain: 'ptown.tech',
        source: 'typed',
        markUrl: 'https://www.ptown.tech/icon.svg',
        clientId,
      }),
    ).toEqual({ cover: 'https://www.ptown.tech/icon.svg', ...noMarks });
    expect(
      companyHeaderLogos({ domain: 'acme.com', source: 'none', markUrl: null, clientId }),
    ).toEqual({ cover: null, ...noMarks });
  });

  it('has nothing without a domain or a client id', () => {
    const none = {
      cover: null,
      symbolOnDark: null,
      symbolOnLight: null,
      wordmarkOnDark: null,
      wordmarkOnLight: null,
    };
    expect(companyHeaderLogos({ domain: null, source: null, markUrl: null, clientId })).toEqual(
      none,
    );
    expect(
      companyHeaderLogos({ domain: 'acme.com', source: 'found', markUrl: null, clientId: null }),
    ).toEqual(none);
  });
});
