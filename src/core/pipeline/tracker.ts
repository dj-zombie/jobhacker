import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  type ApplicationListRow,
  type ApplicationStatus,
  CLOSED_APPLICATION_STATUSES,
  applicationsRepo,
} from '../db/repo/applications.js';
import { eventsRepo } from '../db/repo/events.js';
import { type EventRow, applications } from '../db/schema.js';
import type { Clock } from '../util/clock.js';
import { sha256 } from '../util/hash.js';

/**
 * Application tracker (FR-9, ARCHITECTURE § Data model). It owns the application
 * status transitions, follow-up date, notes, the event timeline, and CSV export.
 * DB-only: no browser, no network, no LLM. The queue/triage of *jobs* lives in
 * `review.ts`; this module is about the *application* lifecycle after shortlist.
 */

/** Valid application statuses (mirrors the `applications.status` enum). */
export const APPLICATION_STATUSES = [
  'prepped',
  'submitted',
  'interviewing',
  'offer',
  'rejected',
  'withdrawn',
  'ghosted',
] as const;

/** Thrown for an unknown status or a missing application. */
export class TrackerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrackerError';
  }
}

/** Days after submission for the default follow-up date (matches apply.FOLLOW_UP_DAYS). */
export const FOLLOW_UP_DAYS = 7;

function isApplicationStatus(value: string): value is ApplicationStatus {
  return (APPLICATION_STATUSES as readonly string[]).includes(value);
}

export interface StatusChangeResult {
  jobId: number;
  applicationId: number;
  from: ApplicationStatus;
  to: ApplicationStatus;
  submittedAt: string | null;
  followUpAt: string | null;
}

/**
 * Move an application to a new status and append a `status` audit event. When a
 * status first becomes `submitted` and no submission time is set yet, this also
 * stamps `submitted_at=now` and a default `follow_up_at=now+7d` (same seed as
 * "Mark submitted"). Moving back to `prepped` clears `submitted_at` and keeps
 * the follow-up. Throws `TrackerError` for an unknown status or a job with no
 * application.
 */
export function changeApplicationStatus(
  db: Db,
  clock: Clock,
  input: { jobId: number; status: string; note?: string },
): StatusChangeResult {
  if (!isApplicationStatus(input.status)) {
    throw new TrackerError(`unknown application status "${input.status}"`);
  }
  const apps = applicationsRepo(db, clock);

  const tx = db.$client.transaction((): StatusChangeResult => {
    const existing = apps.findByJob(input.jobId);
    if (!existing) {
      throw new TrackerError(`no application for job ${input.jobId}; run \`prep\` first`);
    }
    const from = existing.status;
    const to = input.status as ApplicationStatus;

    let submittedAt = existing.submittedAt;
    let followUpAt = existing.followUpAt;
    if (to === 'submitted' && submittedAt == null) {
      submittedAt = clock.now();
      // A date Kris already set stays. The seven-day seed is only for a blank follow-up.
      if (followUpAt == null) {
        followUpAt = new Date(clock.nowMs() + FOLLOW_UP_DAYS * 86_400_000).toISOString();
      }
    }
    // Prepped means not submitted, so Mark submitted and the stats see it that way.
    if (to === 'prepped') submittedAt = null;

    apps.upsertForJob({ jobId: input.jobId, status: to, submittedAt, followUpAt });
    eventsRepo(db, clock).append({
      type: 'status',
      jobId: input.jobId,
      applicationId: existing.id,
      payload: { from, to, ...(input.note ? { note: input.note } : {}) },
    });
    return { jobId: input.jobId, applicationId: existing.id, from, to, submittedAt, followUpAt };
  });
  return tx();
}

/**
 * Set (or clear, with `null`) the follow-up date and append a `follow_up` event.
 */
/**
 * A workspace date field (`yyyy-mm-dd`) becomes 9 AM that day in local time.
 * Returns null when the text isn't that shape.
 */
export function localDateToFollowUp(date: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 9, 0, 0);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

export function setFollowUp(
  db: Db,
  clock: Clock,
  input: { jobId: number; followUpAt: string | null },
): void {
  const apps = applicationsRepo(db, clock);
  const existing = apps.findByJob(input.jobId);
  if (!existing) throw new TrackerError(`no application for job ${input.jobId}`);
  apps.upsertForJob({ jobId: input.jobId, followUpAt: input.followUpAt });
  eventsRepo(db, clock).append({
    type: 'follow_up',
    jobId: input.jobId,
    applicationId: existing.id,
    payload: { follow_up_at: input.followUpAt },
  });
}

/**
 * Update the free-text notes on an application and append a `note` event so the
 * change shows in the activity. The event carries the length only; the text
 * stays in `applications.notes`.
 */
export function setNotes(
  db: Db,
  clock: Clock,
  input: { jobId: number; notes: string | null },
): void {
  const apps = applicationsRepo(db, clock);
  const existing = apps.findByJob(input.jobId);
  if (!existing) throw new TrackerError(`no application for job ${input.jobId}`);
  const notes = input.notes && input.notes.trim().length > 0 ? input.notes : null;
  db.update(applications)
    .set({ notes, updatedAt: clock.now() })
    .where(eq(applications.id, existing.id))
    .run();
  eventsRepo(db, clock).append({
    type: 'note',
    jobId: input.jobId,
    applicationId: existing.id,
    payload: { chars: notes?.length ?? 0 },
  });
}

