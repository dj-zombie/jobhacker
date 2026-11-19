import { and, eq, inArray, sql } from 'drizzle-orm';
import { type Criteria, atsSchema } from '../config/schemas.js';
import type { Db } from '../db/client.js';
import { companiesRepo } from '../db/repo/companies.js';
import { eventsRepo } from '../db/repo/events.js';
import { events, applications, companies, jobs } from '../db/schema.js';
import { estimateUsd } from '../llm/cost.js';
import {
  EMPLOYER_NAME_SYSTEM,
  type EmployerNameOutput,
  employerNameOutputSchema,
  employerNameUserPrompt,
  groundEmployer,
} from '../llm/prompts/employer-name.js';
import { type LlmClient, LlmParseError, type LlmUsage } from '../llm/types.js';
import { isPlaceholderEmployer } from '../sources/placeholder-employers.js';
import { slugify } from '../sources/slug.js';
import type { Clock } from '../util/clock.js';
import { dedupeKey } from '../util/hash.js';
import type { Logger } from '../util/logger.js';
import { assignDuplicates } from './dedupe.js';

/**
 * `search:employers` (J29 fix): search jobs stored under a placeholder
 * employer ("Remote", "Confidential", "Stealth") get their employer from the
 * posting text, one model call each. A grounded name moves the job to that
 * company and re-keys it for dedupe. A posting that names no employer stays
 * under the placeholder, and is not asked again until its text changes.
 */

const MAX_OUTPUT_TOKENS = 300;

export interface EmployerNameDeps {
  db: Db;
  llm: LlmClient;
  clock: Clock;
  log: Logger;
  criteria: Criteria;
  /** Lowers the per-run cap (never raises it above criteria). `0` makes no call. */
  limit?: number;
}

export interface EmployerLine {
  jobId: number;
  title: string;
  listedAs: string;
  /** The stored employer, when one was named. */
  named: string | null;
  outcome: 'named' | 'not named' | 'error';
  reason?: string;
}

export interface EmployerRunResult {
  lines: EmployerLine[];
  /** Asked before with the same posting text and not named. No call. */
  unchanged: number;
  /** Still to ask after this run's cap. */
  waiting: number;
  /** Jobs flagged as duplicates, before and after re-keying. */
  duplicates: { before: number; after: number };
  calls: number;
  input_tokens: number;
  output_tokens: number;
  estimated_usd: number;
}

interface Candidate {
  jobId: number;
  title: string;
  locationRaw: string | null;
  description: string;
  contentHash: string;
  listedAs: string;
  companyAts: string;
}

/** Open or closed, every search job under a placeholder; ones with an application first. */
export function placeholderJobs(db: Db): Candidate[] {
  const rows = db
    .select({
      jobId: jobs.id,
      title: jobs.title,
      locationRaw: jobs.locationRaw,
      description: jobs.descriptionText,
      contentHash: jobs.contentHash,
      listedAs: companies.name,
      companyAts: companies.ats,
      hasApplication: sql<number>`${applications.id} is not null`,
      shortlisted: sql<number>`${jobs.status} = 'shortlisted'`,
    })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .leftJoin(applications, eq(applications.jobId, jobs.id))
    .where(eq(jobs.sourceKind, 'search'))
    .all()
    .filter((row) => isPlaceholderEmployer(row.listedAs));
  rows.sort(
    (a, b) =>
      Number(b.hasApplication) - Number(a.hasApplication) ||
      Number(b.shortlisted) - Number(a.shortlisted) ||
      a.jobId - b.jobId,
  );
  return rows.map(({ hasApplication: _a, shortlisted: _s, ...row }) => row);
}

/** Jobs already asked with this exact posting text, whose posting named no employer. */
function askedBefore(db: Db, candidates: readonly Candidate[]): Set<number> {
  if (candidates.length === 0) return new Set();
  const hashById = new Map(candidates.map((c) => [c.jobId, c.contentHash]));
  const rows = db
    .select({ jobId: events.jobId, payload: events.payload })
    .from(events)
    .where(
      and(
        eq(events.type, 'employer_read'),
        inArray(
          events.jobId,
          candidates.map((c) => c.jobId),
        ),
      ),
    )
    .all();
  const asked = new Set<number>();
  for (const row of rows) {
    const payload = row.payload as { content_hash?: unknown } | null;
    if (row.jobId !== null && payload?.content_hash === hashById.get(row.jobId)) {
      asked.add(row.jobId);
    }
  }
  return asked;
}

function flaggedDuplicates(db: Db): number {
  return (
    db.get<{ n: number }>(sql`select count(*) as n from jobs where duplicate_of is not null`)?.n ??
    0
  );
}

