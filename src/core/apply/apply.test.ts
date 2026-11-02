import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Ats, Profile } from '../config/schemas.js';
import { type Db, createMigratedTestDb } from '../db/client.js';
import { applicationsRepo } from '../db/repo/applications.js';
import { companiesRepo } from '../db/repo/companies.js';
import { eventsRepo } from '../db/repo/events.js';
import { jobsRepo } from '../db/repo/jobs.js';
import { type Clock, fixedClock } from '../util/clock.js';
import { nullLogger } from '../util/logger.js';
import {
  FILLABLE_ATS,
  FOLLOW_UP_DAYS,
  PROVIDED_RESUME,
  attachedResume,
  markSubmitted,
  namedResume,
  resolveApplyUrl,
  runApply,
  selectAdapter,
} from './apply.js';
import { ApplyError } from './types.js';

let sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'];

afterEach(() => {
  sqlite?.close();
});

function profile(): Profile {
  return {
    contact: {
      name: 'Kris Tester',
      email: 'k@example.com',
      phone: '1',
      location: 'Scottsdale, AZ',
    },
    links: {},
    summary: 'Senior engineer.',
    skills: { frontend: ['React'] },
    experience: [],
    projects: [],
    education: [],
    standard_answers: {},
  };
}

function seedJob(db: Db, clock: Clock, ats: Ats, applyUrl: string | null): number {
  const companyId = companiesRepo(db, clock).upsert({
    name: 'Initech',
    ats,
    token: 'initech',
    active: true,
    tags: [],
  }).id;
  jobsRepo(db).upsert(
    {
      companyId,
      ats,
      externalId: 'job-1',
      title: 'Senior Frontend Engineer',
      locationRaw: 'Remote, US',
      remoteType: 'remote',
      employmentType: 'full_time',
      url: 'https://jobs.ashbyhq.com/initech/1',
      applyUrl,
      descriptionText: 'Build things.',
      compMin: null,
      compMax: null,
      compCurrency: null,
      postedAt: null,
      contentHash: 'hash-1',
      dedupeKey: 'dk-1',
    },
    clock.now(),
  );
  return jobsRepo(db).find(ats, 'job-1')?.id ?? 0;
}

const deps = (db: Db, clock: Clock) => ({ db, clock, log: nullLogger(), profile: profile() });

describe('resolveApplyUrl', () => {
  it('keeps a Greenhouse URL that is already on greenhouse.io', () => {
    expect(
      resolveApplyUrl({
        ats: 'greenhouse',
        url: 'https://job-boards.greenhouse.io/discord/jobs/8214127002',
        applyUrl: null,
        externalId: '8214127002',
        boardToken: 'discord',
      }),
    ).toBe('https://job-boards.greenhouse.io/discord/jobs/8214127002');
  });

  it('opens the Greenhouse embed when the stored URL is a company career page', () => {
    // Stripe's absolute_url is stripe.com and that page has no application form.
    expect(
      resolveApplyUrl({
        ats: 'greenhouse',
        url: 'https://stripe.com/jobs/search?gh_jid=8172510',
        applyUrl: null,
        externalId: '8172510',
        boardToken: 'stripe',
      }),
    ).toBe('https://job-boards.greenhouse.io/embed/job_app?for=stripe&token=8172510');
  });

  it('opens the SmartRecruiters easy-apply form instead of the job ad', () => {
    const ad = 'https://jobs.smartrecruiters.com/Canva/6000000001468836';
    expect(
      resolveApplyUrl({
        ats: 'smartrecruiters',
        url: ad,
        applyUrl: ad,
        externalId: '6000000001468836',
        boardToken: 'canva',
      }),
    ).toBe(`${ad}?oga=true`);
  });

  it('leaves a SmartRecruiters easy-apply URL alone', () => {
    const form = 'https://jobs.smartrecruiters.com/oneclick-ui/company/Canva/publication/abc';
    expect(
      resolveApplyUrl({
        ats: 'smartrecruiters',
        url: form,
        applyUrl: form,
        externalId: 'abc',
        boardToken: 'canva',
      }),
    ).toBe(form);
  });

  it('prefers an explicit apply URL for Lever and Ashby', () => {
    expect(
      resolveApplyUrl({
        ats: 'lever',
        url: 'https://jobs.lever.co/spotify/abc',
        applyUrl: 'https://jobs.lever.co/spotify/abc/apply',
        externalId: 'abc',
        boardToken: 'spotify',
      }),
    ).toBe('https://jobs.lever.co/spotify/abc/apply');
  });
});

