import { describe, expect, it } from 'vitest';
import {
  LOGO_HEADER_PX,
  LOGO_TILE_PX,
  brandAssetUrl,
  brandSearchUrl,
  logoUrl,
} from './logo-url.js';

const clientId = 'test-client';

describe('logoUrl', () => {
  it('builds a Logo CDN icon URL with fallback/404 and no theme', () => {
    expect(logoUrl({ domain: 'linear.app', clientId, size: LOGO_TILE_PX })).toBe(
      'https://cdn.brandfetch.io/domain/linear.app/w/128/h/128/fallback/404/type/icon?c=test-client',
    );
    expect(logoUrl({ domain: 'acme.co.uk', clientId, size: LOGO_HEADER_PX })).toBe(
      'https://cdn.brandfetch.io/domain/acme.co.uk/w/256/h/256/fallback/404/type/icon?c=test-client',
    );
  });

  it('encodes a client id and returns null when the domain or the id is missing', () => {
    expect(logoUrl({ domain: 'stripe.com', clientId: 'a b', size: LOGO_TILE_PX })).toBe(
      'https://cdn.brandfetch.io/domain/stripe.com/w/128/h/128/fallback/404/type/icon?c=a%20b',
    );
    expect(logoUrl({ domain: null, clientId, size: LOGO_TILE_PX })).toBeNull();
    expect(logoUrl({ domain: '', clientId, size: LOGO_TILE_PX })).toBeNull();
    expect(logoUrl({ domain: 'stripe.com', clientId: null, size: LOGO_TILE_PX })).toBeNull();
    expect(logoUrl({ domain: 'stripe.com', clientId: '', size: LOGO_TILE_PX })).toBeNull();
  });

  it('accepts only a lowercase hostname and only the two sizes', () => {
    for (const domain of [
      'Stripe.com',
      'https://stripe.com',
      'stripe.com:443',
      'stripe.com/jobs',
      'stripe.com?x=1',
      'not a host',
      'localhost',
    ]) {
      expect(logoUrl({ domain, clientId, size: LOGO_TILE_PX })).toBeNull();
    }
    expect(logoUrl({ domain: 'stripe.com', clientId, size: 64 })).toBeNull();
    expect(logoUrl({ domain: 'stripe.com', clientId, size: 512 })).toBeNull();
  });

  it('builds the header symbol and dark wordmark URLs, with fallback/404', () => {
    expect(brandAssetUrl({ domain: 'linear.app', clientId, type: 'symbol' })).toBe(
      'https://cdn.brandfetch.io/domain/linear.app/w/512/h/512/fallback/404/type/symbol?c=test-client',
    );
    expect(brandAssetUrl({ domain: 'linear.app', clientId, type: 'wordmark' })).toBe(
      'https://cdn.brandfetch.io/domain/linear.app/h/72/theme/dark/fallback/404/type/logo?c=test-client',
    );
    expect(brandAssetUrl({ domain: 'Linear.app', clientId, type: 'symbol' })).toBeNull();
    expect(brandAssetUrl({ domain: null, clientId, type: 'wordmark' })).toBeNull();
    expect(brandAssetUrl({ domain: 'linear.app', clientId: '', type: 'wordmark' })).toBeNull();
  });

  it('builds a Brand Search URL with a limit of 5', () => {
    expect(brandSearchUrl('GoodTime', clientId)).toBe(
      'https://api.brandfetch.io/v2/search/GoodTime?c=test-client&limit=5',
    );
    expect(brandSearchUrl('A / B', 'a b')).toBe(
      'https://api.brandfetch.io/v2/search/A%20%2F%20B?c=a%20b&limit=5',
    );
    expect(brandSearchUrl('  ', clientId)).toBeNull();
    expect(brandSearchUrl('Vercel', null)).toBeNull();
  });
});
