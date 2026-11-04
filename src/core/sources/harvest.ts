import type { BoardAts } from '../config/schemas.js';
import { type ProbeContext, probeBoard } from './discover.js';
import { type BoardLink, boardKey, boardLinks } from './links.js';

/**
 * Harvest (J15): add the boards that search hits link to. Each link to a
 * keyless ATS that `companies.yaml` doesn't list and the discovery cache
 * hasn't recorded as a miss or an empty board is probed once, and a board
 * with postings is appended active with the tag `search-link`. It only adds
 * boards. It drops no job and gates nothing (invariant 8).
 */

/** Probes per scout. The rest wait for a later run, or `boards:harvest`. */
export const HARVEST_PER_RUN = 20;

export const HARVEST_TAG = 'search-link';

/** One search hit: its company, and the text its links are read from. */
export interface HarvestSource {
  companyName: string;
  texts: ReadonlyArray<string | null | undefined>;
}

export interface HarvestStats {
  /** Distinct boards on enabled keyless ATSs that the hits link to. */
  linked: number;
  /** Of `linked`, listed in companies.yaml, or cached as a miss or empty. Not probed. */
  known: number;
  probed: number;
  added: number;
  /** New links past the cap, left for the next run. */
  waiting: number;
  /** Probes that failed for another reason (timeout, 5xx). Not cached, so tried again. */
  errors: number;
  /** Distinct links to ATSs JobHacker can't read with no key. Counted, never probed. */
  unreadable: number;
  unreadable_by_ats: Record<string, number>;
}

export interface HarvestedBoard {
  ats: BoardAts;
  token: string;
  name: string;
  postings: number;
}

export interface HarvestResult {
  stats: HarvestStats;
  added: HarvestedBoard[];
}

/** Every board the sources link to, with the first company that linked it. */
export function linkedBoards(
  sources: readonly HarvestSource[],
): Array<BoardLink & { companyName: string }> {
  const out: Array<BoardLink & { companyName: string }> = [];
  const seen = new Set<string>();
  for (const source of sources) {
    for (const link of boardLinks(...source.texts)) {
      const key = boardKey(link.ats, link.token);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...link, companyName: source.companyName });
    }
  }
  return out;
}

export async function harvestBoards(
  ctx: ProbeContext,
  input: {
    sources: readonly HarvestSource[];
    /** Every board in companies.yaml, active or not. */
    listed: ReadonlyArray<{ ats: string; token: string }>;
    enabled: readonly BoardAts[];
    /** Most boards to probe. Omitted: no cap (`boards:harvest`). */
    limit?: number;
    /** Called every 25 probes, so a long backfill keeps the cache it built. */
    save?: () => void;
  },
): Promise<HarvestResult> {
  const enabled = new Set<string>(input.enabled);
  const isEnabled = (ats: string): ats is BoardAts => enabled.has(ats);
  const listed = new Set(input.listed.map((board) => boardKey(board.ats, board.token)));
  const stats: HarvestStats = {
    linked: 0,
    known: 0,
    probed: 0,
    added: 0,
    waiting: 0,
    errors: 0,
    unreadable: 0,
    unreadable_by_ats: {},
  };
  const added: HarvestedBoard[] = [];
  const fresh: Array<{ ats: BoardAts; token: string; companyName: string }> = [];

  for (const link of linkedBoards(input.sources)) {
    if (!link.readable) {
      stats.unreadable += 1;
      stats.unreadable_by_ats[link.ats] = (stats.unreadable_by_ats[link.ats] ?? 0) + 1;
      continue;
    }
    const ats = link.ats;
    if (!isEnabled(ats)) continue;
    stats.linked += 1;
    const key = boardKey(ats, link.token);
    const cached = ctx.cache.entries[key];
    if (listed.has(key) || cached === 'miss' || cached === 'empty') {
      stats.known += 1;
      continue;
    }
    fresh.push({ ats, token: link.token, companyName: link.companyName });
  }

  const limit = input.limit ?? fresh.length;
  stats.waiting = Math.max(0, fresh.length - limit);
  let sinceSave = 0;
  for (const board of fresh.slice(0, limit)) {
    const result = await probeBoard(
      ctx,
      { ats: board.ats, token: board.token },
      { append: { tags: [HARVEST_TAG] }, fallbackName: board.companyName },
    );
    if (result.kind === 'no-adapter' || result.kind === 'no-key' || result.kind === 'cached') {
      continue;
    }
    stats.probed += 1;
    if (result.kind === 'error') stats.errors += 1;
    if (result.kind === 'hit' && result.added) {
      stats.added += 1;
      added.push({
        ats: board.ats,
        token: board.token,
        name: result.name,
        postings: result.postings,
      });
    }
    sinceSave += 1;
    if (sinceSave >= 25) {
      input.save?.();
      sinceSave = 0;
    }
  }
  input.save?.();
  return { stats, added };
}

/** `harvest: 34 linked, 30 known, 4 probed, 1 added, 0 waiting, 2 unreadable (workable 1, workday 1)` */
export function formatHarvest(stats: HarvestStats): string {
  const unreadable = Object.entries(stats.unreadable_by_ats)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([ats, n]) => `${ats} ${n}`)
    .join(', ');
  return `${stats.linked} board links (${stats.known} listed or known), ${stats.probed} probed, ${stats.added} added, ${stats.waiting} waiting, ${stats.errors} errors, ${stats.unreadable} unreadable${unreadable ? ` (${unreadable})` : ''}`;
}