/** Move one job to the named employer's company, keyed for dedupe under the new name. */
function storeEmployer(db: Db, clock: Clock, job: Candidate, name: string): void {
  const repo = companiesRepo(db, clock);
  const ats = atsSchema.parse(job.companyAts);
  const token = slugify(name);
  const company =
    repo.get(ats, token) ?? repo.upsert({ name, ats, token, active: true, tags: ['search'] });
  db.update(jobs)
    .set({
      companyId: company.id,
      dedupeKey: dedupeKey(name, job.title, job.locationRaw ?? ''),
    })
    .where(eq(jobs.id, job.jobId))
    .run();
}

export async function nameEmployers(deps: EmployerNameDeps): Promise<EmployerRunResult> {
  const { db, clock } = deps;
  const all = placeholderJobs(db);
  const asked = askedBefore(db, all);
  const queue = all.filter((job) => !asked.has(job.jobId));
  const cap =
    deps.limit == null
      ? deps.criteria.budget.max_new_scores_per_run
      : Math.min(deps.criteria.budget.max_new_scores_per_run, Math.max(0, deps.limit));
  const due = queue.slice(0, cap);
  const result: EmployerRunResult = {
    lines: [],
    unchanged: asked.size,
    waiting: queue.length - due.length,
    duplicates: { before: flaggedDuplicates(db), after: 0 },
    calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    estimated_usd: 0,
  };
  const events = eventsRepo(db, clock);
  const model = deps.criteria.llm.scoring_model;
  const usage = (jobId: number, spent: LlmUsage, failed: boolean) => {
    result.calls += spent.calls;
    result.input_tokens += spent.inputTokens;
    result.output_tokens += spent.outputTokens;
    result.estimated_usd += estimateUsd({ ...spent, model });
    events.append({
      type: 'llm_usage',
      jobId,
      payload: {
        model,
        prompt: 'employer-name',
        input_tokens: spent.inputTokens,
        output_tokens: spent.outputTokens,
        calls: spent.calls,
        ...(failed ? { failed: true } : {}),
      },
    });
  };

  for (const job of due) {
    const base = { jobId: job.jobId, title: job.title, listedAs: job.listedAs };
    let output: EmployerNameOutput;
    try {
      const reply = await deps.llm.structured({
        model,
        system: EMPLOYER_NAME_SYSTEM,
        user: employerNameUserPrompt(job),
        schema: employerNameOutputSchema,
        maxTokens: MAX_OUTPUT_TOKENS,
        promptName: 'employer-name',
      });
      usage(job.jobId, reply.usage, false);
      output = reply.value;
    } catch (err) {
      if (err instanceof LlmParseError && err.usage) usage(job.jobId, err.usage, true);
      const message = err instanceof Error ? err.message : String(err);
      deps.log.error({ jobId: job.jobId, err: message }, 'employer name failed');
      result.lines.push({ ...base, named: null, outcome: 'error', reason: message });
      continue;
    }
    const grounded = groundEmployer(output, job, isPlaceholderEmployer);
    if (grounded.name === null) {
      events.append({
        type: 'employer_read',
        jobId: job.jobId,
        payload: {
          from: job.listedAs,
          to: null,
          reason: grounded.reason,
          content_hash: job.contentHash,
        },
      });
      result.lines.push({ ...base, named: null, outcome: 'not named', reason: grounded.reason });
      continue;
    }
    storeEmployer(db, clock, job, grounded.name);
    events.append({
      type: 'employer_read',
      jobId: job.jobId,
      payload: {
        from: job.listedAs,
        to: grounded.name,
        quote: grounded.quote,
        content_hash: job.contentHash,
      },
    });
    result.lines.push({ ...base, named: grounded.name, outcome: 'named' });
  }

  if (result.lines.some((line) => line.outcome === 'named')) assignDuplicates(db);
  result.duplicates.after = flaggedDuplicates(db);
  return result;
}

/** One line per job asked, then the totals. */
export function formatEmployerRun(result: EmployerRunResult): string {
  const named = result.lines.filter((l) => l.outcome === 'named').length;
  const out = [
    `search:employers: ${named} named · ${result.lines.length - named} not · ${result.unchanged} asked before · ${result.waiting} waiting`,
  ];
  for (const line of result.lines) {
    const tail =
      line.outcome === 'named'
        ? `"${line.listedAs}" → ${line.named}`
        : `"${line.listedAs}" kept: ${line.reason ?? line.outcome}`;
    out.push(`  ${line.jobId}  ${line.title}  ${tail}`);
  }
  out.push(
    `  duplicates ${result.duplicates.before} → ${result.duplicates.after} · calls ${result.calls} · est $${result.estimated_usd.toFixed(4)}`,
  );
  return out.join('\n');
}
