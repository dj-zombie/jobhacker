import { eq } from 'drizzle-orm';
import type { Criteria } from '../config/schemas.js';
import type { Db } from '../db/client.js';
import { type GateName, type GateResult, type JobStatus, companies, jobs } from '../db/schema.js';

/**
 * Hard gates (FR-4 revised, invariant 8). A job is excluded only when it is
 * closed, a duplicate, from a blocklisted company, or older than
 * `max_age_days`. Nothing else is a gate: title, location, seniority,
 * employment type and comp are scored dimensions. Every job's result is stored
 * in `jobs.gate_result` so the funnel and `why` can explain it.
 */

export interface GateableJob {
  closedAt: string | null;
  duplicateOf: number | null;
  companyName: string;
  postedAt: string | null;
}

const DAY_MS = 86_400_000;

const PASSED: GateResult = { passed: true, gate: null, detail: null };

function failed(gate: GateName, detail: string): GateResult {
  return { passed: false, gate, detail };
}

/** Whole days since `postedAt`, or null when the date is missing or unparseable. */
export function ageInDays(postedAt: string | null, nowMs: number): number | null {
  if (!postedAt) return null;
  const posted = Date.parse(postedAt);
  if (Number.isNaN(posted)) return null;
  return Math.floor((nowMs - posted) / DAY_MS);
}

/** Decide one job's gate result. Pure; gates are checked in `GATE_NAMES` order. */
export function gateJob(job: GateableJob, gates: Criteria['gates'], nowMs: number): GateResult {
  if (job.closedAt) return failed('closed', `posting closed ${job.closedAt.slice(0, 10)}`);
  if (job.duplicateOf != null) return failed('duplicate', `duplicate of job ${job.duplicateOf}`);

  const name = job.companyName.trim().toLowerCase();
  if (gates.company_blocklist.some((b) => b.trim().toLowerCase() === name)) {
    return failed('blocklist', `company "${job.companyName}" is blocklisted`);
  }

  if (gates.max_age_days > 0) {
    // Unknown or unparseable dates pass: a missing date is not evidence of age.
    const age = ageInDays(job.postedAt, nowMs);
    if (age != null && age > gates.max_age_days) {
      return failed('age', `posted ${age} days ago (max_age_days ${gates.max_age_days})`);
    }
  }
  return PASSED;
}

/** Statuses the pipeline may change. Human triage states are never touched. */
const AUTOMATED: ReadonlySet<JobStatus> = new Set(['new', 'filtered_out', 'unscored', 'scored']);

export interface GateStats {
  checked: number;
  passed: number;
  /** Current count of jobs excluded by each gate. */
  gated: Record<GateName, number>;
  /** Open, non-duplicate jobs moved to `filtered_out` this pass. */
  newly_gated: number;
  /** `filtered_out` jobs that pass now and went back to `new`. */
  resurfaced: number;
}

function sameResult(a: GateResult | null, b: GateResult): boolean {
  return a != null && a.passed === b.passed && a.gate === b.gate && a.detail === b.detail;
}

/**
 * Gate every job and store the result. For open, non-duplicate jobs in an
 * automated status, a failed gate means `filtered_out` and a passed gate turns
 * `filtered_out` back into `new`, so editing the gates and re-running takes
 * effect without a re-scout. Closed and duplicate jobs only get their result
 * recorded; lists exclude them by `closed_at`/`duplicate_of` already.
 * Idempotent for a fixed criteria and clock.
 */
export function applyGates(db: Db, gates: Criteria['gates'], nowMs: number): GateStats {
  const rows = db
    .select({
      id: jobs.id,
      status: jobs.status,
      closedAt: jobs.closedAt,
      duplicateOf: jobs.duplicateOf,
      postedAt: jobs.postedAt,
      gateResult: jobs.gateResult,
      filterReason: jobs.filterReason,
      prescore: jobs.prescore,
      companyName: companies.name,
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .all();

  const stats: GateStats = {
    checked: rows.length,
    passed: 0,
    gated: { closed: 0, duplicate: 0, blocklist: 0, age: 0 },
    newly_gated: 0,
    resurfaced: 0,
  };

  const tx = db.$client.transaction(() => {
    for (const row of rows) {
      const result = gateJob(row, gates, nowMs);
      if (result.passed) stats.passed += 1;
      else if (result.gate) stats.gated[result.gate] += 1;

      const patch: Partial<typeof jobs.$inferInsert> = {};
      if (!sameResult(row.gateResult ?? null, result)) patch.gateResult = result;
      if (!result.passed && row.prescore !== null) patch.prescore = null;

      const reconcilable =
        row.closedAt == null && row.duplicateOf == null && AUTOMATED.has(row.status);
      if (reconcilable) {
        if (!result.passed && row.status !== 'filtered_out') {
          patch.status = 'filtered_out';
          stats.newly_gated += 1;
        } else if (result.passed && row.status === 'filtered_out') {
          patch.status = 'new';
          stats.resurfaced += 1;
        }
      }
      // `filter_reason` is superseded by `gate_result`; clear stale v1 reasons.
      if (row.filterReason != null) patch.filterReason = null;

      if (Object.keys(patch).length > 0) {
        db.update(jobs).set(patch).where(eq(jobs.id, row.id)).run();
      }
    }
  });
  tx();
  return stats;
}
