import { createHash } from 'node:crypto';
import { normalizeWhitespace } from './text.js';

/**
 * `content_hash` = sha256 of the normalized title + description. When it
 * changes, the job is rescored (ARCHITECTURE § Data model).
 */
export function contentHash(title: string, description: string): string {
  const basis = `${normalizeWhitespace(title)}\n${normalizeWhitespace(description)}`;
  return createHash('sha256').update(basis, 'utf8').digest('hex');
}

/**
 * `dedupe_key` = sha1 of normalized company, title and location. Later matches
 * get `duplicate_of` set to the first-seen job (ARCHITECTURE § Data model).
 */
export function dedupeKey(company: string, title: string, location: string): string {
  const basis = [
    normalizeCompanyName(company),
    normalizeForKey(title),
    normalizeForKey(location),
  ].join('|');
  return createHash('sha1').update(basis, 'utf8').digest('hex');
}

/** sha256 hex digest of arbitrary content. */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Company names only: case, accents, punctuation, and legal suffixes.
 * "Stripe, Inc." and "Stripe LLC" share a key. Titles and locations keep
 * their punctuation so "C++" does not collapse into "C".
 */
export function normalizeCompanyName(value: string): string {
  const base = normalizeForKey(value).replace(/[^a-z0-9]+/g, ' ');
  const stripped = base.replace(
    /\b(incorporated|inc|l l c|llc|ltd|limited|corp|corporation|plc|gmbh)\b/g,
    ' ',
  );
  return normalizeWhitespace(stripped);
}

/** Lowercase, strip accents and collapse whitespace so keys are stable. */
function normalizeForKey(value: string): string {
  return (
    normalizeWhitespace(value)
      .toLowerCase()
      .normalize('NFKD')
      // biome-ignore lint/suspicious/noMisleadingCharacterClass: stripping combining marks for key stability
      .replace(/[\u0300-\u036f]/g, '')
  );
}