describe('selectAdapter', () => {
  it('returns an adapter for every ATS we ingest', () => {
    expect(selectAdapter('greenhouse')?.ats).toBe('greenhouse');
    expect(selectAdapter('lever')?.ats).toBe('lever');
    expect(selectAdapter('ashby')?.ats).toBe('ashby');
    for (const ats of FILLABLE_ATS) expect(selectAdapter(ats)?.ats).toBe(ats);
  });

  it('routes Ashby application URLs to the Ashby adapter', () => {
    expect(
      selectAdapter('ashby')?.canHandle('https://jobs.ashbyhq.com/linear/abc/application'),
    ).toBe(true);
  });
});

describe('runApply (no browser)', () => {
  it('throws ApplyError when the job has no application yet', async () => {
    const made = createMigratedTestDb();
    sqlite = made.sqlite;
    const db = made.db;
    const clock = fixedClock('2026-10-22T12:00:00.000Z');
    const jobId = seedJob(db, clock, 'ashby', null);

    await expect(runApply(deps(db, clock), { jobId })).rejects.toThrow(ApplyError);
  });

  it('throws ApplyError for a missing job', async () => {
    const made = createMigratedTestDb();
    sqlite = made.sqlite;
    const db = made.db;
    const clock = fixedClock('2026-10-22T12:00:00.000Z');
    await expect(runApply(deps(db, clock), { jobId: 999 })).rejects.toThrow(/job 999 not found/);
  });
});

describe('attachedResume', () => {
  const generated = 'output/7/resume.pdf';

  it("attaches Kris's own input/resume.pdf, as it is, whenever it exists", () => {
    const exists = (p: string) => p === PROVIDED_RESUME;
    expect(attachedResume(generated, exists)).toEqual({ path: PROVIDED_RESUME, provided: true });
    expect(attachedResume(null, exists)).toEqual({ path: PROVIDED_RESUME, provided: true });
  });

  it('falls back to the generated resume when he has none in input/', () => {
    const none = () => false;
    expect(attachedResume(generated, none)).toEqual({ path: generated, provided: false });
    expect(attachedResume(null, none)).toEqual({ path: null, provided: false });
  });
});

