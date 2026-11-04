import { and, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { BOARD_ATS, type Criteria, LEGACY_SOURCES, SEARCH_ATS } from '../config/schemas.js';
import type { Db } from '../db/client.js';
import { ABANDONED_AFTER_MS, runsRepo } from '../db/repo/runs.js';
import { companies, jobs, runs } from '../db/schema.js';
import { monthlyUsage } from '../llm/usage.js';
import { callsThisMonth, creditsThisMonth } from '../sources/budget.js';
import { atsLabel } from '../sources/detect.js';
import {
  GONE_STATUS,
  type Relocation,
  httpStatus,
  lookedLine,
  relocationsFromStats,
} from '../sources/relocate.js';
import type { Clock } from '../util/clock.js';
import { scoutHeader } from './review.js';
import { type ScoutProgress, parseScoutProgress } from './scout-progress.js';
import { activeBoards } from './stats.js';

/**
 * What the sidebar's scout card shows (J4). The scheduled scout runs unattended, so the card is
 * where Kris notices trouble: `failed` when the last run failed or never finished, `attention`
 * when it had errors or a search source is at its monthly budget.
 * Read-only.
 */

export type ScoutStatus = 'ok' | 'attention' | 'failed';

/** A board the card can stop scouting. Jobs already stored stay. */
export interface ScoutBoardRef {
  ats: string;
  token: string;
  name: string;
}

export interface ScoutNotice {
  /** What failed, and what to do. */
  text: string;
  /** Set when the fix is to stop scouting this board. */
  retire?: ScoutBoardRef;
  /**
   * Set when the board is gone (400, 404, 410, 422): where it may have moved (J15). `looked` is
   * null when the run has no relocation for it (a run from before J15). The card still takes a
   * pasted link.
   */
  relocate?: {
    looked: string | null;
    candidates: Array<{ ats: string; token: string; name: string; postings: number }>;
  };
}

export interface ScoutCardData {
  status: ScoutStatus;
  /** One entry per problem. A `retire` entry can be turned off from the card. */
  notices: ScoutNotice[];
  lastRun: { startedAt: string; finishedAt: string | null } | null;
  running: boolean;
  /**
   * While running: boards done of total and jobs found, from the run's own progress when it has
   * written one, otherwise counted from postings seen since the run started.
   */
  progress: ScoutProgress | null;
  boards: number;
  newLastRun: number;
  modelCalls: number;
}

export { ABANDONED_AFTER_MS };

/**
 * A finished scout this many days old, or none at all, means the listings are stale.
 * Lives here, next to `scoutStaleBanner`. The banner component only receives the words.
 */
export const SCOUT_STALE_DAYS = 7;

export interface ScoutStaleBanner {
  /** When the last finished scout ended, or null when none has finished. */
  checkedAt: string | null;
}

/**
 * The latest scout run that has a `finished_at`. A run still going does not count.
 * A banner when that finish is `SCOUT_STALE_DAYS` or more before now, or when
 * no scout has finished. Otherwise nothing.
 */
export function scoutStaleBanner(db: Db, clock: Clock): ScoutStaleBanner | null {
  const finished = db
    .select({ finishedAt: runs.finishedAt })
    .from(runs)
    .where(and(eq(runs.kind, 'scout'), isNotNull(runs.finishedAt)))
    .orderBy(desc(runs.finishedAt), desc(runs.id))
    .get();
  if (!finished?.finishedAt) return { checkedAt: null };
  const age = clock.nowMs() - Date.parse(finished.finishedAt);
  if (age >= SCOUT_STALE_DAYS * 86_400_000) return { checkedAt: finished.finishedAt };
  return null;
}

/** The banner's date, e.g. "26 Oct 2026". */
export function scoutCheckedWords(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export const SOURCE_LABEL: Record<(typeof SEARCH_ATS)[number], string> = {
  jsearch: 'JSearch',
  jobspipe: 'JobsPipe',
  hn: 'Hacker News',
};

const runErrorsSchema = z.object({
  errors: z.array(
    z.object({
      company: z.string().optional(),
      ats: z.string().optional(),
      token: z.string().optional(),
      message: z.string().optional(),
    }),
  ),
});

type RunError = z.infer<typeof runErrorsSchema>['errors'][number];

function note(text: string, retire?: ScoutBoardRef): ScoutNotice {
  return retire ? { text, retire } : { text };
}

function shorten(text: string, max = 90): string {
  const line = text.split('\n')[0] ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function sourceLabel(name: string): string {
  return (SOURCE_LABEL as Record<string, string>)[name] ?? name;
}

function withoutUrls(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.:;])/g, '$1')
    .trim();
}

