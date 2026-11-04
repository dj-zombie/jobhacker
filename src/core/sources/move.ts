import { MoveError, type MoveResult, moveBoard } from '../config/companies-file.js';
import type { Ats } from '../config/schemas.js';
import type { Db } from '../db/client.js';
import type { Clock } from '../util/clock.js';
import type { Http } from '../util/http.js';
import { atsLabel, boardFromUrl, detectBoard, humanizeToken, plainCompanyName } from './detect.js';
import { loadBoard } from './registry.js';
import { goneStatus } from './relocate.js';

/**
 * Moving a board to a pasted careers link (J15): detect the ATS from the
 * link, fetch the board once, and move only when it has postings. Each
 * refusal says why in words the card shows as they are, and changes nothing.
 */

export { MoveError };

export interface VerifiedBoard {
  ats: Ats;
  token: string;
  name: string;
  postings: number;
}

export async function verifyBoardLink(options: {
  url: string;
  http: Http;
  keys?: { workable?: string; teamtailor?: string };
  /** Name for a board whose API gives none. */
  fallbackName?: string;
}): Promise<VerifiedBoard> {
  const url = options.url.trim();
  let board: { ats: Ats; token: string };
  try {
    board = detectBoard(url);
  } catch {
    throw new MoveError(unreadableReason(url));
  }
  const adapter = loadBoard(board.ats);
  if (!adapter) throw new MoveError(unreadableReason(url));
  const key =
    board.ats === 'workable'
      ? options.keys?.workable
      : board.ats === 'teamtailor'
        ? options.keys?.teamtailor
        : undefined;
  if (adapter.needsKey && !key) {
    throw new MoveError(
      `That's a ${atsLabel(board.ats)} board, and JobHacker needs an API key to read those. Nothing changed.`,
    );
  }

  let raw: unknown;
  try {
    // One fetch of the URL's own board. A redirect is an error, same as a probe:
    // following it would count some other board as this token.
    const http: Http = {
      getJson: (url, request) => options.http.getJson(url, { ...request, redirect: 'error' }),
      postJson() {
        throw new Error('postJson is not used by this fake');
      },
    };
    raw = await adapter.fetchBoard(board.token, http, key);
  } catch (err) {
    const status = goneStatus(err);
    throw new MoveError(
      status != null
        ? `That board returned ${status}, so it isn't there either. Nothing changed.`
        : "That board didn't answer. Nothing changed. Try again in a minute.",
    );
  }
  let postings: number;
  try {
    postings = adapter.parse(raw).postings.length;
  } catch {
    throw new MoveError("That board answered, but JobHacker couldn't read it. Nothing changed.");
  }
  if (postings === 0) throw new MoveError('That board has no postings, so nothing changed.');
  return {
    ats: board.ats,
    token: board.token,
    name:
      adapter.companyName(raw) ||
      plainCompanyName(options.fallbackName) ||
      humanizeToken(board.token),
    postings,
  };
}

/** Verify the link, then `moveBoard`. */
export async function moveToLink(
  deps: {
    dir: string;
    db: Db;
    clock: Clock;
    http: Http;
    keys?: { workable?: string; teamtailor?: string };
  },
  from: { ats: Ats; token: string; name: string },
  url: string,
): Promise<MoveResult & { postings: number }> {
  const verified = await verifyBoardLink({
    url,
    http: deps.http,
    keys: deps.keys,
    fallbackName: from.name,
  });
  const moved = moveBoard(deps, from, verified);
  return { ...moved, postings: verified.postings };
}

function unreadableReason(url: string): string {
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }
  const found = parsed ? boardFromUrl(parsed) : null;
  if (found) {
    return `That's a ${atsLabel(found.ats)} board. JobHacker can't read ${atsLabel(found.ats)} boards yet, so nothing changed.`;
  }
  return "That link isn't a board JobHacker can read. Nothing changed.";
}
