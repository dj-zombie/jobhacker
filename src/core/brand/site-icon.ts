import { parse } from 'tldts';
import { LOGO_HEADER_PX, brandAssetUrl, logoUrl } from './logo-url.js';

/**
 * The icon a typed domain shows (J10). Brandfetch's picture for that domain is
 * not used: a page can contain another company's logo. The tile hotlinks the
 * site's own `rel=icon` link, and only when that URL is https on the same
 * registrable domain. Nothing here fetches.
 */

const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const MAX_ICON_URL = 500;

/** Registrable hostname, or null. Same rule as `registrableDomain`, without pulling in node:crypto. */
export function registrableHost(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = parse(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  if (!parsed.domain || !parsed.isIcann) return null;
  const lower = parsed.domain.toLowerCase();
  return HOSTNAME.test(lower) ? lower : null;
}

/** An https icon URL on `domain`, or null. Rejects other hosts, ports, and credentials. */
export function sameSiteIconUrl(
  url: string | null | undefined,
  domain: string | null | undefined,
): string | null {
  if (!url || !domain) return null;
  if (url.length > MAX_ICON_URL) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.port !== '') return null;
  if (registrableHost(parsed.hostname) !== domain) return null;
  if (parsed.pathname.length > 400) return null;
  return parsed.toString();
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  const raw = match?.[1] ?? match?.[2] ?? null;
  return raw?.replaceAll('&amp;', '&') ?? null;
}

/**
 * The site's own icon link. Images in the page body are ignored: a customer
 * logo on the homepage is not the site's icon.
 */
export function siteIconFromHtml(html: string, pageUrl: string, domain: string): string | null {
  let best: { url: string; score: number } | null = null;
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = (attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/);
    if (rel.includes('preload')) continue;
    const isIcon = rel.includes('icon') || rel.includes('apple-touch-icon');
    if (!isIcon) continue;
    const href = attr(tag, 'href');
    if (!href) continue;
    let absolute: string;
    try {
      absolute = new URL(href, pageUrl).toString();
    } catch {
      continue;
    }
    const url = sameSiteIconUrl(absolute, domain);
    if (!url) continue;
    const type = (attr(tag, 'type') ?? '').toLowerCase();
    const sizes = Number.parseInt(attr(tag, 'sizes') ?? '', 10);
    let score = 0;
    if (type.includes('svg') || url.toLowerCase().includes('.svg')) score += 40;
    if (rel.includes('apple-touch-icon')) score += 30;
    if (rel.includes('icon')) score += 10;
    if (Number.isFinite(sizes)) score += Math.min(sizes, 256) / 10;
    if (!best || score > best.score) best = { url, score };
  }
  return best?.url ?? null;
}

/** Pages to read, typed host first, then www, then the bare domain. https only. */
export function pageOrigins(typed: string, domain: string): string[] {
  const out: string[] = [];
  const push = (origin: string) => {
    if (!out.includes(origin)) out.push(origin);
  };
  const trimmed = typed.trim();
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withScheme);
    if (url.protocol === 'https:' && registrableHost(url.hostname) === domain) {
      push(`https://${url.hostname}/`);
    }
  } catch {
    // Not a URL. The bare domain below still applies.
  }
  push(`https://www.${domain}/`);
  push(`https://${domain}/`);
  return out;
}

/**
 * What a tile loads. A typed domain never uses Brandfetch: with no site icon
 * the tile stays a letter. Every other source keeps `logoUrl()`.
 */
export function companyLogoSrc(input: {
  domain: string | null | undefined;
  source: string | null | undefined;
  markUrl: string | null | undefined;
  clientId: string | null | undefined;
  size: number;
}): string | null {
  if (input.source === 'none') return null;
  if (input.source === 'typed') return sameSiteIconUrl(input.markUrl, input.domain ?? null);
  return logoUrl({
    domain: input.domain,
    clientId: input.clientId,
    size: input.size,
  });
}

export interface HeaderLogos {
  /** The 256 px cover. */
  cover: string | null;
  /** The glyph drawn large on the art. Null, or a `404`, and the art draws the icon. */
  symbol: string | null;
  /** The wordmark above the title. Null, or a `404`, and the header shows the name. */
  wordmark: string | null;
}

/**
 * The job detail header's logos (J11). A typed domain has only its site's icon, so
 * no symbol and no wordmark, and a company marked as having no logo has none.
 */
export function companyHeaderLogos(input: {
  domain: string | null | undefined;
  source: string | null | undefined;
  markUrl: string | null | undefined;
  clientId: string | null | undefined;
}): HeaderLogos {
  const cover = companyLogoSrc({ ...input, size: LOGO_HEADER_PX });
  if (input.source === 'none' || input.source === 'typed') {
    return { cover, symbol: null, wordmark: null };
  }
  const asset = { domain: input.domain, clientId: input.clientId };
  return {
    cover,
    symbol: brandAssetUrl({ ...asset, type: 'symbol' }),
    wordmark: brandAssetUrl({ ...asset, type: 'wordmark' }),
  };
}