function detail(message: string): string {
  const clean = shorten(withoutUrls(message), 80).replace(/[.\s]+$/g, '');
  return clean || 'the request failed';
}

function boardName(error: RunError): string {
  const name = error.company?.trim();
  if (name) return name;
  return error.token?.trim() || 'A board';
}

function boardNotice(error: RunError, relocations: readonly Relocation[]): ScoutNotice | null {
  const ats = error.ats?.trim();
  const token = error.token?.trim();
  if (!ats || !token || token === 'search') return null;
  const name = boardName(error);
  const board = `${atsLabel(ats)} board`;
  const message = error.message?.trim() ?? '';
  const status = httpStatus(message);
  const retire = { ats, token, name };

  if (status != null && GONE_STATUS.has(status)) {
    const found = relocations.find((r) => r.ats === ats && r.token === token);
    return {
      text: `${name}: the ${board} returned ${status}. The listing page is gone.`,
      retire,
      relocate: {
        looked: found ? lookedLine(found) : null,
        candidates: (found?.candidates ?? []).map((c) => ({
          ats: c.ats,
          token: c.token,
          name: c.name,
          postings: c.postings,
        })),
      },
    };
  }
  if (status === 401 || status === 403) {
    return note(
      `${name}: the ${board} refused the request (${status}). It may no longer be public.`,
      retire,
    );
  }
  if (status === 429) {
    return note(`${name}: the ${board} asked us to slow down (429). Run scout again later.`);
  }
  if (status != null && status >= 500) {
    return note(`${name}: the ${board}'s server failed (${status}). Run scout again.`);
  }
  if (/none could be parsed/i.test(message)) {
    return note(
      `${name}: the ${board} answered, but none of its postings could be read. Run scout again.`,
    );
  }
  if (/invalid JSON/i.test(message)) {
    return note(`${name}: the ${board} sent a response that could not be read. Run scout again.`);
  }
  if (
    /network error|timed out|timeout|aborted|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed/i.test(
      message,
    )
  ) {
    return note(`${name}: the ${board} did not respond. Run scout again.`);
  }
  if (!message) return note(`${name}: the ${board} failed in the last run. Run scout again.`);
  return note(`${name}: the ${board} failed (${detail(message)}). Run scout again.`);
}

function searchNotice(ats: string, message: string): ScoutNotice {
  const name = sourceLabel(ats);
  if (/API_KEY is not set/i.test(message)) {
    return note(`${name} failed: the API key is not set. Add it and run scout again.`);
  }
  if (/not read to the end/i.test(message)) {
    return note(
      `${name} failed: the listing was not read to the end, so nothing was closed. Run scout again.`,
    );
  }
  const status = httpStatus(message);
  if (status === 429) {
    return note(`${name} failed: the source asked us to slow down (429). Run scout again later.`);
  }
  if (status != null && status >= 500) {
    return note(`${name} failed: the server returned ${status}. Run scout again.`);
  }
  if (status === 402) {
    return note(
      "JobsPipe is out of credits (402). Its free credits don't refill. Buying a package is your call.",
    );
  }
  if (status === 401 || status === 403) {
    return note(`${name} failed: the request was refused (${status}). Check the API key.`);
  }
  if (!message) return note(`${name} failed in the last run. Run scout again.`);
  return note(`${name} failed: ${detail(message)}. Run scout again.`);
}

/**
 * One notice per failed board, then one per failed search source.
 * A board already marked inactive is omitted: turning it off is the fix, and the
 * card should clear without waiting for the next scout.
 */
