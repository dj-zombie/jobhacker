/**
 * Record one live JSearch search response and one job-details response as
 * test fixtures (J29), each call charged through `budget.ts` first. Both are
 * trimmed to 3 jobs; the echoed request parameters and request id are dropped.
 *
 *   pnpm tsx scripts/record-jsearch.ts "<query>"
 *
 * Two calls against the JSearch monthly budget. Never retried.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadAllConfig } from '../src/core/config/load.js';
import { LEGACY_SOURCES } from '../src/core/config/schemas.js';
import { createDb } from '../src/core/db/client.js';
import { isAggregatorUrl } from '../src/core/sources/aggregators.js';
import { formAtsOf } from '../src/core/sources/apply-options.js';
import { callsThisMonth, chargeCall } from '../src/core/sources/budget.js';
import { JSEARCH_TIMEOUT_MS, jsearchDetailsUrl, jsearchUrl } from '../src/core/sources/jsearch.js';
import { systemClock } from '../src/core/util/clock.js';
import { loadEnv } from '../src/core/util/env.js';
import { createHttp } from '../src/core/util/http.js';

const FIXTURES = join(process.cwd(), 'tests/fixtures');

type Job = { job_id?: unknown; apply_options?: unknown };
type Body = { data?: unknown };

function links(job: Job): string[] {
  if (!Array.isArray(job.apply_options)) return [];
  return job.apply_options.flatMap((o) =>
    o && typeof o === 'object' && 'apply_link' in o && typeof o.apply_link === 'string'
      ? [o.apply_link]
      : [],
  );
}

/** Three jobs that show the ranking: one with an ATS link, one with only job boards, then any. */
function pickThree(jobs: Job[]): Job[] {
  const withAts = jobs.find((j) => links(j).some((l) => formAtsOf(l) !== null));
  const allBoards = jobs.find(
    (j) => j !== withAts && links(j).length > 0 && links(j).every((l) => isAggregatorUrl(l)),
  );
  const picked = [withAts, allBoards].filter((j): j is Job => j !== undefined);
  for (const job of jobs) {
    if (picked.length >= 3) break;
    if (!picked.includes(job)) picked.push(job);
  }
  return picked;
}

function strip(body: Body, data: unknown): Record<string, unknown> {
  const { parameters: _p, request_id: _r, ...rest } = body as Record<string, unknown>;
  return { ...rest, data };
}

async function main(): Promise<void> {
  loadEnv();
  const query = process.argv[2];
  if (!query) throw new Error('usage: record-jsearch.ts "<query>"');
  const key = process.env.JSEARCH_API_KEY;
  if (!key) throw new Error('JSEARCH_API_KEY is not set');
  const config = loadAllConfig();
  const budget = (config.criteria.sources ?? LEGACY_SOURCES).search.jsearch.monthly_call_budget;
  const { db, sqlite } = createDb();
  const http = createHttp();
  const request = { headers: { 'x-api-key': key }, maxTries: 1, timeoutMs: JSEARCH_TIMEOUT_MS };
  try {
    const before = callsThisMonth(db, 'jsearch', systemClock.now());
    if (!chargeCall(db, 'jsearch', systemClock.now(), budget, 0)) {
      throw new Error(`JSearch is at its monthly budget (${before}/${budget})`);
    }
    const search = (await http.getJson(jsearchUrl(query, 1), request)) as Body;
    const jobs = Array.isArray(search.data) ? (search.data as Job[]) : [];
    const three = pickThree(jobs);
    writeFileSync(
      join(FIXTURES, 'jsearch-search.json'),
      `${JSON.stringify(strip(search, three), null, 2)}\n`,
    );

    const first = three.find((j) => typeof j.job_id === 'string');
    if (!first || typeof first.job_id !== 'string') throw new Error('no job id to look up');
    if (!chargeCall(db, 'jsearch', systemClock.now(), budget, 0)) {
      throw new Error('JSearch reached its monthly budget before the details call');
    }
    const details = (await http.getJson(jsearchDetailsUrl(first.job_id), request)) as Body;
    const detailJobs = Array.isArray(details.data) ? details.data.slice(0, 3) : [];
    writeFileSync(
      join(FIXTURES, 'jsearch-details.json'),
      `${JSON.stringify(strip(details, detailJobs), null, 2)}\n`,
    );

    const after = callsThisMonth(db, 'jsearch', systemClock.now());
    console.log(`search: ${jobs.length} jobs back, kept ${three.length}`);
    for (const job of three) console.log(`  options: ${links(job).length}`);
    console.log(`details: ${Array.isArray(details.data) ? details.data.length : 0} jobs back`);
    console.log(`jsearch calls this month: ${before} → ${after} of ${budget}`);
  } finally {
    sqlite.close();
  }
}

await main();
