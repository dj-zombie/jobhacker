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

/**
 * Brandfetch's `theme` is the color of the logo, not the background it sits on.
 * `light` is the light-colored logo. `dark` is the dark-colored one.
 * The header copy of these functions is `components/jobhacker/logo-contrast.ts`.
 * A test fails when the two disagree. The kit cannot import this file: the
 * prototype's `@/` is its own kit, and the two kit trees have to match.
 */
export type LogoTheme = 'light' | 'dark';

/** How much of the wordmark's backdrop is the panel. The left edge of `hero-scrim`. */
export const WORDMARK_SCRIM = 0.8;

/** sRGB channel, 0–1, to linear light. */
export function linearChannel(srgb: number): number {
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance, 0–1, from sRGB channels that are themselves 0–1. */
export function relativeLuminance(red: number, green: number, blue: number): number {
  return 0.2126 * linearChannel(red) + 0.7152 * linearChannel(green) + 0.0722 * linearChannel(blue);
}

/** `#0c0e13`, `--color-panel`, the color the wordmark's scrim mixes toward. */
const PANEL_LUMINANCE = relativeLuminance(0x0c / 255, 0x0e / 255, 0x13 / 255);

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function contrastRatio(foreground: number, background: number): number {
  const lighter = Math.max(foreground, background);
  const darker = Math.min(foreground, background);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The Brandfetch theme whose logo contrasts with a backdrop of this relative
 * luminance. A white logo wins below about 0.18, where it beats a black one.
 */
export function contrastingLogoTheme(backdropLuminance: number): LogoTheme {
  const backdrop = clamp01(backdropLuminance);
  const light = contrastRatio(1, backdrop);
  const dark = contrastRatio(0, backdrop);
  return light >= dark ? 'light' : 'dark';
}

/**
 * The wordmark sits on the left of the art, under a scrim that is mostly the
 * panel. Its backdrop is that mix, so a light wordmark is used unless the art
 * itself is near white.
 */
export function wordmarkBackdropLuminance(artLuminance: number): number {
  const art = clamp01(artLuminance);
  return WORDMARK_SCRIM * PANEL_LUMINANCE + (1 - WORDMARK_SCRIM) * art;
}

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
 * The header's other two assets (J11, D112, D147): the `symbol`, the glyph with no
 * tile, and the wordmark (`logo`). `theme` is the color of that asset. A brand
 * with no asset in the chosen theme answers `404`, and the header shows the
 * company's name, or the icon in place of the symbol.
 */
export function brandAssetUrl(input: {
  domain: string | null | undefined;
  clientId: string | null | undefined;
  type: 'symbol' | 'wordmark';
  theme: LogoTheme;
}): string | null {
  const domain = input.domain ?? '';
  const clientId = input.clientId ?? '';
  if (domain.length === 0 || clientId.length === 0) return null;
  if (!HOSTNAME.test(domain)) return null;
  const id = encodeURIComponent(clientId);
  const path =
    input.type === 'symbol'
      ? `w/${LOGO_SYMBOL_PX}/h/${LOGO_SYMBOL_PX}/theme/${input.theme}/fallback/404/type/symbol`
      : `h/${LOGO_WORDMARK_H_PX}/theme/${input.theme}/fallback/404/type/logo`;
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
