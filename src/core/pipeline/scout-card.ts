import { and, gte, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { BOARD_ATS, type Criteria, LEGACY_SOURCES, SEARCH_ATS } from '../config/schemas.js';
import type { Db } from '../db/client.js';
import { runsRepo } from '../db/repo/runs.js';
import { companies, jobs } from '../db/schema.js';
import { monthlyUsage } from '../llm/usage.js';
import { callsThisMonth } from '../sources/budget.js';
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

export interface ScoutCardData {
  status: ScoutStatus;
  /** One short line per problem, e.g. "JSearch is at its monthly budget". */
  notices: string[];
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

/** A run with no finish time this long after its start crashed; it is not still running. */
export const ABANDONED_AFTER_MS = 3 * 60 * 60 * 1000;

export const SOURCE_LABEL: Record<(typeof SEARCH_ATS)[number], string> = {
  jsearch: 'JSearch',
  jobspipe: 'JobsPipe',
  hn: 'Hacker News',
};

const runErrorsSchema = z.object({
  errors: z.array(z.object({ ats: z.string().optional(), token: z.string().optional() })),
});

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function shorten(text: string, max = 90): string {
  const line = text.split('\n')[0] ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function sourceLabel(name: string): string {
  return (SOURCE_LABEL as Record<string, string>)[name] ?? name;
}

export function scoutCard(db: Db, clock: Clock, criteria: Criteria): ScoutCardData {
  const header = scoutHeader(db, clock);
  const run = runsRepo(db, clock).latest('scout');
  const nowMs = clock.nowMs();
  const notices: string[] = [];
  let failed = false;

  const startedAt = header.startedAt ?? null;
  const unfinished = header.present && header.running === true && startedAt !== null;
  const running = unfinished && nowMs - Date.parse(startedAt) < ABANDONED_AFTER_MS;

  if (unfinished && !running) {
    failed = true;
    notices.push('The last scout never finished');
  } else if (header.present && !running && header.ok === false) {
    failed = true;
    notices.push(
      header.error ? `The last scout failed: ${shorten(header.error)}` : 'The last scout failed',
    );
  }

  if (!running) {
    const parsed = runErrorsSchema.safeParse(run?.stats ?? {});
    const errors = parsed.success ? parsed.data.errors : [];
    const boardErrors = errors.filter((e) => e.token !== 'search').length;
    if (boardErrors > 0) notices.push(`${plural(boardErrors, 'board')} failed in the last run`);
    const failedSources = [
      ...new Set(errors.filter((e) => e.token === 'search').map((e) => e.ats ?? 'search')),
    ];
    for (const name of failedSources) notices.push(`${sourceLabel(name)} failed in the last run`);
  }

  const search = (criteria.sources ?? LEGACY_SOURCES).search;
  const now = clock.now();
  for (const name of SEARCH_ATS) {
    const source = search[name];
    if (!source.enabled || source.monthly_call_budget <= 0) continue;
    if (callsThisMonth(db, name, now) >= source.monthly_call_budget) {
      notices.push(`${sourceLabel(name)} is at its monthly budget`);
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
