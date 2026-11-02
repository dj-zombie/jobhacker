import { and, desc, eq, or } from 'drizzle-orm';
import type { Clock } from '../../util/clock.js';
import type { Db } from '../client.js';
import { events, type EventRow } from '../schema.js';

export interface EventInput {
  type: string;
  jobId?: number | null;
  applicationId?: number | null;
  payload?: unknown;
}

/**
 * Repository for the append-only `events` audit log. Events are never updated
 * or deleted (ARCHITECTURE § Data model).
 */
export function eventsRepo(db: Db, clock: Clock) {
  return {
    /** Append an event and return its id. */
    append(input: EventInput): number {
      const row = db
        .insert(events)
        .values({
          type: input.type,
          jobId: input.jobId ?? null,
          applicationId: input.applicationId ?? null,
          payload: input.payload ?? null,
          at: clock.now(),
        })
        .returning({ id: events.id })
        .get();
      if (!row) throw new Error('failed to append event');
      return row.id;
    },

    /** All events for a job, newest first. */
    forJob(jobId: number): EventRow[] {
      return db
        .select()
        .from(events)
        .where(eq(events.jobId, jobId))
        .orderBy(desc(events.at), desc(events.id))
        .all();
    },

    /** All events for an application, newest first. */
    forApplication(applicationId: number): EventRow[] {
      return db
        .select()
        .from(events)
        .where(eq(events.applicationId, applicationId))
        .orderBy(desc(events.at), desc(events.id))
        .all();
    },

    /**
     * The full timeline for an application: every event tied to the application
     * row (prep, fill, submitted, status changes) *or* to its job (triage,
     * llm_usage), newest first. Used by the tracker view (FR-9).
     */
    timeline(jobId: number, applicationId: number): EventRow[] {
      return db
        .select()
        .from(events)
        .where(or(eq(events.applicationId, applicationId), eq(events.jobId, jobId)))
        .orderBy(desc(events.at), desc(events.id))
        .all();
    },

    /** Events of a given type, newest first. */
    ofType(type: string, applicationId?: number): EventRow[] {
      const condition =
        applicationId === undefined
          ? eq(events.type, type)
          : and(eq(events.type, type), eq(events.applicationId, applicationId));
      return db
        .select()
        .from(events)
        .where(condition)
        .orderBy(desc(events.at), desc(events.id))
        .all();
    },
  };
}
