import { afterEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../../util/clock.js';
import { type Db, createMigratedTestDb } from '../client.js';
import { applicationsRepo } from './applications.js';
import { companiesRepo } from './companies.js';
import { jobsRepo } from './jobs.js';

let sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'];

afterEach(() => {
  sqlite?.close();
});

function seedJob(db: Db, clock: ReturnType<typeof fixedClock>): number {
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
      externalId: 'job-1',
      title: 'Senior Engineer',
      locationRaw: 'Remote, US',
      remoteType: 'remote',
      employmentType: 'full_time',
      url: 'https://example.com/1',
      applyUrl: null,
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
  return jobsRepo(db).find('greenhouse', 'job-1')?.id ?? 0;
}

describe('applicationsRepo', () => {
  it('inserts a prepped application then updates only the supplied fields', () => {
    const made = createMigratedTestDb();
    sqlite = made.sqlite;
    const db = made.db;
    const clock = fixedClock('2026-10-22T12:00:00.000Z');
    const jobId = seedJob(db, clock);
    const repo = applicationsRepo(db, clock);

    const created = repo.upsertForJob({
      jobId,
      resumeHtml: '<p>v1</p>',
      coverNote: 'note v1',
      answers: { work_authorization_us: 'Yes' },
    });
    expect(created.status).toBe('prepped');
    expect(created.resumeHtml).toBe('<p>v1</p>');
    expect(created.coverNote).toBe('note v1');
    expect(created.answers).toEqual({ work_authorization_us: 'Yes' });

    clock.advance(1000);
    // Regenerate only the cover note; the resume and answers must survive.
    const updated = repo.upsertForJob({ jobId, coverNote: 'note v2' });
    expect(updated.id).toBe(created.id);
    expect(updated.coverNote).toBe('note v2');
    expect(updated.resumeHtml).toBe('<p>v1</p>');
    expect(updated.answers).toEqual({ work_authorization_us: 'Yes' });
    expect(updated.updatedAt).not.toBe(created.updatedAt);

    expect(repo.findByJob(jobId)?.id).toBe(created.id);
  });
});
