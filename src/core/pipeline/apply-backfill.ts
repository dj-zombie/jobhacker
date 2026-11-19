import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { applications, companies, jobs } from '../db/schema.js';
import { rankApplyOptions } from '../sources/apply-options.js';
import { callsThisMonth, chargeCall } from '../sources/budget.js';
import {
  JSEARCH_TIMEOUT_MS,
  jsearchAdapter,
  jsearchDetailsUrl,
  parseJsearchDetails,
} from '../sources/jsearch.js';
import type { ApplyOption } from '../sources/types.js';
import type { Clock } from '../util/clock.js';
import { urlHost } from '../util/host.js';
import type { Http } from '../util/http.js';
import type { Logger } from '../util/logger.js';

/**
 * `search:apply-options` (J29): fetch JSearch's job details for the search
 * jobs Kris is acting on and stored before apply options were kept, so their
 * apply URL can be re-ranked. One budgeted call per job, never retried. Jobs
 * whose options are already stored are re-ranked against the current
 * job-board list with no call. It changes only `apply_options` and
 * `apply_url`: never the url, title, description, company or status.
 */

export const BACKFILL_DEFAULT_MAX = 20;

export interface BackfillDeps {
  db: Db;
  http: Http;
  clock: Clock;
  log: Logger;
  key: string;
  /** `criteria.sources.search.jsearch.monthly_call_budget`. */
  budget: number;
}

export interface BackfillLine {
  jobId: number;
  title: string;
  before: string | null;
  after: string | null;
  /** Null when the job wasn't found (expired), came back as another job, or the call failed. */
  options: number | null;
  direct: number | null;
  /** `re-ranked`: options were already stored; no call was made. */
  outcome: 'updated' | 're-ranked' | 'not found' | 'other job' | 'error';
  error?: string;
}

export interface BackfillResult {
  selected: number;
  /** Jobs with stored options, re-ranked with no call; `lines` has the ones whose URL changed. */
  reranked: { checked: number; changed: number };
  lines: BackfillLine[];
  /** Set when the budget ran out before every selected job was fetched. */
  stoppedAtBudget: { calls: number; budget: number } | null;
}

interface Candidate {
  id: number;
  externalId: string;
  title: string;
  company: string;
  url: string;
  applyUrl: string | null;
  applyOptions: ApplyOption[] | null;
}

/**
 * Open, non-duplicate JSearch jobs that are shortlisted or have a prepped
 * application, with no stored options (`missing`) or with them (`stored`).
 * Prepped ones first, then by id.
 */
export function backfillCandidates(
  db: Db,
  max: number,
  which: 'missing' | 'stored' = 'missing',
): Candidate[] {
  const prepped = sql<number>`case when ${applications.status} = 'prepped' then 0 else 1 end`;
  return db
    .select({
      id: jobs.id,
      externalId: jobs.externalId,
      title: jobs.title,
      company: companies.name,
      url: jobs.url,
      applyUrl: jobs.applyUrl,
      applyOptions: jobs.applyOptions,
    })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .leftJoin(applications, eq(applications.jobId, jobs.id))
    .where(
      and(
        eq(jobs.ats, 'jsearch'),
        isNull(jobs.closedAt),
        isNull(jobs.duplicateOf),
        which === 'missing' ? isNull(jobs.applyOptions) : isNotNull(jobs.applyOptions),
        sql`(${jobs.status} = 'shortlisted' or ${applications.status} = 'prepped')`,
      ),
    )
    .orderBy(asc(prepped), asc(jobs.id))
    .limit(max)
    .all();
}

