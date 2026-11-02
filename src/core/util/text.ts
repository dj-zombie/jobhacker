/**
 * Text helpers shared across core. Kept dependency-free and pure so they are
 * trivially testable.
 */

/** Collapse all runs of whitespace to single spaces and trim the ends. */
export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

const BLOCK_TAGS = /<\/?(p|div|br|li|ul|ol|tr|h[1-6]|section|article|header|footer)\b[^>]*>/gi;

/**
 * Convert an HTML fragment to readable plain text. This is intentionally small:
 * it decodes the common named/numeric entities, turns block-level tags into
 * line breaks, strips the remaining tags, and tidies the whitespace. It is good
 * enough for turning ATS job descriptions into text for hashing and scoring.
 */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*[^>]*>/gi, '\n')
    .replace(BLOCK_TAGS, '\n');

  const noTags = withBreaks.replace(/<[^>]+>/g, '');
  const decoded = decodeEntities(noTags);

  return decoded
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  rsquo: '\u2019',
  lsquo: '\u2018',
  ldquo: '\u201c',
  rdquo: '\u201d',
};

/**
 * Decode a numeric character reference. Out-of-range points make
 * `String.fromCodePoint` throw; lone surrogates become strings that break
 * later JSON encoding. Both stay as the original entity text.
 */
function decodeCodePoint(code: number): string | undefined {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return undefined;
  if (code >= 0xd800 && code <= 0xdfff) return undefined;
  return String.fromCodePoint(code);
}

/** Decode the handful of HTML entities that show up in job descriptions. */
export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return decodeCodePoint(Number.parseInt(body.slice(2), 16)) ?? match;
    }
    if (body.startsWith('#')) {
      return decodeCodePoint(Number.parseInt(body.slice(1), 10)) ?? match;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

/** Truncate to at most `max` characters on a word boundary, adding an ellipsis. */
export function truncate(input: string, max: number): string {
  if (max < 1) return '';
  if (input.length <= max) return input;
  const budget = max - 1;
  const slice = input.slice(0, budget);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > budget * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}\u2026`;
}

/**
 * Split text into lowercase alphanumeric tokens. Used by grounding and dedupe
 * logic in later rounds; lives here so there is one definition of a "token".
 */
export function tokenize(input: string): string[] {
  const matches = input.toLowerCase().match(/[a-z0-9][a-z0-9+#.-]*/g);
  return matches ?? [];
}
