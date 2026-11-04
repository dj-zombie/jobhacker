import type { Ats, BoardAts } from '../config/schemas.js';

/**
 * Map a careers URL to an ATS and board token (ARCHITECTURE § Sources).
 * The first path segment is the token. Query strings and later segments
 * (`/jobs/123`, `/apply`) are ignored. Greenhouse's embed pages carry the
 * token in `?for=`.
 */

/** ATSs a link can point at. Rippling and Personio have no adapter and are not in `ATS_VALUES`. */
export type LinkAts = BoardAts | 'rippling' | 'personio';

const PATH_HOSTS: Record<string, LinkAts> = {
  'boards.greenhouse.io': 'greenhouse',
  'job-boards.greenhouse.io': 'greenhouse',
  'job-boards.eu.greenhouse.io': 'greenhouse',
  'jobs.lever.co': 'lever',
  'jobs.eu.lever.co': 'lever',
  'jobs.ashbyhq.com': 'ashby',
  'jobs.smartrecruiters.com': 'smartrecruiters',
  'careers.smartrecruiters.com': 'smartrecruiters',
  'jobs.polymer.co': 'polymer',
  'apply.workable.com': 'workable',
  'ats.rippling.com': 'rippling',
};

/** Boards whose token is the subdomain: `<token>.breezy.hr`. */
const SUBDOMAIN_HOSTS: ReadonlyArray<[suffix: string, ats: LinkAts]> = [
  ['.breezy.hr', 'breezy'],
  ['.teamtailor.com', 'teamtailor'],
  ['.workable.com', 'workable'],
  ['.jobs.personio.de', 'personio'],
  ['.jobs.personio.com', 'personio'],
  ['.myworkdayjobs.com', 'workday'],
];

/** The registrable domains above, for finding links in free text. */
export const BOARD_LINK_DOMAINS = [
  'greenhouse.io',
  'lever.co',
  'ashbyhq.com',
  'smartrecruiters.com',
  'polymer.co',
  'workable.com',
  'rippling.com',
  'breezy.hr',
  'teamtailor.com',
  'personio.de',
  'personio.com',
  'myworkdayjobs.com',
] as const;

/** Path segments and subdomains that name a page or a product, never a board. */
const NOT_TOKENS = new Set([
  'api',
  'app',
  'apply',
  'careers',
  'embed',
  'help',
  'job',
  'jobs',
  'oneclick-ui',
  'search',
  'support',
  'v0',
  'v1',
  'www',
]);

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

/** ATSs with a board adapter, keyless or not. `companies:add` and moves accept only these. */
const ADAPTER_ATS: ReadonlySet<string> = new Set<Ats>([
  'greenhouse',
  'lever',
  'ashby',
  'smartrecruiters',
  'breezy',
  'polymer',
  'workable',
  'teamtailor',
]);

/** ATSs JobHacker reads with no key. A link to any other ATS is counted, never probed. */
export const KEYLESS_ATS: readonly BoardAts[] = [
  'greenhouse',
  'lever',
  'ashby',
  'smartrecruiters',
  'breezy',
  'polymer',
];

const ATS_LABEL: Record<string, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  smartrecruiters: 'SmartRecruiters',
  breezy: 'Breezy',
  polymer: 'Polymer',
  workable: 'Workable',
  teamtailor: 'Teamtailor',
  workday: 'Workday',
  rippling: 'Rippling',
  personio: 'Personio',
};

/** `smartrecruiters` → `SmartRecruiters`. An unknown id is returned as is. */
export function atsLabel(ats: string): string {
  return ATS_LABEL[ats] ?? ats;
}

export class DetectError extends Error {
  override readonly name = 'DetectError';

  constructor(url: string) {
    super(
      `could not detect an ATS board from "${url}". Expected boards.greenhouse.io/<token>, job-boards.greenhouse.io/<token>, jobs.lever.co/<token>, or jobs.ashbyhq.com/<token>.`,
    );
  }
}

/** The board a URL points at, or null when the host is not a job board or the path names none. */
export function boardFromUrl(url: URL): { ats: LinkAts; token: string } | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const pathAts = PATH_HOSTS[host];
  if (pathAts) {
    const segments = url.pathname.split('/').filter((part) => part.length > 0);
    const first = segments[0] ? safeDecode(segments[0]) : undefined;
    if (pathAts === 'greenhouse' && first?.toLowerCase() === 'embed') {
      const embedded = url.searchParams.get('for');
      return embedded && isToken(embedded) ? { ats: 'greenhouse', token: embedded } : null;
    }
    return first && isToken(first) ? { ats: pathAts, token: first } : null;
  }
  for (const [suffix, ats] of SUBDOMAIN_HOSTS) {
    if (!host.endsWith(suffix)) continue;
    const labels = host.slice(0, -suffix.length).split('.');
    // Workday tenants carry a data-center label: `<tenant>.wd5.myworkdayjobs.com`.
    const extra = ats === 'workday' ? labels.slice(1).every((l) => /^wd\d+$/.test(l)) : true;
    const token = labels[0];
    if (!token || !extra || (ats !== 'workday' && labels.length > 1)) return null;
    return isToken(token) ? { ats, token } : null;
  }
  return null;
}

export function detectBoard(input: string): { ats: Ats; token: string } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new DetectError(input);
  }
  const found = boardFromUrl(url);
  if (!found || !ADAPTER_ATS.has(found.ats)) throw new DetectError(input);
  return { ats: found.ats as Ats, token: found.token };
}

/** "spotify" → "Spotify", "open-ai" → "Open Ai". Used when the board has no display name. */
export function humanizeToken(token: string): string {
  const words = token.split(/[-_]+/).filter((word) => word.length > 0);
  if (words.length === 0) return token;
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/**
 * A company name taken from somewhere other than the board, or undefined when it doesn't read as
 * one. An HN comment's company field can hold the whole first sentence, link and all.
 */
export function plainCompanyName(name: string | undefined): string | undefined {
  const trimmed = name?.trim() ?? '';
  if (trimmed.length === 0 || trimmed.length > 60) return undefined;
  if (/:\/\/|www\.|\bis hiring\b/i.test(trimmed)) return undefined;
  return trimmed;
}

function isToken(value: string): boolean {
  return TOKEN.test(value) && !NOT_TOKENS.has(value.toLowerCase());
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
