import { afterEach, describe, expect, it } from 'vitest';
import { type Db, createMigratedTestDb } from '../db/client.js';
import { type ApplicationStatus, applicationsRepo } from '../db/repo/applications.js';
import { companiesRepo } from '../db/repo/companies.js';
import { eventsRepo } from '../db/repo/events.js';
import { jobsRepo } from '../db/repo/jobs.js';
import { type Clock, fixedClock } from '../util/clock.js';
import {
  APPLICATION_STATUSES,
  TrackerError,
  answerApprovals,
  applicationTimeline,
  applicationsToCsv,
  approveAnswer,
  changeApplicationStatus,
  csvField,
  followUpCutoff,
  followUpsDue,
  inApplicationList,
  isApproved,
  listApplications,
  localDateToFollowUp,
  setFollowUp,
  setNotes,
} from './tracker.js';

let sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'];

afterEach(() => {
  sqlite?.close();
});

function seedJob(db: Db, clock: Clock, externalId: string, title: string): number {
  const companyId = companiesRepo(db, clock).upsert({
    name: 'Acme',
    ats: 'greenhouse',
    token: 'acme',
    active: true,
    tags: [],
  }).id;
  jobsRepo(db).upsert(
    {
      companyId,
      ats: 'greenhouse',
      externalId,
      title,
      locationRaw: 'Remote, US',
      remoteType: 'remote',
      employmentType: 'full_time',
      url: `https://example.com/${externalId}`,
      applyUrl: null,
      descriptionText: 'Build things.',
      compMin: null,
      compMax: null,
      compCurrency: null,
      postedAt: null,
      contentHash: `hash-${externalId}`,
      dedupeKey: `dk-${externalId}`,
    },
    clock.now(),
  );
  return jobsRepo(db).find('greenhouse', externalId)?.id ?? 0;
}

describe('changeApplicationStatus', () => {
  it('moves status, writes a status event, and stamps follow-up on first submit', () => {
    const { db, sqlite: s } = createMigratedTestDb();
    sqlite = s;
    const clock = fixedClock('2026-10-23T00:00:00.000Z');
    const jobId = seedJob(db, clock, 'j1', 'Engineer');
    applicationsRepo(db, clock).upsertForJob({ jobId, status: 'prepped' });

    const res = changeApplicationStatus(db, clock, { jobId, status: 'submitted' });
    expect(res.from).toBe('prepped');
    expect(res.to).toBe('submitted');
    expect(res.submittedAt).toBe('2026-10-23T00:00:00.000Z');
    // +7 days default follow-up.
    expect(res.followUpAt).toBe('2026-10-30T00:00:00.000Z');

    const events = eventsRepo(db, clock).ofType('status');
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ from: 'prepped', to: 'submitted' });

    // A follow-up already set is kept; only a blank one is seeded at seven days.
    const dated = seedJob(db, clock, 'j-dated', 'Dated');
    applicationsRepo(db, clock).upsertForJob({
      jobId: dated,
      status: 'prepped',
      followUpAt: '2026-11-02T16:00:00.000Z',
    });
    const kept = changeApplicationStatus(db, clock, { jobId: dated, status: 'submitted' });
    expect(kept.submittedAt).toBe('2026-10-23T00:00:00.000Z');
    expect(kept.followUpAt).toBe('2026-11-02T16:00:00.000Z');

    // Moving to interviewing keeps the original submitted/follow-up times.
    clock.advance(86_400_000);
    const next = changeApplicationStatus(db, clock, { jobId, status: 'interviewing' });
    expect(next.submittedAt).toBe('2026-10-23T00:00:00.000Z');
    expect(next.followUpAt).toBe('2026-10-30T00:00:00.000Z');
  });

  it('moving back to prepped clears the submitted stamp and keeps the follow-up', () => {
    const { db, sqlite: s } = createMigratedTestDb();
    sqlite = s;
    const clock = fixedClock('2026-10-23T00:00:00.000Z');
    const jobId = seedJob(db, clock, 'j1', 'Engineer');
    applicationsRepo(db, clock).upsertForJob({ jobId, status: 'prepped' });

    changeApplicationStatus(db, clock, { jobId, status: 'submitted' });
    clock.advance(60_000);
    const back = changeApplicationStatus(db, clock, { jobId, status: 'prepped' });
    expect(back.submittedAt).toBeNull();
    expect(back.followUpAt).toBe('2026-10-30T00:00:00.000Z');
    expect(applicationsRepo(db, clock).findByJob(jobId)?.submittedAt).toBeNull();
  });

  it('rejects an unknown status and a missing application', () => {
    const { db, sqlite: s } = createMigratedTestDb();
    sqlite = s;
    const clock = fixedClock('2026-10-23T00:00:00.000Z');
    const jobId = seedJob(db, clock, 'j1', 'Engineer');

    expect(() => changeApplicationStatus(db, clock, { jobId, status: 'bogus' })).toThrow(
      TrackerError,
    );
    applicationsRepo(db, clock).upsertForJob({ jobId });
    expect(() => changeApplicationStatus(db, clock, { jobId: 999, status: 'submitted' })).toThrow(
      /no application/,
    );
  });
});