// ---------------------------------------------------------------------------
// Drafted-answer approvals
// ---------------------------------------------------------------------------

/** Fingerprint of an answer's text, so an approval lapses when the text changes. */
export function answerFingerprint(value: string): string {
  return sha256(value.trim());
}

/**
 * Record that Kris approved (or edited) the answer to one form question on this
 * application. It holds for this application only (invariant 3): nothing is
 * written to the profile. Stored as an `answer_approved` event with the
 * question and a fingerprint of the approved text, never the text itself.
 */
export function approveAnswer(
  db: Db,
  clock: Clock,
  input: { jobId: number; question: string; value: string; edited?: boolean },
): void {
  const existing = applicationsRepo(db, clock).findByJob(input.jobId);
  if (!existing) throw new TrackerError(`no application for job ${input.jobId}`);
  eventsRepo(db, clock).append({
    type: 'answer_approved',
    jobId: input.jobId,
    applicationId: existing.id,
    payload: {
      question: input.question,
      value_hash: answerFingerprint(input.value),
      ...(input.edited ? { edited: true } : {}),
    },
  });
}

function payloadString(payload: unknown, key: string): string | undefined {
  if (typeof payload !== 'object' || payload === null || !(key in payload)) return undefined;
  const value: unknown = Reflect.get(payload, key);
  return typeof value === 'string' ? value : undefined;
}

/** question → fingerprint of the latest approved text, for one application. */
export function answerApprovals(db: Db, clock: Clock, applicationId: number): Map<string, string> {
  const approvals = new Map<string, string>();
  // Newest first: the first approval seen for a question is the one that counts.
  for (const event of eventsRepo(db, clock).ofType('answer_approved', applicationId)) {
    const question = payloadString(event.payload, 'question');
    const hash = payloadString(event.payload, 'value_hash');
    if (question !== undefined && hash !== undefined && !approvals.has(question)) {
      approvals.set(question, hash);
    }
  }
  return approvals;
}

/** True when `value` is the text Kris approved for `question`. */
export function isApproved(
  approvals: ReadonlyMap<string, string>,
  question: string,
  value: string,
): boolean {
  return approvals.get(question) === answerFingerprint(value);
}

// ---------------------------------------------------------------------------
// The pipeline lists: in progress, submitted, follow-ups due
// ---------------------------------------------------------------------------

export type ApplicationList = 'in-progress' | 'submitted' | 'follow-ups';

/**
 * The end of the local day `clock` is in, as an ISO instant. A follow-up dated
 * any time today is due today.
 */
export function followUpCutoff(clock: Clock): string {
  const end = new Date(clock.nowMs());
  end.setHours(23, 59, 59, 999);
  return end.toISOString();
}

/**
 * Which list an application belongs in. In progress is everything still
 * prepped. Submitted is everything at or past submitted, whatever the status
 * (interviewing, offer, rejected, withdrawn, ghosted). A follow-up is due when
 * a submitted, still-open application's follow-up date is on or before `cutoff`.
 */
export function inApplicationList(
  row: { status: ApplicationStatus; followUpAt: string | null },
  list: ApplicationList,
  cutoff: string,
): boolean {
  if (list === 'in-progress') return row.status === 'prepped';
  if (row.status === 'prepped') return false;
  if (list === 'submitted') return true;
  return (
    row.followUpAt !== null &&
    row.followUpAt <= cutoff &&
    !CLOSED_APPLICATION_STATUSES.includes(row.status)
  );
}

/** All applications (joined with job + company), newest-updated first. */
export function listApplications(db: Db, clock: Clock): ApplicationListRow[] {
  return applicationsRepo(db, clock).listWithJob();
}

/** Submitted, still-open applications whose follow-up is due today or earlier. Soonest first. */
export function followUpsDue(db: Db, clock: Clock): ApplicationListRow[] {
  const cutoff = followUpCutoff(clock);
  return applicationsRepo(db, clock)
    .dueFollowUps(cutoff)
    .filter((row) => inApplicationList(row, 'follow-ups', cutoff));
}

/** The full event timeline for a job's application (prep, fill, status, …). */
export function applicationTimeline(
  db: Db,
  clock: Clock,
  input: { jobId: number; applicationId: number },
): EventRow[] {
  return eventsRepo(db, clock).timeline(input.jobId, input.applicationId);
}

// ---------------------------------------------------------------------------
// CSV export (FR-9) — pure
// ---------------------------------------------------------------------------

const CSV_HEADER = [
  'application_id',
  'job_id',
  'company',
  'title',
  'ats',
  'status',
  'submitted_at',
  'follow_up_at',
  'url',
  'notes',
  'created_at',
  'updated_at',
] as const;

/** RFC-4180 field escaping: quote when the value contains `,` `"` or a newline. */
export function csvField(value: string | null | undefined): string {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Serialize application rows to a CSV string (CRLF line endings, with a header). */
export function applicationsToCsv(rows: ApplicationListRow[]): string {
  const lines = [CSV_HEADER.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.applicationId,
        r.jobId,
        r.company,
        r.title,
        r.ats,
        r.status,
        r.submittedAt,
        r.followUpAt,
        r.url,
        r.notes,
        r.createdAt,
        r.updatedAt,
      ]
        .map((v) => csvField(v == null ? '' : String(v)))
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}
