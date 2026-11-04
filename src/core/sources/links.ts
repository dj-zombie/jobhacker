import { BOARD_LINK_DOMAINS, KEYLESS_ATS, type LinkAts, boardFromUrl } from './detect.js';

/**
 * Board links inside a job's `url`, `apply_url` or description (J15). Only
 * links already in the source data are read: nothing here fetches a page or
 * follows a redirect (invariant 2). A link to an ATS with no keyless adapter
 * comes back `readable: false`, so it can be counted and never probed.
 */

export interface BoardLink {
  ats: LinkAts;
  /** As the link gives it. Ashby tokens are case-insensitive, so dedupe ignores case. */
  token: string;
  readable: boolean;
}

const KEYLESS: ReadonlySet<string> = new Set(KEYLESS_ATS);

const LINK = new RegExp(
  `(?:https?://)?(?:[a-z0-9-]+\\.)+(?:${BOARD_LINK_DOMAINS.map((d) => d.replace(/\./g, '\\.')).join('|')})(?:/[^\\s<>"'\`]*)?`,
  'gi',
);

/** Every board one or more texts link to, once each, in the order first seen. */
export function boardLinks(...texts: ReadonlyArray<string | null | undefined>): BoardLink[] {
  const found: BoardLink[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(LINK)) {
      const link = parseLink(match[0]);
      if (!link) continue;
      const key = boardKey(link.ats, link.token);
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(link);
    }
  }
  return found;
}

/** `ats:token`, lowercased. The same board in two casings is one board. */
export function boardKey(ats: string, token: string): string {
  return `${ats}:${token.toLowerCase()}`;
}

function parseLink(raw: string): BoardLink | null {
  let text = raw;
  // HN shortens long link text with an ellipsis. The cut segment is not a token.
  if (/(\.\.\.|…)$/.test(text)) text = text.replace(/[^/]*$/, '');
  text = text.replace(/[),.;:!?\]}'"]+$/, '');
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const board = boardFromUrl(url);
  if (!board) return null;
  return { ...board, readable: KEYLESS.has(board.ats) };
}
