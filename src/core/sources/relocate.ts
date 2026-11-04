import { z } from 'zod';
import { BOARD_ATS, type BoardAts } from '../config/schemas.js';
import { normalizeCompanyName } from '../util/hash.js';
import { HttpError } from '../util/http.js';
import { KEYLESS_ATS, atsLabel } from './detect.js';
import { type ProbeContext, probeBoard, slugForms } from './discover.js';
import { type HarvestSource, linkedBoards } from './harvest.js';
import { boardKey } from './links.js';

/**
 * Relocation (J15): where a gone board may have moved. Two places, cheapest
 * first: board links in stored search hits from a company of the same name,
 * then the board's name on the other keyless ATSs. Only links already in
 * source data and the public ATS endpoints are used. Nothing fetches a
 * careers page or follows a redirect (invariant 2). It only offers: Kris
 * confirms a move.
 */

/** Statuses that mean the public board is gone. The card offers Turn off and a move for these. */
export const GONE_STATUS: ReadonlySet<number> = new Set([400, 404, 410, 422]);

/** Links from one gone board's matching hits probed at most. A short name can match many companies. */
export const RELOCATE_SEARCH_LINKS = 10;

export interface RelocationCandidate {
  ats: BoardAts;
  token: string;
  name: string;
  postings: number;
  /** `search`: a search hit linked it. `name`: the board's name answered on that ATS. */
  via: 'search' | 'name';
}

export interface Relocation {
  ats: string;
  token: string;
  name: string;
  /** Keyless ATSs the board's name was tried on, in order. */
  looked: string[];
  /** Stored search hits whose company matched the board's name. */
  matched_hits: number;
  /** ATSs where a probe failed for another reason (timeout, 5xx), so the answer there is unknown. */
  unanswered: string[];
  candidates: RelocationCandidate[];
}

const relocationsSchema = z.object({
  relocation: z
    .array(
      z.object({
        ats: z.string(),
        token: z.string(),
        name: z.string(),
        looked: z.array(z.string()),
        matched_hits: z.number(),
        unanswered: z.array(z.string()),
        candidates: z.array(
          z.object({
            ats: z.enum(BOARD_ATS),
            token: z.string(),
            name: z.string(),
            postings: z.number(),
            via: z.enum(['search', 'name']),
          }),
        ),
      }),
    )
    .default([]),
});

/** The relocations a scout run stored. A run from before J15, or unreadable stats, has none. */
export function relocationsFromStats(stats: unknown): Relocation[] {
  const parsed = relocationsSchema.safeParse(stats ?? {});
  return parsed.success ? parsed.data.relocation : [];
}

/** `HTTP 404 from …` → 404. */
export function httpStatus(message: string): number | null {
  const match = /^HTTP (\d{3})\b/.exec(message);
  if (!match?.[1]) return null;
  const status = Number(match[1]);
  return Number.isInteger(status) ? status : null;
}

/** The status when an error means the board is gone, else null. */
export function goneStatus(err: unknown): number | null {
  const status =
    err instanceof HttpError
      ? (err.status ?? null)
      : httpStatus(err instanceof Error ? err.message : String(err));
  return status != null && GONE_STATUS.has(status) ? status : null;
}

/**
 * Same company, by dedupe's normalization (suffixes, punctuation, case), or a
 * hit company that contains the board's name as whole words: `Coinhako` in `SBI Coinhako`.
 */
export function nameMatches(boardName: string, hitCompany: string): boolean {
  const board = normalizeCompanyName(boardName);
  const hit = normalizeCompanyName(hitCompany);
  if (!board || !hit) return false;
  if (board === hit) return true;
  return board.length >= 3 && ` ${hit} `.includes(` ${board} `);
}

export async function relocateBoard(
  ctx: ProbeContext,
  input: {
    board: { ats: string; token: string; name: string };
    /** Stored search hits, newest first. */
    hits: readonly HarvestSource[];
    enabled: readonly BoardAts[];
  },
): Promise<Relocation> {
  const { board } = input;
  const enabled = new Set<string>(input.enabled);
  const isEnabled = (ats: string): ats is BoardAts => enabled.has(ats);
  const self = boardKey(board.ats, board.token);
  const found = new Map<string, RelocationCandidate>();
  const unanswered: string[] = [];

  const matched = input.hits.filter((hit) => nameMatches(board.name, hit.companyName));
  const links = linkedBoards(matched).filter(
    (link) => link.readable && boardKey(link.ats, link.token) !== self,
  );
  for (const link of links.slice(0, RELOCATE_SEARCH_LINKS)) {
    const ats = link.ats;
    if (!isEnabled(ats)) continue;
    const result = await probeBoard(
      ctx,
      { ats, token: link.token },
      { fallbackName: link.companyName },
    );
    if (result.kind === 'hit') {
      found.set(boardKey(ats, link.token), {
        ats,
        token: link.token,
        name: result.name,
        postings: result.postings,
        via: 'search',
      });
    } else if (result.kind === 'error' && !unanswered.includes(ats)) {
      unanswered.push(ats);
    }
  }

  const looked: string[] = [];
  const forms = slugForms(board.name);
  for (const ats of KEYLESS_ATS) {
    if (ats === board.ats || !enabled.has(ats) || forms.length === 0) continue;
    looked.push(ats);
    for (const token of forms) {
      if (found.has(boardKey(ats, token))) break;
      const result = await probeBoard(ctx, { ats, token }, { fallbackName: board.name });
      if (result.kind === 'hit') {
        found.set(boardKey(ats, token), {
          ats,
          token,
          name: result.name,
          postings: result.postings,
          via: 'name',
        });
        break;
      }
      if (result.kind === 'error' && !unanswered.includes(ats)) unanswered.push(ats);
    }
  }

  return {
    ats: board.ats,
    token: board.token,
    name: board.name,
    looked,
    matched_hits: matched.length,
    unanswered,
    candidates: [...found.values()],
  };
}

/** "Looked on Lever, Ashby and SmartRecruiters, and in your search results: no new board" */
export function lookedLine(relocation: Pick<Relocation, 'looked' | 'unanswered' | 'candidates'>) {
  const where =
    relocation.looked.length > 0
      ? `Looked on ${listWords(relocation.looked.map(atsLabel))}, and in your search results`
      : 'Looked in your search results';
  const silent =
    relocation.unanswered.length > 0
      ? ` (${listWords(relocation.unanswered.map(atsLabel))} didn't answer)`
      : '';
  const n = relocation.candidates.length;
  const result = n === 0 ? 'no new board' : `found ${n} board${n === 1 ? '' : 's'}`;
  return `${where}${silent}: ${result}`;
}

/** "A", "A and B", "A, B and C". */
export function listWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}
