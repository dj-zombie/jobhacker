import { normalizeCompanyName } from '../util/hash.js';

/**
 * Names a search source puts where the employer's name belongs (J29 fix).
 * JSearch stores Oowlish's posting under "Remote". A job under one of these
 * has no known employer: no apply link is tied to it, a later sighting never
 * writes one over a real name, and the app shows `UNNAMED_EMPLOYER`.
 * Compared after `normalizeCompanyName`.
 */
export const PLACEHOLDER_EMPLOYERS: readonly string[] = [
  'remote',
  'confidential',
  'confidential company',
  'company confidential',
  'stealth',
  'stealth startup',
  'stealth company',
  'stealth mode',
  'undisclosed',
  'anonymous',
];

export const UNNAMED_EMPLOYER = 'Employer not named';

export function isPlaceholderEmployer(name: string): boolean {
  const key = normalizeCompanyName(name);
  return key === '' || PLACEHOLDER_EMPLOYERS.includes(key);
}

/** The name to show for a company: `UNNAMED_EMPLOYER` in place of a placeholder. */
export function shownEmployer(name: string): string {
  return isPlaceholderEmployer(name) ? UNNAMED_EMPLOYER : name;
}