export async function backfillApplyOptions(
  deps: BackfillDeps,
  options: { max?: number } = {},
): Promise<BackfillResult> {
  const { db, clock } = deps;
  const lines: BackfillLine[] = [];
  const stored = backfillCandidates(db, Number.MAX_SAFE_INTEGER, 'stored');
  let changed = 0;
  for (const job of stored) {
    const kept = job.applyOptions ?? [];
    const applyUrl = rankApplyOptions(kept, job.url, job.company);
    if (applyUrl === job.applyUrl) continue;
    changed += 1;
    db.update(jobs).set({ applyUrl }).where(eq(jobs.id, job.id)).run();
    lines.push({
      jobId: job.id,
      title: job.title,
      before: hostOf(job.applyUrl ?? job.url),
      after: hostOf(applyUrl),
      options: kept.length,
      direct: kept.filter((o) => o.direct).length,
      outcome: 're-ranked',
    });
  }

  const candidates = backfillCandidates(db, options.max ?? BACKFILL_DEFAULT_MAX);
  let stoppedAtBudget: BackfillResult['stoppedAtBudget'] = null;

  for (const job of candidates) {
    const now = clock.now();
    if (!chargeCall(db, 'jsearch', now, deps.budget, jsearchAdapter.costPerCall)) {
      stoppedAtBudget = { calls: callsThisMonth(db, 'jsearch', now), budget: deps.budget };
      deps.log.warn({ budget: deps.budget }, 'search:apply-options stopped at the JSearch budget');
      break;
    }
    const base = { jobId: job.id, title: job.title, before: hostOf(job.applyUrl ?? job.url) };
    let raw: unknown;
    try {
      raw = await deps.http.getJson(jsearchDetailsUrl(job.externalId), {
        headers: { 'x-api-key': deps.key },
        maxTries: 1,
        timeoutMs: JSEARCH_TIMEOUT_MS,
      });
    } catch (err) {
      lines.push(failure(base, err));
      continue;
    }
    let details: ReturnType<typeof parseJsearchDetails>;
    try {
      details = parseJsearchDetails(raw);
    } catch (err) {
      lines.push(failure(base, err));
      continue;
    }
    const found = details.find((d) => d.jobId === job.externalId);
    if (!found) {
      lines.push({
        ...base,
        after: base.before,
        options: null,
        direct: null,
        outcome: details.length > 0 ? 'other job' : 'not found',
      });
      continue;
    }
    const applyUrl = rankApplyOptions(found.options, job.url, job.company);
    db.update(jobs).set({ applyOptions: found.options, applyUrl }).where(eq(jobs.id, job.id)).run();
    lines.push({
      ...base,
      after: hostOf(applyUrl),
      options: found.options.length,
      direct: found.options.filter((o) => o.direct).length,
      outcome: 'updated',
    });
  }
  return {
    selected: candidates.length,
    reranked: { checked: stored.length, changed },
    lines,
    stoppedAtBudget,
  };
}

function hostOf(url: string): string | null {
  return urlHost(url);
}

function failure(
  base: Pick<BackfillLine, 'jobId' | 'title' | 'before'>,
  err: unknown,
): BackfillLine {
  return {
    ...base,
    after: base.before,
    options: null,
    direct: null,
    outcome: 'error',
    error: err instanceof Error ? err.message : String(err),
  };
}

/** One line per job: id, title, apply host before → after, option count, direct count. */
export function formatBackfill(result: BackfillResult): string {
  const out = [
    `search:apply-options: ${result.selected} jobs to fetch · ${result.reranked.checked} with stored options re-ranked, ${result.reranked.changed} changed`,
  ];
  for (const line of result.lines) {
    const hosts = `${line.before ?? '(none)'} → ${line.after ?? '(none)'}`;
    const tail =
      line.outcome === 'updated'
        ? `${line.options} options · ${line.direct} direct`
        : line.outcome === 're-ranked'
          ? `${line.options} options · ${line.direct} direct · stored, no call`
          : line.outcome === 'not found'
            ? 'not found'
            : line.outcome === 'other job'
              ? 'JSearch sent back a different job; nothing stored'
              : `error: ${line.error ?? 'unknown'}`;
    out.push(`  ${line.jobId}  ${line.title}  ${hosts}  ${tail}`);
  }
  if (result.stoppedAtBudget) {
    out.push(
      `  stopped: JSearch is at its monthly budget (${result.stoppedAtBudget.calls}/${result.stoppedAtBudget.budget} calls)`,
    );
  }
  return out.join('\n');
}
