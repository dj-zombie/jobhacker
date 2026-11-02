import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { eventsRepo } from '../db/repo/events.js';
import { runsRepo } from '../db/repo/runs.js';
import { type EventRow, JOB_STATUSES, type JobStatus, jobs } from '../db/schema.js';
import type { Clock } from '../util/clock.js';
import type { ScoreStats } from './score.js';
import type { ScoutStats } from './scout.js';

/**
 * Review-UI support (FR-6, FR-10). The UI's server actions call these; they
 * never touch the browser or the network. Queue and detail reads live in
 * `scoresRepo`; this module owns the triage state change (with its audit event)
 * and shapes the last-scout-run header.
 */

/** A triage action the human takes in the queue. */
export type TriageAction = 'shortlist' | 'skip' | 'archive';
/** The job status each action moves a job to. */
export type TriageStatus = 'shortlisted' | 'skipped' | 'archived';

export const TRIAGE_ACTIONS = ['shortlist', 'skip', 'archive'] as const;

const ACTION_TO_STATUS: Record<TriageAction, TriageStatus> = {
  shortlist: 'shortlisted',
  skip: 'skipped',
  archive: 'archived',
};

/** Thrown when a triage request names an unknown action or a missing job. */
export class ReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewError';
  }
}

export interface TriageResult {
  jobId: number;
  action: TriageAction;
  from: JobStatus;
  to: TriageStatus;
}

/**
 * Apply a triage action to a job: set its status and append a `triage` event,
 * atomically. Re-triaging is allowed (e.g. shortlist → skip); the event records
 * the `from`/`to` so the audit log is complete. Throws `ReviewError` for an
 * unknown action or a job id that does not exist.
 */
export function triageJob(
  db: Db,
  clock: Clock,
  input: { jobId: number; action: TriageAction },
): TriageResult {
  const to = ACTION_TO_STATUS[input.action];
  if (!to) throw new ReviewError(`unknown triage action "${input.action}"`);

  // Wrap in a better-sqlite3 transaction so the status change and its audit
  // event commit together (or roll back together). Statements issued through
  // `db` share this connection, so they are part of the transaction.
  const tx = db.$client.transaction((): TriageResult => {
    const row = db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, input.jobId)).get();
    if (!row) throw new ReviewError(`job ${input.jobId} not found`);

    db.update(jobs).set({ status: to }).where(eq(jobs.id, input.jobId)).run();
    eventsRepo(db, clock).append({
      type: 'triage',
      jobId: input.jobId,
      payload: { action: input.action, from: row.status, to },
    });
    return { jobId: input.jobId, action: input.action, from: row.status, to };
  });
  return tx();
}

export interface UndoResult {
  jobId: number;
  /** The action that was undone. */
  undid: TriageAction;
  from: JobStatus;
  to: JobStatus;
}

/**
 * Undo the job's latest triage action that isn't undone yet: restore the status it moved the job
 * from, and append a `triage` event with `action: 'undo'`. Each earlier undo cancels the action
 * before it, so undoing twice walks back two actions. Throws `ReviewError` when there's nothing
 * to undo, or when the job's status has moved on since that action.
 */
export function undoTriage(db: Db, clock: Clock, input: { jobId: number }): UndoResult {
  const tx = db.$client.transaction((): UndoResult => {
    const row = db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, input.jobId)).get();
    if (!row) throw new ReviewError(`job ${input.jobId} not found`);
    const target = lastUndoable(eventsRepo(db, clock).forJob(input.jobId));
    if (!target) throw new ReviewError(`job ${input.jobId} has no triage action to undo`);
    if (row.status !== target.to) {
      throw new ReviewError(
        `job ${input.jobId} is ${row.status}, not ${target.to}; its last ${target.action} can't be undone`,
      );
    }
    db.update(jobs).set({ status: target.from }).where(eq(jobs.id, input.jobId)).run();
    eventsRepo(db, clock).append({
      type: 'triage',
      jobId: input.jobId,
      payload: { action: 'undo', undid: target.action, from: row.status, to: target.from },
    });
    return { jobId: input.jobId, undid: target.action, from: row.status, to: target.from };
  });
  return tx();
}

interface TriagePayload {
  action: TriageAction;
  from: JobStatus;
  to: TriageStatus;
}

function triagePayload(payload: unknown): TriagePayload | 'undo' | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (p.action === 'undo') return 'undo';
  const action = TRIAGE_ACTIONS.find((a) => a === p.action);
  const from = JOB_STATUSES.find((s) => s === p.from);
  if (!action || !from || p.to !== ACTION_TO_STATUS[action]) return null;
  return { action, from, to: ACTION_TO_STATUS[action] };
}

/** Newest-first events in, the latest triage action that no later undo has cancelled out. */
function lastUndoable(events: readonly EventRow[]): TriagePayload | null {
  let undos = 0;
  for (const event of events) {
    if (event.type !== 'triage') continue;
    const payload = triagePayload(event.payload);
    if (payload === null) continue;
    if (payload === 'undo') {
      undos += 1;
      continue;
    }
    if (undos > 0) {
      undos -= 1;
      continue;
    }
    return payload;
  }
  return null;
}

/** Shaped summary of the most recent scout run, for the UI header (FR-10). */
export interface ScoutHeader {
  present: boolean;
  runId?: number;
  startedAt?: string;
  finishedAt?: string | null;
  /** True while a run has started but not finished. */
  running?: boolean;
  ok?: boolean | null;
  error?: string | null;
  boardsOk?: number;
  boardsFailed?: number;
  seen?: number;
  inserted?: number;
  updated?: number;
  closed?: number;
  /** Open, non-duplicate jobs excluded by the blocklist or age gate (v1 runs: the keyword filter). */
  gated?: number;
  scored?: number;
  errors?: number;
  /** Search calls skipped because the monthly budget was already spent (FR-16). */
  searchSkippedBudget?: number;
}

/** Scout runs written before Phase 2 stored a single `filtered` count instead of `gates`. */
type StoredScoutStats = Partial<ScoutStats> & { filtered?: number };

/** Read the latest scout run and shape it for the header. */
export function scoutHeader(db: Db, clock: Clock): ScoutHeader {
  const run = runsRepo(db, clock).latest('scout');
  if (!run) return { present: false };

  // `stats` is our own JSON, written by scout (current or pre-Phase-2 shape).
  const stats = (run.stats ?? null) as StoredScoutStats | null;
  const gated = stats?.gates
    ? stats.gates.gated.blocklist + stats.gates.gated.age
    : stats?.filtered;
  const scoring = stats?.scoring;
  const scored = scoring && scoring !== 'skipped' ? (scoring as ScoreStats).scored : 0;

  return {
    present: true,
    runId: run.id,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    running: run.finishedAt == null,
    ok: run.ok,
    error: run.error,
    boardsOk: stats?.boards_ok,
    boardsFailed: stats?.boards_failed,
    seen: stats?.seen,
    inserted: stats?.inserted,
    updated: stats?.updated,
    closed: stats?.closed,
    gated,
    scored,
    errors: stats?.errors?.length,
    searchSkippedBudget: stats?.search_skipped_budget,
  };
}
