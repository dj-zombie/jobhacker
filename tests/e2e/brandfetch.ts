import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright-core';

/**
 * Stand-ins for Brandfetch (UI-KIT § Checks 6, J9).
 * Playwright routes every Brandfetch host here. Nothing in an automated run
 * loads a real logo. Answers take about 700ms. A few test domains 404 so the
 * tile falls back to its monogram. `BRANDFETCH_404`, a comma-separated list,
 * adds more domains that 404 for a screenshot.
 * J11's header also asks for `type/symbol` and `type/logo` (the wordmark), each
 * in `theme/light` and `theme/dark`. The stand-ins answer with the same invented
 * shape: white on transparent for a light logo, near-black for a dark one, and
 * beside two bars for a wordmark, never a name. `BRANDFETCH_404_ASSETS`
 * lists domains whose icon loads but whose symbol and wordmark 404.
 * J10's Brand Search gets canned results from `tests/fixtures/brandfetch/search.json`.
 * Pass `{ delayMs: 0 }` when a check needs images to finish before hydration.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MARKS = ['circle.svg', 'triangle.svg', 'stripes.svg'].map((name) =>
  readFileSync(join(HERE, '../fixtures/brandfetch', name)),
);

const TEST_MISS = new Set(['missing.example', 'no-logo.test']);
const TEST_ICON_ONLY = new Set(['icon-only.test']);
const DELAY_MS = 700;

/** A mark's shapes without its square tile, so they can sit on the header's art. */
function glyphOf(mark: Buffer): string {
  return String(mark)
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>[\s\S]*$/, '')
    .replace(/<rect width="64" height="64" fill="#[0-9a-fA-F]+"\/>/, '')
    .trim();
}

function symbolSvg(mark: Buffer, theme: string | null): string {
  return paint(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="8 8 48 48">${glyphOf(mark)}</svg>`,
    theme,
  );
}

function wordmarkSvg(mark: Buffer, theme: string | null): string {
  return paint(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="4 8 200 48">${glyphOf(mark)}<rect x="70" y="20" width="70" height="24" rx="6" fill="#ffffff"/><rect x="148" y="20" width="52" height="24" rx="6" fill="#ffffff"/></svg>`,
    theme,
  );
}

/** `theme/dark` is the dark-colored logo. The stand-in glyphs are drawn white, so repaint them. */
function paint(svg: string, theme: string | null): string {
  if (theme !== 'dark') return svg;
  return svg.replaceAll('#ffffff', '#141418').replaceAll('#FFFFFF', '#141418');
}

function assetTheme(url: string): string | null {
  const path = new URL(url).pathname.split('/');
  const at = path.indexOf('theme');
  return at >= 0 ? (path[at + 1] ?? null) : null;
}

/** `icon`, `symbol` or `logo`, from a Logo CDN path's `/type/<type>` segment. */
function assetType(url: string): string {
  const path = new URL(url).pathname.split('/');
  const at = path.indexOf('type');
  return at >= 0 ? (path[at + 1] ?? 'icon') : 'icon';
}

export interface StandIn {
  status: number;
  contentType: string;
  body: Buffer | string;
}

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}

function extraMisses(name = 'BRANDFETCH_404'): Set<string> {
  const raw = process.env[name] ?? '';
  return new Set(
    raw
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part.length > 0),
  );
}

/** The domain in a Logo CDN path `/domain/<domain>/…`, if the URL has one. */
export function logoDomain(url: string): string | null {
  try {
    const path = new URL(url).pathname.split('/');
    if (path[1] !== 'domain' || !path[2]) return null;
    return path[2].toLowerCase();
  } catch {
    return null;
  }
}

export function standInFor(url: string): StandIn {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  if (!host.endsWith('brandfetch.io')) {
    throw new Error(`stand-in asked for a non-Brandfetch host: ${host}`);
  }
  if (host.startsWith('api.') || parsed.pathname.includes('/search')) {
    return {
      status: 200,
      contentType: 'application/json',
      body: searchBody(parsed),
    };
  }
  const domain = logoDomain(url);
  if (!domain || TEST_MISS.has(domain) || extraMisses().has(domain)) {
    return { status: 404, contentType: 'text/plain', body: 'missing' };
  }
  const mark = MARKS[hash(domain) % MARKS.length] ?? MARKS[0];
  if (!mark) return { status: 404, contentType: 'text/plain', body: 'missing' };
  const type = assetType(url);
  if (type === 'icon') return { status: 200, contentType: 'image/svg+xml', body: mark };
  if (TEST_ICON_ONLY.has(domain) || extraMisses('BRANDFETCH_404_ASSETS').has(domain)) {
    return { status: 404, contentType: 'text/plain', body: 'missing' };
  }
  const theme = assetTheme(url);
  return {
    status: 200,
    contentType: 'image/svg+xml',
    body: type === 'symbol' ? symbolSvg(mark, theme) : wordmarkSvg(mark, theme),
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/**
 * A console error Check 6 allows: a failed load whose URL is on Brandfetch.
 * Chromium often puts that URL on the message location rather than in the text.
 * The text alone is not enough.
 */
export function isBrandfetchLoadError(text: string, url = ''): boolean {
  if (!/failed to load resource/i.test(text)) return false;
  if (hostOf(url).endsWith('brandfetch.io')) return true;
  return /https?:\/\/[^/\s]*brandfetch\.io/i.test(text);
}

/** Fill `{name}` and `{slug}` in the canned Brand Search fixture. */
export function searchBody(url: URL): string {
  const raw = decodeURIComponent(url.pathname.split('/').pop() ?? '').trim();
  const name = raw || 'Company';
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'company';
  const template = readFileSync(join(HERE, '../fixtures/brandfetch/search.json'), 'utf8');
  return template.replaceAll('{name}', name).replaceAll('{slug}', slug);
}

export async function installBrandfetchStandIns(
  page: Page,
  options?: { delayMs?: number },
): Promise<void> {
  const delay = options?.delayMs ?? DELAY_MS;
  await page.route(/brandfetch\.io/i, async (route) => {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    const stand = standInFor(route.request().url());
    await route.fulfill({
      status: stand.status,
      contentType: stand.contentType,
      body: stand.body,
    });
  });
}
