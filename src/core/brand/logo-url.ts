/**
 * Brandfetch Logo CDN URLs (J9, SOURCES § Brand data).
 *
 * Pure, with no server imports, so a client container can build a URL for each
 * row it renders. The client ID is in the query string by Brandfetch's design.
 * Never log the return value: it carries that id.
 */

/** List tiles. 20–52 px on screen, so 128 covers a 2× display, and one URL per company. */
export const LOGO_TILE_PX = 128;

/** The large header tile (J11). */
export const LOGO_HEADER_PX = 256;

/** The symbol drawn large on the header's art (J11): up to 460 px tall on screen. */
export const LOGO_SYMBOL_PX = 512;

/** The wordmark above the header's title (J11): 36 px tall on screen. Its width follows the asset. */
export const LOGO_WORDMARK_H_PX = 72;

const SIZES = new Set([LOGO_TILE_PX, LOGO_HEADER_PX]);

/** A lowercase hostname: labels, dots, no scheme, port, path or uppercase. */
const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function logoUrl(input: {
  domain: string | null | undefined;
  clientId: string | null | undefined;
  size: number;
}): string | null {
  const domain = input.domain ?? '';
  const clientId = input.clientId ?? '';
  if (domain.length === 0 || clientId.length === 0) return null;
  if (!SIZES.has(input.size)) return null;
  if (!HOSTNAME.test(domain)) return null;
  const id = encodeURIComponent(clientId);
  return `https://cdn.brandfetch.io/domain/${domain}/w/${input.size}/h/${input.size}/fallback/404/type/icon?c=${id}`;
}

/**
 * The header's other two assets (J11, D112, D113): the `symbol`, the glyph with no
 * tile, and the wordmark (`logo`) in its variant for dark backgrounds. A brand with no
 * dark wordmark answers `404`, and the header shows the company's name instead.
 */
export function brandAssetUrl(input: {
  domain: string | null | undefined;
  clientId: string | null | undefined;
  type: 'symbol' | 'wordmark';
}): string | null {
  const domain = input.domain ?? '';
  const clientId = input.clientId ?? '';
  if (domain.length === 0 || clientId.length === 0) return null;
  if (!HOSTNAME.test(domain)) return null;
  const id = encodeURIComponent(clientId);
  const path =
    input.type === 'symbol'
      ? `w/${LOGO_SYMBOL_PX}/h/${LOGO_SYMBOL_PX}/fallback/404/type/symbol`
      : `h/${LOGO_WORDMARK_H_PX}/theme/dark/fallback/404/type/logo`;
  return `https://cdn.brandfetch.io/domain/${domain}/${path}?c=${id}`;
}

/**
 * Brand Search, called from Kris's browser (SOURCES § Brand data).
 * `limit=5` is the API's maximum. Never log the return value: it carries the client id.
 */
export function brandSearchUrl(name: string, clientId: string | null | undefined): string | null {
  const trimmed = name.trim();
  const id = clientId ?? '';
  if (trimmed.length === 0 || id.length === 0) return null;
  return `https://api.brandfetch.io/v2/search/${encodeURIComponent(trimmed)}?c=${encodeURIComponent(id)}&limit=5`;
}
