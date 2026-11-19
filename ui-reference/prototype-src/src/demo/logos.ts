/**
 * Stand-in marks for `?logos=demo`. Original abstract geometry only — gradient tiles with a
 * distinctive glyph picked from the company name. Never a real company's logo: the sample data
 * uses real company names, and the real marks load from Brandfetch in the browser instead.
 * A host page (or `?bf=<id>`) that sets `demoHooks.logos` supplies those real URLs; see brandfetch.ts.
 */

import { hasBrandDomain } from "./brandfetch";
import { demoHooks } from "./demo-hooks";

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Tile gradients, lighter corner → darker corner. One family per `--color-tile-*`. */
const PALETTES: { from: string; to: string }[] = [
  { from: "#8f80ff", to: "#5a3fd6" }, // violet
  { from: "#5a97ff", to: "#2b5fd0" }, // blue
  { from: "#35b9d8", to: "#0b7aa0" }, // cyan
  { from: "#2fcf9f", to: "#0f8f6a" }, // teal
  { from: "#58cf6f", to: "#2f8f45" }, // green
  { from: "#f2a73f", to: "#c27712" }, // amber
  { from: "#ff708f", to: "#d9466f" }, // pink
  { from: "#8a94a8", to: "#4b5468" }, // slate
];

/**
 * Abstract marks, each drawn inside ~[14,50] of a 64 box. `main` is the bright ink, `faint` a
 * translucent second tone for depth. All original: a ring, a sonar sweep, a nested hex, chevrons,
 * an orbit, a dot grid, a waveform, a triangle, an X of bars, and a node triad.
 */
const GLYPHS: ((main: string, faint: string) => string)[] = [
  (m, f) =>
    `<circle cx="31" cy="33" r="14" fill="none" stroke="${m}" stroke-width="5"/><circle cx="46" cy="20" r="6.5" fill="${f}"/>`,
  (m, f) =>
    `<g fill="none" stroke-linecap="round"><path d="M18 42 A18 18 0 0 1 46 42" stroke="${f}" stroke-width="4"/><path d="M24 42 A11 11 0 0 1 40 42" stroke="${m}" stroke-width="4"/></g><circle cx="32" cy="43" r="4" fill="${m}"/>`,
  (m, f) =>
    `<polygon points="32,15 48,24 48,42 32,51 16,42 16,24" fill="${f}"/><polygon points="32,24 41,29 41,39 32,44 23,39 23,29" fill="${m}"/>`,
  (m, f) =>
    `<g fill="none" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"><polyline points="19,21 31,32 19,43" stroke="${m}"/><polyline points="34,21 46,32 34,43" stroke="${f}"/></g>`,
  (m, f) =>
    `<ellipse cx="32" cy="32" rx="18" ry="9" fill="none" stroke="${f}" stroke-width="3.5" transform="rotate(-28 32 32)"/><circle cx="32" cy="32" r="7" fill="${m}"/><circle cx="48" cy="22" r="4.5" fill="${m}"/>`,
  (m, f) =>
    `<g fill="${m}"><circle cx="22" cy="22" r="4"/><circle cx="32" cy="22" r="4" fill="${f}"/><circle cx="42" cy="22" r="4"/><circle cx="22" cy="32" r="4" fill="${f}"/><circle cx="32" cy="32" r="4"/><circle cx="42" cy="32" r="4" fill="${f}"/><circle cx="22" cy="42" r="4"/><circle cx="32" cy="42" r="4" fill="${f}"/><circle cx="42" cy="42" r="4"/></g>`,
  (m, f) =>
    `<g><rect x="17" y="28" width="5" height="12" rx="2.5" fill="${m}"/><rect x="26" y="19" width="5" height="30" rx="2.5" fill="${m}"/><rect x="35" y="24" width="5" height="20" rx="2.5" fill="${f}"/><rect x="44" y="30" width="5" height="8" rx="2.5" fill="${m}"/></g>`,
  (m, f) =>
    `<path d="M32 15 L49 46 L15 46 Z" fill="${f}"/><path d="M32 28 L41 44 L23 44 Z" fill="${m}"/>`,
  (m, f) =>
    `<g transform="rotate(45 32 32)"><rect x="14" y="28" width="36" height="8" rx="4" fill="${m}"/><rect x="28" y="14" width="8" height="36" rx="4" fill="${f}"/></g>`,
  (m, f) =>
    `<g><circle cx="32" cy="22" r="7" fill="${m}"/><circle cx="42" cy="39" r="7" fill="${f}"/><circle cx="22" cy="39" r="7" fill="${m}"/><circle cx="32" cy="34" r="3.5" fill="${f}"/></g>`,
];