describe('setFollowUp / setNotes', () => {
  it('sets a follow-up date with an event and updates notes without content loss', () => {
    const { db, sqlite: s } = createMigratedTestDb();
    sqlite = s;
    const clock = fixedClock('2026-10-23T00:00:00.000Z');
    const jobId = seedJob(db, clock, 'j1', 'Engineer');
    const apps = applicationsRepo(db, clock);
    apps.upsertForJob({ jobId });

    setFollowUp(db, clock, { jobId, followUpAt: '2026-11-01T00:00:00.000Z' });
    expect(apps.findByJob(jobId)?.followUpAt).toBe('2026-11-01T00:00:00.000Z');
    expect(eventsRepo(db, clock).ofType('follow_up')).toHaveLength(1);

    setNotes(db, clock, { jobId, notes: '  recruiter call Friday  ' });
    expect(apps.findByJob(jobId)?.notes).toBe('  recruiter call Friday  ');
    // Blank notes clear to null.
    setNotes(db, clock, { jobId, notes: '   ' });
    expect(apps.findByJob(jobId)?.notes).toBeNull();
  });

  it('writes a note event per save that carries the length, never the text', () => {
    const { db, sqlite: s } = createMigratedTestDb();
    sqlite = s;
    const clock = fixedClock('2026-10-23T00:00:00.000Z');
    const jobId = seedJob(db, clock, 'j1', 'Engineer');
    applicationsRepo(db, clock).upsertForJob({ jobId });

    setNotes(db, clock, { jobId, notes: 'recruiter call Friday' });
    setNotes(db, clock, { jobId, notes: '' });

    const notes = eventsRepo(db, clock).ofType('note');
    expect(notes.map((e) => e.payload)).toEqual([{ chars: 0 }, { chars: 21 }]);
    expect(JSON.stringify(notes)).not.toContain('recruiter');
  });
});

describe('answer approvals', () => {
  it('holds while the text is unchanged, lapses when it changes, and the newest wins', () => {
    const { db, sqlite: s } = createMigratedTestDb();
    sqlite = s;
    const clock = fixedClock('2026-10-23T00:00:00.000Z');
    const jobId = seedJob(db, clock, 'j1', 'Engineer');
    const app = applicationsRepo(db, clock).upsertForJob({ jobId });
    const q = 'Are you based in a US or equivalent timezone?';

    expect(isApproved(answerApprovals(db, clock, app.id), q, 'Yes')).toBe(false);

    approveAnswer(db, clock, { jobId, question: q, value: 'Yes' });
    let approvals = answerApprovals(db, clock, app.id);
    expect(isApproved(approvals, q, 'Yes')).toBe(true);
    expect(isApproved(approvals, q, '  Yes ')).toBe(true);
    expect(isApproved(approvals, q, 'No')).toBe(false);

    clock.advance(1000);
    approveAnswer(db, clock, { jobId, question: q, value: 'No', edited: true });
    approvals = answerApprovals(db, clock, app.id);
    expect(isApproved(approvals, q, 'No')).toBe(true);
    expect(isApproved(approvals, q, 'Yes')).toBe(false);

    const events = eventsRepo(db, clock).ofType('answer_approved');
    expect(events[0]?.payload).toMatchObject({ question: q, edited: true });
    // The approved text itself is never stored in the event.
    expect(JSON.stringify(events)).not.toMatch(/"(Yes|No)"/);
  });

  it('throws for a job with no application', () => {
    const { db, sqlite: s } = createMigratedTestDb();
    sqlite = s;
    const clock = fixedClock('2026-10-23T00:00:00.000Z');
    const jobId = seedJob(db, clock, 'j1', 'Engineer');
    expect(() => approveAnswer(db, clock, { jobId, question: 'Q', value: 'A' })).toThrow(
      TrackerError,
    );
  });
});

