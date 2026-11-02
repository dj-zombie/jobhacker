import { and, asc, eq, isNotNull, lte, ne, sql } from 'drizzle-orm';
import type { Clock } from '../../util/clock.js';
import type { Db } from '../client.js';
import { type Application, applications, companies, jobs } from '../schema.js';

/** Application status values (mirrors the `applications.status` enum). */
export type ApplicationStatus = Application['status'];

/** Terminal statuses that no longer need a follow-up (excluded from the due view). */
export const CLOSED_APPLICATION_STATUSES: readonly ApplicationStatus[] = [
  'offer',
  'rejected',
  'withdrawn',
  'ghosted',
];

/** An application joined with its job + company, for the tracker list and CSV (FR-9). */
export interface ApplicationListRow {
  applicationId: number;
  jobId: number;
  company: string;
  title: string;
  ats: string;
  url: string;
  status: ApplicationStatus;
  submittedAt: string | null;
  followUpAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields prep and apply write. Any omitted field is left unchanged on an update. */
export interface ApplicationWrite {
  jobId: number;
  status?: ApplicationStatus;
  resumeHtml?: string | null;
  resumePdfPath?: string | null;
  coverNote?: string | null;
  answers?: Record<string, string> | null;
  /** The apply-assist fill report (labels + sources only, never field values). */
  fillReport?: unknown;
  submittedAt?: string | null;
  followUpAt?: string | null;
  notes?: string | null;
}

/** Column selection shared by `listWithJob` and `dueFollowUps`. */
const APPLICATION_LIST_COLUMNS = {
  applicationId: applications.id,
  jobId: applications.jobId,
  company: companies.name,
  title: jobs.title,
  ats: jobs.ats,
  url: jobs.url,
  status: applications.status,
  submittedAt: applications.submittedAt,
  followUpAt: applications.followUpAt,
  notes: applications.notes,
  createdAt: applications.createdAt,
  updatedAt: applications.updatedAt,
} as const;

/**
 * Repository for the `applications` table (ARCHITECTURE § Data model). Round 4
 * persisted prepped materials; Round 6 adds the tracker reads (status list,
 * follow-ups due) and the `notes` write. `jobId` is unique, so there is at most
 * one application per job.
 */
export function applicationsRepo(db: Db, clock: Clock) {
  return {
    findByJob(jobId: number): Application | undefined {
      return db.select().from(applications).where(eq(applications.jobId, jobId)).get();
    },

    get(id: number): Application | undefined {
      return db.select().from(applications).where(eq(applications.id, id)).get();
    },

    /**
     * All applications joined with their job + company, newest-updated first.
     * Backs the tracker list, the "due" view, and CSV export (FR-9).
     */
    listWithJob(): ApplicationListRow[] {
      return db
        .select(APPLICATION_LIST_COLUMNS)
        .from(applications)
        .innerJoin(jobs, eq(applications.jobId, jobs.id))
        .innerJoin(companies, eq(jobs.companyId, companies.id))
        .orderBy(sql`${applications.updatedAt} desc`, sql`${applications.id} desc`)
        .all();
    },

    /**
     * Applications whose follow-up date is on or before `asOf` and that are not
     * in a terminal status — the "Follow-ups due" view (FR-9). Soonest first.
     */
    dueFollowUps(asOf: string): ApplicationListRow[] {
      return db
        .select(APPLICATION_LIST_COLUMNS)
        .from(applications)
        .innerJoin(jobs, eq(applications.jobId, jobs.id))
        .innerJoin(companies, eq(jobs.companyId, companies.id))
        .where(
          and(
            isNotNull(applications.followUpAt),
            lte(applications.followUpAt, asOf),
            ne(applications.status, 'offer'),
            ne(applications.status, 'rejected'),
            ne(applications.status, 'withdrawn'),
            ne(applications.status, 'ghosted'),
          ),
        )
        .orderBy(asc(applications.followUpAt), asc(applications.id))
        .all();
    },

    /**
     * Create the application for a job, or update the supplied fields if it
     * already exists. Returns the stored row. Only fields present in `write`
     * are changed on an update, so a per-section regenerate can touch one field.
     */
    upsertForJob(write: ApplicationWrite): Application {
      const now = clock.now();
      const existing = this.findByJob(write.jobId);

      if (!existing) {
        const row = db
          .insert(applications)
          .values({
            jobId: write.jobId,
            status: write.status ?? 'prepped',
            resumeHtml: write.resumeHtml ?? null,
            resumePdfPath: write.resumePdfPath ?? null,
            coverNote: write.coverNote ?? null,
            answers: write.answers ?? null,
            fillReport: write.fillReport ?? null,
            submittedAt: write.submittedAt ?? null,
            followUpAt: write.followUpAt ?? null,
            notes: write.notes ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        if (!row) throw new Error('failed to insert application');
        return row;
      }

      const patch: Partial<typeof applications.$inferInsert> = { updatedAt: now };
      if (write.status !== undefined) patch.status = write.status;
      if (write.resumeHtml !== undefined) patch.resumeHtml = write.resumeHtml;
      if (write.resumePdfPath !== undefined) patch.resumePdfPath = write.resumePdfPath;
      if (write.coverNote !== undefined) patch.coverNote = write.coverNote;
      if (write.answers !== undefined) patch.answers = write.answers;
      if (write.fillReport !== undefined) patch.fillReport = write.fillReport;
      if (write.submittedAt !== undefined) patch.submittedAt = write.submittedAt;
      if (write.followUpAt !== undefined) patch.followUpAt = write.followUpAt;
      if (write.notes !== undefined) patch.notes = write.notes;

      const row = db
        .update(applications)
        .set(patch)
        .where(eq(applications.id, existing.id))
        .returning()
        .get();
      if (!row) throw new Error('failed to update application');
      return row;
    },
  };
}
