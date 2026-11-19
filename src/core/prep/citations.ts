import { USER_AGENT } from '../util/http.js';
import { decodeEntities, htmlToText } from '../util/text.js';

/**
 * A public page Kris linked in an answer note (D181). Title, authors and
 * wording may ground a draft. Numbers in the page body may not, so a paper's
 * "16 tasks" cannot become a claim about him.
 */

export interface CitationGrounding {
  /** Title, authors, abstract, and the word "arXiv". Proper nouns may come from here. */
  terms: string;
  /** The arXiv id only. The publication year is deliberately left out. */
  numbers: string;
}

const ABS_HOSTS = new Set(['arxiv.org', 'www.arxiv.org', 'export.arxiv.org']);
const ABS_PATH = /^\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5})(?:v\d+)?\/?$/;
const FETCH_TIMEOUT_MS = 15_000;
const FETCH_GAP_MS = 1_000;
const MAX_HTML_CHARS = 100_000;
/** Initial request plus this many redirects. The next hop is not requested. */
const MAX_REDIRECTS = 3;

/** Shared across readers so two drafts still wait a second between reads. */
const fetchGap = { nextAt: 0 };

/** Test hook. Production never calls this. */
export function resetLinkFetchGap(): void {
  fetchGap.nextAt = 0;
}

const NOTE_URL = /https:\/\/[^\s<>"']+/i;

export type NoteLink = { ok: true; url: string } | { ok: false; reason: string };

/** The first https link in a note. A private or local host is rejected and not fetched. */
export function linkInNote(note: string): NoteLink | null {
  const raw = note.match(NOTE_URL)?.[0]?.replace(/[).,;:]+$/, '');
  if (!raw) return null;
  const url = publicPageUrl(raw);
  if (!url) return { ok: false, reason: 'that link is not a public page' };
  return { ok: true, url };
}

/** Https URL with a public host and no embedded credentials, or null. */
export function publicPageUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (isPrivateHost(url.hostname)) return null;
  url.hash = '';
  return url.toString();
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host.includes(':')) {
    return (
      host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')
    );
  }
  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/** `https://arxiv.org/abs/<id>`, or null when `raw` is not an arXiv abstract or pdf. */
export function canonicalArxivAbs(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (!ABS_HOSTS.has(url.hostname.toLowerCase())) return null;
  const id = url.pathname.match(ABS_PATH)?.[1];
  if (!id) return null;
  return `https://arxiv.org/abs/${id}`;
}

function metaAll(html: string, name: string): string[] {
  const out: string[] = [];
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const nameRe = new RegExp(`\\bname=["']${name}["']`, 'i');
  for (const tag of tags) {
    if (!nameRe.test(tag)) continue;
    const content = tag.match(/\bcontent="([^"]*)"/i) ?? tag.match(/\bcontent='([^']*)'/i);
    if (content?.[1]) out.push(decodeEntities(content[1]).trim());
  }
  return out;
}

function abstractOf(html: string): string {
  const fromMeta = metaAll(html, 'citation_abstract')[0] ?? '';
  if (fromMeta.length > 40) return fromMeta.slice(0, 6_000);
  const block = html.match(/<blockquote\b[^>]*\babstract\b[^>]*>([\s\S]*?)<\/blockquote>/i);
  if (!block?.[1]) return fromMeta.slice(0, 6_000);
  return htmlToText(block[1]).slice(0, 6_000);
}

/**
 * Terms and the arXiv id from an abstract page. Null when the page has no
 * citation title and no authors, so an error page cannot ground a draft.
 */
export function groundingFromArxivHtml(html: string, absUrl: string): CitationGrounding | null {
  const title = metaAll(html, 'citation_title')[0] ?? '';
  const authors = metaAll(html, 'citation_author');
  if (!title && authors.length === 0) return null;
  const fromPage = metaAll(html, 'citation_arxiv_id')[0] ?? '';
  const id = /^\d{4}\.\d{4,5}$/.test(fromPage)
    ? fromPage
    : (absUrl.match(/(\d{4}\.\d{4,5})/)?.[1] ?? '');
  return {
    terms: ['arXiv', title, ...authors, abstractOf(html)]
      .filter((part) => part.length > 0)
      .join('\n'),
    numbers: id,
  };
}

/**
 * Terms from a page Kris linked. An arXiv abstract contributes its title,
 * authors, abstract and id. Any other page contributes its text and no numbers.
 * Null when the page has nothing usable.
 */
export function groundingFromPage(html: string, pageUrl: string): CitationGrounding | null {
  const abs = canonicalArxivAbs(pageUrl);
  if (abs) {
    const paper = groundingFromArxivHtml(html, abs);
    if (paper) return paper;
  }
  const text = htmlToText(html).slice(0, 4_000).trim();
  if (text.length < 40) return null;
  return { terms: text, numbers: '' };
}

export interface LinkReaderOptions {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

async function waitTurn(now: () => number, sleep: (ms: number) => Promise<void>): Promise<void> {
  const due = Math.max(fetchGap.nextAt, now());
  fetchGap.nextAt = due + FETCH_GAP_MS;
  const wait = due - now();
  if (wait > 0) await sleep(wait);
}

/** The next hop, resolved against the page that sent it, or null when it isn't a URL. */
function redirectTarget(from: string, location: string): string | null {
  try {
    return new URL(location.trim(), from).toString();
  } catch {
    return null;
  }
}

/**
 * Reads one public page. Redirects are followed by hand, and each hop is
 * checked with `publicPageUrl` before it is requested, so a public link that
 * points at 127.0.0.1 or 192.168.x.x is never fetched.
 */
async function fetchPublicHtml(
  url: string,
  fetchImpl: typeof fetch,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
): Promise<string | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const allowed = publicPageUrl(current);
    if (!allowed) return null;
    await waitTurn(now, sleep);

    const timer: { id?: ReturnType<typeof setTimeout> } = {};
    try {
      const response = await new Promise<Response>((resolve, reject) => {
        const controller = new AbortController();
        timer.id = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        fetchImpl(allowed, {
          headers: { accept: 'text/html', 'user-agent': USER_AGENT },
          signal: controller.signal,
          redirect: 'manual',
        }).then(resolve, reject);
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || hop === MAX_REDIRECTS) return null;
        const next = redirectTarget(allowed, location);
        if (!next) return null;
        current = next;
        continue;
      }
      if (!response.ok) return null;
      const type = response.headers.get('content-type') ?? '';
      if (type && !/text\/html|text\/plain|application\/xhtml/i.test(type)) return null;
      return (await response.text()).slice(0, MAX_HTML_CHARS);
    } catch {
      return null;
    } finally {
      if (timer.id !== undefined) clearTimeout(timer.id);
    }
  }
  return null;
}

/**
 * Reads the page Kris linked and returns what a draft may take from it.
 * An arXiv pdf or abstract link is read as the abstract. At most one read a
 * second (invariant 6). Never throws.
 */
export function createNoteLinkReader(
  options: LinkReaderOptions = {},
): (url: string) => Promise<CitationGrounding | null> {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  return async (raw) => {
    const abs = canonicalArxivAbs(raw);
    const url = abs ?? publicPageUrl(raw);
    if (!url) return null;
    const html = await fetchPublicHtml(url, fetchImpl, now, sleep);
    if (!html) return null;
    return groundingFromPage(html, url);
  };
}
