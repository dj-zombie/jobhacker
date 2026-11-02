import type { Ats } from '../config/schemas.js';

/**
 * Map a careers URL to an ATS and board token (ARCHITECTURE § Sources).
 * The first path segment is the token. Query strings and later segments
 * (`/jobs/123`, `/apply`) are ignored.
 */

const HOSTS: Record<string, Ats> = {
  'boards.greenhouse.io': 'greenhouse',
  'job-boards.greenhouse.io': 'greenhouse',
  'jobs.lever.co': 'lever',
  'jobs.ashbyhq.com': 'ashby',
  'jobs.smartrecruiters.com': 'smartrecruiters',
  'careers.smartrecruiters.com': 'smartrecruiters',
  'jobs.polymer.co': 'polymer',
  'apply.workable.com': 'workable',
};

export class DetectError extends Error {
  override readonly name = 'DetectError';

  constructor(url: string) {
    super(
      `could not detect an ATS board from "${url}". Expected boards.greenhouse.io/<token>, job-boards.greenhouse.io/<token>, jobs.lever.co/<token>, or jobs.ashbyhq.com/<token>.`,
    );
  }
}

export function detectBoard(input: string): { ats: Ats; token: string } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new DetectError(input);
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host.endsWith('.breezy.hr')) {
    const token = host.slice(0, -'.breezy.hr'.length);
    if (!token || token.includes('.')) throw new DetectError(input);
    return { ats: 'breezy', token };
  }
  if (host.endsWith('.teamtailor.com')) {
    const token = host.slice(0, -'.teamtailor.com'.length);
    if (!token || token.includes('.')) throw new DetectError(input);
    return { ats: 'teamtailor', token };
  }
  const ats = HOSTS[host];
  if (!ats) throw new DetectError(input);

  const segments = url.pathname.split('/').filter((part) => part.length > 0);
  const token = segments[0] ? safeDecode(segments[0]) : undefined;
  // boards.greenhouse.io/embed/job_board?for=token is not a board slug.
  if (!token || token.toLowerCase() === 'embed') throw new DetectError(input);
  return { ats, token };
}

/** "spotify" → "Spotify", "open-ai" → "Open Ai". Used when the board has no display name. */
export function humanizeToken(token: string): string {
  const words = token.split(/[-_]+/).filter((word) => word.length > 0);
  if (words.length === 0) return token;
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
