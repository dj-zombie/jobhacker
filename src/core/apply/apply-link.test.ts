import { afterEach, describe, expect, it } from 'vitest';
import { type Db, createMigratedTestDb } from '../db/client.js';
import { applicationsRepo } from '../db/repo/applications.js';
import { companiesRepo } from '../db/repo/companies.js';
import { eventsRepo } from '../db/repo/events.js';
import { jobsRepo } from '../db/repo/jobs.js';
import { type Clock, fixedClock } from '../util/clock.js';
import { JOB_BOARD_REFUSAL, setApplyLink } from './apply-link.js';

let sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'] | undefined;
afterEach(() => sqlite?.close());

function seed(): { db: Db; clock: Clock; appId: number } {
  const made = createMigratedTestDb();
  sqlite = made.sqlite;
  const { db } = made;
  const clock = fixedClock('2026-11-11T12:00:00.000Z');
  const companyId = companiesRepo(db, clock).upsert({
    name: 'Remote',
    ats: 'jsearch',
    token: 'remote',
    active: true,
    tags: [],
  }).id;
  const url = 'https://www.jobleads.com/us/job/e1';
  jobsRepo(db).upsert(
    {
      companyId,
      ats: 'jsearch',
      externalId: 'js-1',
      title: 'Senior Frontend Engineer',
      locationRaw: null,
      remoteType: 'remote',
      employmentType: null,
      url,
      applyUrl: url,
      descriptionText: '',
      compMin: null,
      compMax: null,
      compCurrency: null,
      postedAt: null,
      contentHash: 'h',
      dedupeKey: 'd',
    },
    clock.now(),
  );
  const jobId = jobsRepo(db).find('jsearch', 'js-1')?.id ?? 0;
  const appId = applicationsRepo(db, clock).upsertForJob({ jobId }).id;
  return { db, clock, appId };
}

describe('setApplyLink', () => {
  it('saves a trimmed https link and records the host, never the link', () => {
    const { db, clock, appId } = seed();
    const link = '  https://jobs.ashbyhq.com/initech/abc/application  ';
    expect(setApplyLink(db, clock, appId, link)).toEqual({
      ok: true,
      applyUrl: 'https://jobs.ashbyhq.com/initech/abc/application',
      changed: true,
    });
    expect(applicationsRepo(db, clock).get(appId)?.applyUrl).toBe(
      'https://jobs.ashbyhq.com/initech/abc/application',
    );
    expect(
      eventsRepo(db, clock)
        .ofType('apply_link', appId)
        .map((e) => e.payload),
    ).toEqual([{ host: 'jobs.ashbyhq.com', from: 'pasted' }]);
  });

  it('records a link taken from the options as from: option', () => {
    const { db, clock, appId } = seed();
    setApplyLink(db, clock, appId, 'https://careers.initech.example/jobs/9', 'option');
    expect(
      eventsRepo(db, clock)
        .ofType('apply_link', appId)
        .map((e) => e.payload),
    ).toEqual([{ host: 'careers.initech.example', from: 'option' }]);
  });

  it('refuses a job board, with the words Kris sees, and changes nothing', () => {
    const { db, clock, appId } = seed();
    expect(setApplyLink(db, clock, appId, 'https://us.jooble.org/desc/1')).toEqual({
      ok: false,
      error: JOB_BOARD_REFUSAL,
    });
    expect(JOB_BOARD_REFUSAL).toBe(
      "That's a job board too. Paste the employer's own application link.",
    );
    expect(applicationsRepo(db, clock).get(appId)?.applyUrl).toBeNull();
    expect(eventsRepo(db, clock).ofType('apply_link')).toHaveLength(0);
  });

  it('refuses anything but http and https, and links over 2,000 characters', () => {
    const { db, clock, appId } = seed();
    for (const bad of ['ftp://initech.example/apply', 'javascript:alert(1)', 'initech.example']) {
      const res = setApplyLink(db, clock, appId, bad);
      expect(res.ok).toBe(false);
    }
    const long = `https://careers.initech.example/${'a'.repeat(2_000)}`;
    expect(setApplyLink(db, clock, appId, long)).toEqual({
      ok: false,
      error: 'That link is longer than 2,000 characters.',
    });
    const exact = `https://careers.initech.example/${'a'.repeat(2_000 - 32)}`;
    expect(exact).toHaveLength(2_000);
    expect(setApplyLink(db, clock, appId, exact).ok).toBe(true);
    expect(setApplyLink(db, clock, appId, 'http://careers.initech.example/apply').ok).toBe(true);
  });

  it('clears with null or a blank value, recording cleared once', () => {
    const { db, clock, appId } = seed();
    setApplyLink(db, clock, appId, 'https://careers.initech.example/jobs/9');
    expect(setApplyLink(db, clock, appId, null)).toEqual({
      ok: true,
      applyUrl: null,
      changed: true,
    });
    expect(setApplyLink(db, clock, appId, '   ')).toEqual({
      ok: true,
      applyUrl: null,
      changed: false,
    });
    expect(applicationsRepo(db, clock).get(appId)?.applyUrl).toBeNull();
    // Newest first.
    expect(
      eventsRepo(db, clock)
        .ofType('apply_link', appId)
        .map((e) => e.payload),
    ).toEqual([
      { host: 'careers.initech.example', from: 'cleared' },
      { host: 'careers.initech.example', from: 'pasted' },
    ]);
  });
});