describe('namedResume', () => {
  const home = process.cwd();
  let dir = '';

  afterEach(() => {
    process.chdir(home);
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  function inTempDir(): void {
    dir = mkdtempSync(join(tmpdir(), 'named-resume-'));
    process.chdir(dir);
    mkdirSync(join('output', '7'), { recursive: true });
    writeFileSync(join('output', '7', 'resume.pdf'), '%PDF generated');
  }

  it("uploads Kris's own resume, byte for byte, under his name beside the prep output", () => {
    inTempDir();
    mkdirSync('input');
    writeFileSync(PROVIDED_RESUME, '%PDF his own');
    const named = namedResume(profile(), {
      id: 7,
      resumePdfPath: join('output', '7', 'resume.pdf'),
    });
    expect(named).toBe(join('output', '7', 'Kris_Tester_Resume.pdf'));
    expect(readFileSync(named ?? '', 'utf8')).toBe('%PDF his own');
    expect(readFileSync(join('output', '7', 'resume.pdf'), 'utf8')).toBe('%PDF generated');
  });

  it('uploads the generated resume when there is no input/resume.pdf', () => {
    inTempDir();
    const named = namedResume(profile(), {
      id: 7,
      resumePdfPath: join('output', '7', 'resume.pdf'),
    });
    expect(readFileSync(named ?? '', 'utf8')).toBe('%PDF generated');
  });
});

describe('markSubmitted', () => {
  it('sets status, submitted_at, a +7d follow-up, and appends a submitted event', () => {
    const made = createMigratedTestDb();
    sqlite = made.sqlite;
    const db = made.db;
    const clock = fixedClock('2026-10-22T12:00:00.000Z');
    const jobId = seedJob(db, clock, 'greenhouse', null);
    applicationsRepo(db, clock).upsertForJob({ jobId, status: 'prepped' });

    const res = markSubmitted(db, clock, jobId);

    expect(res.submittedAt).toBe('2026-10-22T12:00:00.000Z');
    const expectedFollowUp = new Date(clock.nowMs() + FOLLOW_UP_DAYS * 86_400_000).toISOString();
    expect(res.followUpAt).toBe(expectedFollowUp);

    const app = applicationsRepo(db, clock).findByJob(jobId);
    expect(app?.status).toBe('submitted');
    expect(app?.submittedAt).toBe('2026-10-22T12:00:00.000Z');
    expect(app?.followUpAt).toBe(expectedFollowUp);

    const events = eventsRepo(db, clock).ofType('submitted');
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ follow_up_at: expectedFollowUp });
  });

  it('puts the follow-up exactly seven days after the submitted stamp on a ticking clock', () => {
    const made = createMigratedTestDb();
    sqlite = made.sqlite;
    const db = made.db;
    const fixed = fixedClock('2026-10-22T12:00:00.000Z');
    const ticking = {
      now: () => {
        fixed.advance(1);
        return fixed.now();
      },
      nowMs: () => {
        fixed.advance(1);
        return fixed.nowMs();
      },
    };
    const jobId = seedJob(db, fixed, 'greenhouse', null);
    applicationsRepo(db, fixed).upsertForJob({ jobId, status: 'prepped' });

    const res = markSubmitted(db, ticking, jobId);

    expect(Date.parse(res.followUpAt ?? '') - Date.parse(res.submittedAt)).toBe(
      FOLLOW_UP_DAYS * 86_400_000,
    );
  });

  it('is idempotent: a second click keeps the first submission time and writes no event', () => {
    const made = createMigratedTestDb();
    sqlite = made.sqlite;
    const db = made.db;
    const clock = fixedClock('2026-10-22T12:00:00.000Z');
    const jobId = seedJob(db, clock, 'greenhouse', null);
    applicationsRepo(db, clock).upsertForJob({ jobId, status: 'prepped' });

    const first = markSubmitted(db, clock, jobId);
    clock.advance(3 * 86_400_000);
    const second = markSubmitted(db, clock, jobId);

    expect(first.already).toBe(false);
    expect(second.already).toBe(true);
    expect(second.submittedAt).toBe('2026-10-22T12:00:00.000Z');
    expect(second.followUpAt).toBe(first.followUpAt);
    expect(eventsRepo(db, clock).ofType('submitted')).toHaveLength(1);
  });

  it('marks a prepped application afresh even if it carries an old submitted stamp', () => {
    const made = createMigratedTestDb();
    sqlite = made.sqlite;
    const db = made.db;
    const clock = fixedClock('2026-10-22T12:00:00.000Z');
    const jobId = seedJob(db, clock, 'greenhouse', null);
    applicationsRepo(db, clock).upsertForJob({
      jobId,
      status: 'prepped',
      submittedAt: '2026-10-20T09:00:00.000Z',
    });

    const res = markSubmitted(db, clock, jobId);
    const app = applicationsRepo(db, clock).findByJob(jobId);
    expect(res.already).toBe(false);
    expect(app?.status).toBe('submitted');
    expect(app?.submittedAt).toBe('2026-10-22T12:00:00.000Z');
    expect(eventsRepo(db, clock).ofType('submitted')).toHaveLength(1);
  });

  it('stamps a later status without moving it back to submitted', () => {
    const made = createMigratedTestDb();
    sqlite = made.sqlite;
    const db = made.db;
    const clock = fixedClock('2026-10-22T12:00:00.000Z');
    const jobId = seedJob(db, clock, 'greenhouse', null);
    applicationsRepo(db, clock).upsertForJob({ jobId, status: 'interviewing' });

    const res = markSubmitted(db, clock, jobId);
    const app = applicationsRepo(db, clock).findByJob(jobId);
    expect(res.already).toBe(false);
    expect(app?.status).toBe('interviewing');
    expect(app?.submittedAt).toBe('2026-10-22T12:00:00.000Z');
  });

  it('throws ApplyError when there is no application', () => {
    const made = createMigratedTestDb();
    sqlite = made.sqlite;
    const db = made.db;
    const clock = fixedClock('2026-10-22T12:00:00.000Z');
    const jobId = seedJob(db, clock, 'greenhouse', null);
    expect(() => markSubmitted(db, clock, jobId)).toThrow(ApplyError);
  });
});
