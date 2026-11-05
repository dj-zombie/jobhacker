import {
  LOGO_HEADER_PX,
  LOGO_TILE_PX,
  type LogoTheme,
  brandAssetUrl,
  logoUrl,
} from '../../src/core/brand/logo-url';
import type { DemoLogos } from '../../ui-reference/prototype-src/src/demo/demo-hooks';
import { BRAND_DOMAINS } from './brand-domains';

/**
 * Real logos for the demo: the app's own Logo CDN URLs, loaded by the visitor's browser
 * with the demo's client ID (SOURCES § Brand data, D165). No ID, no hook: the letters stay.
 */
export function brandfetchLogos(clientId: string): DemoLogos | undefined {
  if (clientId.length === 0) return undefined;
  const domain = (company: string) => BRAND_DOMAINS.get(company) ?? null;
  const theme = (ink: 'white' | 'black'): LogoTheme => (ink === 'white' ? 'light' : 'dark');
  return {
    tile: (company) => logoUrl({ domain: domain(company), clientId, size: LOGO_TILE_PX }),
    cover: (company) => logoUrl({ domain: domain(company), clientId, size: LOGO_HEADER_PX }),
    symbol: (company, ink) =>
      brandAssetUrl({ domain: domain(company), clientId, type: 'symbol', theme: theme(ink) }),
    wordmark: (company, ink) =>
      brandAssetUrl({ domain: domain(company), clientId, type: 'wordmark', theme: theme(ink) }),
  };
}
