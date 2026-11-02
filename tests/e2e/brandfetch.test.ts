import { describe, expect, it } from 'vitest';
import { isBrandfetchLoadError, logoDomain, standInFor } from './brandfetch.js';

const ICON = 'https://cdn.brandfetch.io/domain/acme.com/w/128/h/128/fallback/404/type/icon?c=test';
const SYMBOL =
  'https://cdn.brandfetch.io/domain/acme.com/w/512/h/512/fallback/404/type/symbol?c=test';
const WORDMARK =
  'https://cdn.brandfetch.io/domain/acme.com/h/72/theme/dark/fallback/404/type/logo?c=test';

describe('brandfetch stand-ins', () => {
  it('serves an invented mark and never a real logo', () => {
    const hit = standInFor(ICON);
    expect(hit.status).toBe(200);
    expect(hit.contentType).toBe('image/svg+xml');
    const body = String(hit.body);
    expect(body).toContain('<svg');
    expect(body.toLowerCase()).not.toContain('acme');
  });

  it('404s the test domains', () => {
    expect(standInFor(ICON.replace('acme.com', 'missing.example')).status).toBe(404);
    expect(standInFor(ICON.replace('acme.com', 'no-logo.test')).status).toBe(404);
  });

  it('serves the header symbol and wordmark as invented shapes, with no tile and no name', () => {
    const symbol = standInFor(SYMBOL);
    expect(symbol.status).toBe(200);
    expect(String(symbol.body)).toContain('<svg');
    expect(String(symbol.body)).not.toContain('width="64" height="64"');
    const wordmark = standInFor(WORDMARK);
    expect(wordmark.status).toBe(200);
    expect(String(wordmark.body)).toContain('viewBox="4 8 200 48"');
    expect(String(wordmark.body).toLowerCase()).not.toContain('acme');
  });

  it('404s the symbol and wordmark, but not the icon, for an icon-only domain', () => {
    expect(standInFor(ICON.replace('acme.com', 'icon-only.test')).status).toBe(200);
    expect(standInFor(SYMBOL.replace('acme.com', 'icon-only.test')).status).toBe(404);
    expect(standInFor(WORDMARK.replace('acme.com', 'icon-only.test')).status).toBe(404);
  });

  it('answers Brand Search with canned results and keeps claimed off the fields the picker reads', () => {
    const search = standInFor('https://api.brandfetch.io/v2/search/Acme');
    expect(search.status).toBe(200);
    const body = JSON.parse(String(search.body)) as {
      name: string;
      domain: string;
      brandId: string;
      icon: string;
    }[];
    expect(body[0]).toMatchObject({
      name: 'Acme',
      domain: 'https://acme.com',
      brandId: 'bf-acme',
    });
    expect(body[0]?.icon).toContain('cdn.brandfetch.io');
    expect(body).toHaveLength(2);
  });

  it('reads the domain out of a Logo CDN path', () => {
    expect(logoDomain(ICON)).toBe('acme.com');
  });

  it('allows only a failed load whose URL is on Brandfetch', () => {
    expect(
      isBrandfetchLoadError(
        'Failed to load resource: the server responded with a status of 404 () https://cdn.brandfetch.io/domain/missing.example/w/128',
      ),
    ).toBe(true);
    expect(isBrandfetchLoadError('Failed to load resource: http://127.0.0.1:3000/api/job/1')).toBe(
      false,
    );
    expect(
      isBrandfetchLoadError(
        'Failed to load resource: the server responded with a status of 404 ()',
        'https://cdn.brandfetch.io/domain/missing.example/w/128/h/128/fallback/404/type/icon?c=test',
      ),
    ).toBe(true);
    expect(
      isBrandfetchLoadError(
        'Failed to load resource: the server responded with a status of 404 ()',
        'http://127.0.0.1:3000/',
      ),
    ).toBe(false);
  });
});