export function failureNotices(
  errors: readonly RunError[],
  inactive: ReadonlySet<string>,
  relocations: readonly Relocation[] = [],
): ScoutNotice[] {
  const boards: ScoutNotice[] = [];
  const searches: ScoutNotice[] = [];
  const seenBoards = new Set<string>();
  const seenSearch = new Set<string>();
  for (const error of errors) {
    if (error.token === 'search') {
      const ats = error.ats ?? 'search';
      if (seenSearch.has(ats)) continue;
      seenSearch.add(ats);
      searches.push(searchNotice(ats, error.message?.trim() ?? ''));
      continue;
    }
    const key = `${error.ats ?? ''}:${error.token ?? ''}`;
    if (inactive.has(key) || seenBoards.has(key)) continue;
    const notice = boardNotice(error, relocations);
    if (!notice) continue;
    seenBoards.add(key);
    boards.push(notice);
  }
  return [...boards, ...searches];
}

function inactiveBoardKeys(db: Db): Set<string> {
  const rows = db
    .select({ ats: companies.ats, token: companies.token })
    .from(companies)
    .where(eq(companies.active, false))
    .all();
  return new Set(rows.map((row) => `${row.ats}:${row.token}`));
}

export function scoutCard(db: Db, clock: Clock, criteria: Criteria): ScoutCardData {
  const header = scoutHeader(db, clock);
  const run = runsRepo(db, clock).latest('scout');
  const nowMs = clock.nowMs();
  const notices: ScoutNotice[] = [];
  let failed = false;

  const startedAt = header.startedAt ?? null;
  const unfinished = header.present && header.running === true && startedAt !== null;
  const running = unfinished && nowMs - Date.parse(startedAt) < ABANDONED_AFTER_MS;

  if (unfinished && !running) {
    failed = true;
    notices.push(note('The last scout never finished'));
  } else if (header.present && !running && header.ok === false) {
    failed = true;
    notices.push(
      note(
        header.error ? `The last scout failed: ${shorten(header.error)}` : 'The last scout failed',
      ),
    );
  }

  if (!running) {
    const parsed = runErrorsSchema.safeParse(run?.stats ?? {});
    const errors = parsed.success ? parsed.data.errors : [];
    notices.push(
      ...failureNotices(errors, inactiveBoardKeys(db), relocationsFromStats(run?.stats)),
    );
  }

  const search = (criteria.sources ?? LEGACY_SOURCES).search;
  const now = clock.now();
  for (const name of SEARCH_ATS) {
    const source = search[name];
    if (source.enabled && source.monthly_call_budget > 0) {
      if (callsThisMonth(db, name, now) >= source.monthly_call_budget) {
        notices.push(note(`${sourceLabel(name)} is at its monthly budget`));
      }
    }
    if (
      name === 'jobspipe' &&
      search.jobspipe.enabled &&
      search.jobspipe.monthly_credit_budget > 0 &&
      creditsThisMonth(db, name, now) >= search.jobspipe.monthly_credit_budget
    ) {
      notices.push(note(`${sourceLabel(name)} is at its monthly credit budget`));
    }
  }

  const usage = monthlyUsage(db, clock);

  return {
    status: failed ? 'failed' : notices.length > 0 ? 'attention' : 'ok',
    notices,
    lastRun: startedAt ? { startedAt, finishedAt: header.finishedAt ?? null } : null,
    running,
    progress:
      running && startedAt
        ? (parseScoutProgress(run?.stats) ??
          fallbackProgress(progressSince(db, startedAt), activeBoards(db).active))
        : null,
    boards: activeBoards(db).active,
    newLastRun: header.inserted ?? 0,
    modelCalls: usage.calls,
  };
}

function fallbackProgress(
  seen: { boardsSeen: number; found: number },
  boards: number,
): ScoutProgress {
  return {
    done: Math.min(seen.boardsSeen, boards),
    total: boards,
    found: seen.found,
    unit: 'Board',
  };
}

function progressSince(db: Db, sinceIso: string): { boardsSeen: number; found: number } {
  const boardsSeen =
    db
      .select({ n: sql<number>`count(distinct ${jobs.companyId})` })
      .from(jobs)
      .innerJoin(companies, sql`${companies.id} = ${jobs.companyId}`)
      .where(and(gte(jobs.lastSeenAt, sinceIso), inArray(companies.ats, [...BOARD_ATS])))
      .get()?.n ?? 0;
  const found =
    db.select({ n: sql<number>`count(*)` }).from(jobs).where(gte(jobs.firstSeenAt, sinceIso)).get()
      ?.n ?? 0;
  return { boardsSeen, found };
}