function inks(ink: "white" | "black"): { main: string; faint: string } {
  return ink === "black"
    ? { main: "#141418", faint: "rgba(20,20,24,0.3)" }
    : { main: "#ffffff", faint: "rgba(255,255,255,0.34)" };
}

function glyphFor(seed: string): (m: string, f: string) => string {
  return GLYPHS[(hash(seed) >>> 3) % GLYPHS.length] ?? GLYPHS[0]!;
}

function dataUri(xml: string): string {
  return `data:image/svg+xml,${encodeURIComponent(xml)}`;
}

/** A full gradient tile with the company's mark. The parent clips the corners. */
function tileSvg(seed: string): string {
  const pal = PALETTES[hash(seed) % PALETTES.length] ?? PALETTES[0]!;
  const { main, faint } = inks("white");
  const body = glyphFor(seed)(main, faint);
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${pal.from}"/><stop offset="1" stop-color="${pal.to}"/></linearGradient><radialGradient id="h" cx="0.3" cy="0.24" r="0.95"><stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/><stop offset="0.6" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs><rect width="64" height="64" fill="url(#g)"/><rect width="64" height="64" fill="url(#h)"/>${body}</svg>`;
  return dataUri(xml);
}

/** The mark alone, no tile, in one ink — Brandfetch's `type=symbol`. */
function symbolSvg(seed: string, ink: "white" | "black"): string {
  const { main, faint } = inks(ink);
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 10 44 44">${glyphFor(seed)(main, faint)}</svg>`;
  return dataUri(xml);
}

/** `?logos=demo`, read the same way as `?scout=`. */
export const LOGOS_DEMO =
  typeof location !== "undefined" && new URLSearchParams(location.search).get("logos") === "demo";

/** A placeholder mark for the logo picker and the Company logos page. Always a mark, never a real logo. */
export function placeholderMark(seed: string): string {
  return tileSvg(seed);
}

/**
 * A stand-in gradient mark for a company that would have a real logo, null (→ monogram) otherwise
 * or when the demo isn't on. Mirrors the live demo so both show the same logo/monogram split.
 */
export function demoLogoUrl(company: string): string | null {
  if (demoHooks.logos) return demoHooks.logos.tile(company);
  if (!LOGOS_DEMO || !hasBrandDomain(company)) return null;
  return tileSvg(company);
}

/** The header's cover. The stand-ins have one image per company, so it's the tile's. */
export function demoCoverUrl(company: string): string | null {
  if (demoHooks.logos) return demoHooks.logos.cover(company);
  return demoLogoUrl(company);
}

/** The same companies' stand-in symbol: the mark alone, as Brandfetch's `type=symbol`. */
export function demoSymbolUrl(company: string, ink: "white" | "black" = "white"): string | null {
  if (demoHooks.logos) return demoHooks.logos.symbol(company, ink);
  if (!LOGOS_DEMO || !hasBrandDomain(company)) return null;
  return symbolSvg(company, ink);
}

/**
 * The same companies' stand-in wordmark, as Brandfetch's `type=logo`:
 * the mark, then the name set in a system font. Never a real wordmark.
 * White ink is the light logo. Black ink is the dark logo.
 */
export function demoWordmarkUrl(company: string, ink: "white" | "black" = "white"): string | null {
  if (demoHooks.logos) return demoHooks.logos.wordmark(company, ink);
  if (!LOGOS_DEMO || !hasBrandDomain(company)) return null;
  const name = company.toLowerCase();
  const { main, faint } = inks(ink);
  const textW = Math.round(name.length * 21);
  const w = 64 + 10 + textW;
  const safe = name.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 64"><g transform="translate(-6 0)">${glyphFor(company)(main, faint)}</g><text x="66" y="46" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="700" font-size="42" letter-spacing="-1" textLength="${textW}" lengthAdjust="spacingAndGlyphs" fill="${main}">${safe}</text></svg>`;
  return dataUri(xml);
}
