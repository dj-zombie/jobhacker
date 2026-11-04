/**
 * Stand-in marks for `?logos=demo`. Geometric shapes only, in the tile colors.
 * Never a real company's logo: the sample data uses real company names.
 */

const TILES = ["#6d5dfc", "#3b74f0", "#0b8fb0", "#0f8f7a", "#2f8f45", "#c27712", "#d9466f", "#5b6478"];

function svg(bg: string, body: string): string {
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${bg}"/>${body}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(xml)}`;
}

const MARKS = [
  (bg: string) => svg(bg, `<circle cx="32" cy="32" r="16" fill="#ffffff"/>`),
  (bg: string) => svg(bg, `<polygon points="32,14 50,50 14,50" fill="#ffffff"/>`),
  (bg: string) =>
    svg(
      bg,
      `<rect x="16" y="14" width="8" height="36" fill="#ffffff"/><rect x="28" y="14" width="8" height="36" fill="#ffffff"/><rect x="40" y="14" width="8" height="36" fill="#ffffff"/>`,
    ),
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** `?logos=demo`, read the same way as `?scout=`. */
export const LOGOS_DEMO =
  typeof location !== "undefined" && new URLSearchParams(location.search).get("logos") === "demo";

/** A placeholder mark for the logo picker and the Company logos page. Always a mark, never a real logo. */
export function placeholderMark(seed: string): string {
  const h = hash(seed);
  const mark = MARKS[h % MARKS.length];
  const bg = TILES[(h >>> 4) % TILES.length];
  if (!mark || !bg) return MARKS[0]?.(TILES[0] ?? "#6d5dfc") ?? "";
  return mark(bg);
}

/** A placeholder for about half of companies, or null so the tile stays a monogram. */
export function demoLogoUrl(company: string): string | null {
  if (!LOGOS_DEMO) return null;
  const h = hash(company);
  if (h % 2 === 1) return null;
  const mark = MARKS[h % MARKS.length];
  const bg = TILES[(h >>> 4) % TILES.length];
  if (!mark || !bg) return null;
  return mark(bg);
}

/** The same companies' stand-in symbol: the shape alone, as Brandfetch's `type=symbol`. */
export function demoSymbolUrl(company: string, ink: "white" | "black" = "white"): string | null {
  if (!demoLogoUrl(company)) return null;
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 10 44 44">${glyph(company, ink)}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(xml)}`;
}

/**
 * The same companies' stand-in wordmark, as Brandfetch's `type=logo`:
 * the stand-in shape, then the name set in a system font. Never a real wordmark.
 * White ink is the light logo. Black ink is the dark logo.
 */
export function demoWordmarkUrl(company: string, ink: "white" | "black" = "white"): string | null {
  if (!demoLogoUrl(company)) return null;
  const name = company.toLowerCase();
  const textW = Math.round(name.length * 21);
  const w = 64 + 10 + textW;
  const fill = ink === "black" ? "#141418" : "#ffffff";
  const safe = name.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 64"><g transform="translate(-6 0)">${glyph(company, ink)}</g><text x="66" y="46" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="700" font-size="42" letter-spacing="-1" textLength="${textW}" lengthAdjust="spacingAndGlyphs" fill="${fill}">${safe}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(xml)}`;
}

function glyph(company: string, ink: "white" | "black"): string {
  const shape = GLYPHS[hash(company) % GLYPHS.length] ?? "";
  return ink === "black" ? shape.replaceAll("#ffffff", "#141418") : shape;
}

const GLYPHS = [
  `<circle cx="32" cy="32" r="16" fill="#ffffff"/>`,
  `<polygon points="32,14 50,50 14,50" fill="#ffffff"/>`,
  `<rect x="16" y="14" width="8" height="36" fill="#ffffff"/><rect x="28" y="14" width="8" height="36" fill="#ffffff"/><rect x="40" y="14" width="8" height="36" fill="#ffffff"/>`,
];