describe('inApplicationList', () => {
  const cutoff = '2026-10-23T23:59:59.999Z';
  const row = (status: ApplicationStatus, followUpAt: string | null = null) => ({
    status,
    followUpAt,
  });

  it('puts prepped in progress and everything at or past submitted in submitted', () => {
    expect(inApplicationList(row('prepped'), 'in-progress', cutoff)).toBe(true);
    expect(inApplicationList(row('prepped'), 'submitted', cutoff)).toBe(false);
    for (const status of APPLICATION_STATUSES.filter((s) => s !== 'prepped')) {
      expect(inApplicationList(row(status), 'submitted', cutoff)).toBe(true);
      expect(inApplicationList(row(status), 'in-progress', cutoff)).toBe(false);
    }
  });

  it('lists follow-ups due today or earlier on open, submitted applications only', () => {
    expect(
      inApplicationList(row('submitted', '2026-10-23T18:00:00.000Z'), 'follow-ups', cutoff),
    ).toBe(true);
    expect(
      inApplicationList(row('interviewing', '2026-10-01T00:00:00.000Z'), 'follow-ups', cutoff),
    ).toBe(true);
    expect(
      inApplicationList(row('submitted', '2026-10-24T00:00:00.000Z'), 'follow-ups', cutoff),
    ).toBe(false);
    expect(inApplicationList(row('submitted'), 'follow-ups', cutoff)).toBe(false);
    expect(
      inApplicationList(row('prepped', '2026-10-01T00:00:00.000Z'), 'follow-ups', cutoff),
    ).toBe(false);
    for (const status of ['offer', 'rejected', 'withdrawn', 'ghosted'] as const) {
      expect(inApplicationList(row(status, '2026-10-01T00:00:00.000Z'), 'follow-ups', cutoff)).toBe(
        false,
      );
    }
  });

  it('due today means any time before the end of the local day', () => {
    const clock = fixedClock('2026-10-23T12:00:00.000Z');
    const cut = new Date(followUpCutoff(clock));
    expect(cut.getTime()).toBeGreaterThan(clock.nowMs());
    expect(cut.getHours()).toBe(23);
    expect(cut.getMinutes()).toBe(59);
  });
});

describe('listApplications / followUpsDue', () => {
  it('lists applications and surfaces only non-terminal due follow-ups', () => {
    const { db, sqlite: s } = createMigratedTestDb();
    sqlite = s;
    const clock = fixedClock('2026-10-23T00:00:00.000Z');
    const apps = applicationsRepo(db, clock);

    const due = seedJob(db, clock, 'due', 'Due Role');
    apps.upsertForJob({ jobId: due, status: 'submitted', followUpAt: '2026-10-22T00:00:00.000Z' });

    const future = seedJob(db, clock, 'future', 'Future Role');
    apps.upsertForJob({
      jobId: future,
      status: 'submitted',
      followUpAt: '2026-10-30T00:00:00.000Z',
    });

    const rejected = seedJob(db, clock, 'rej', 'Rejected Role');
    apps.upsertForJob({
      jobId: rejected,
      status: 'rejected',
      followUpAt: '2026-10-01T00:00:00.000Z',
    });

    expect(listApplications(db, clock)).toHaveLength(3);

    const dueRows = followUpsDue(db, clock);
    expect(dueRows.map((r) => r.jobId)).toEqual([due]);
  });
});

describe('applicationTimeline', () => {
  it('returns both job-scoped and application-scoped events, newest first', () => {
    const { db, sqlite: s } = createMigratedTestDb();
    sqlite = s;
    const clock = fixedClock('2026-10-23T00:00:00.000Z');
    const jobId = seedJob(db, clock, 'j1', 'Engineer');
    const app = applicationsRepo(db, clock).upsertForJob({ jobId });
    const events = eventsRepo(db, clock);

    events.append({ type: 'triage', jobId, payload: { action: 'shortlist' } });
    clock.advance(1000);
    events.append({ type: 'prep', jobId, applicationId: app.id, payload: { bullets: 2 } });
    clock.advance(1000);
    changeApplicationStatus(db, clock, { jobId, status: 'submitted' });

    const timeline = applicationTimeline(db, clock, { jobId, applicationId: app.id });
    expect(timeline.map((e) => e.type)).toEqual(['status', 'prep', 'triage']);
  });
});

describe('CSV export', () => {
  it('escapes commas, quotes and newlines (RFC-4180)', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
    expect(csvField(null)).toBe('');
  });

  it('serializes applications with a header and CRLF rows', () => {
    const { db, sqlite: s } = createMigratedTestDb();
    sqlite = s;
    const clock = fixedClock('2026-10-23T00:00:00.000Z');
    const jobId = seedJob(db, clock, 'j1', 'Engineer, Platform');
    applicationsRepo(db, clock).upsertForJob({
      jobId,
      status: 'submitted',
      notes: 'likes, a lot',
    });

    const csv = applicationsToCsv(listApplications(db, clock));
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(
      'application_id,job_id,company,title,ats,status,submitted_at,follow_up_at,url,notes,created_at,updated_at',
    );
    // Title and notes both contain commas → both quoted.
    expect(lines[1]).toContain('"Engineer, Platform"');
    expect(lines[1]).toContain('"likes, a lot"');
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});

describe('localDateToFollowUp', () => {
  it('stores a yyyy-mm-dd as 9 AM local time, and rejects anything else', () => {
    const iso = localDateToFollowUp('2026-11-02');
    expect(iso).not.toBeNull();
    const at = new Date(iso ?? '');
    expect(at.getFullYear()).toBe(2026);
    expect(at.getMonth()).toBe(10);
    expect(at.getDate()).toBe(2);
    expect(at.getHours()).toBe(9);
    expect(at.getMinutes()).toBe(0);
    expect(localDateToFollowUp('11/02/2026')).toBeNull();
  });
});
