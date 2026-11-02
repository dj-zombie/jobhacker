import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { scoreOutput } from '../../testing/fixtures.js';
import { type Clock, fixedClock } from '../../util/clock.js';
import { type Db, createMigratedTestDb } from '../client.js';
import { jobAreas, jobs } from '../schema.js';
import { companiesRepo } from './companies.js';
import { type JobWrite, jobsRepo } from './jobs.js';
import { scoresRepo } from './scores.js';

let sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'];

afterEach(() => {
  sqlite?.close();
});

function baseWrite(companyId: number, contentHash: string): JobWrite {
  return {
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
    contentHash,
    dedupeKey: 'dk-1',
  };
}

function setup(): { db: Db; clock: Clock; companyId: number } {
  const made = createMigratedTestDb();
  sqlite = made.sqlite;
  const db = made.db;
  const clock = fixedClock('2026-10-23T00:00:00.000Z');
  const companyId = companiesRepo(db, clock).upsert({
    name: 'Acme',
    ats: 'greenhouse',
    token: 'acme',
    active: true,
    tags: [],
  }).id;
  return { db, clock, companyId };
}

describe('jobsRepo.upsert content-hash status reset (Known issue [2])', () => {
  it('resets filtered_out and scored jobs to new when the text changes', () => {
    for (const status of ['filtered_out', 'scored'] as const) {
      const { db, clock, companyId } = setup();
      const repo = jobsRepo(db);
      repo.upsert(baseWrite(companyId, 'h1'), clock.now());
      const id = repo.find('greenhouse', 'job-1')?.id ?? 0;
      db.update(jobs)
        .set({ status, filterReason: 'because', scoreState: 'current' })
        .where(eq(jobs.id, id))
        .run();

      repo.upsert(baseWrite(companyId, 'h2'), clock.now());
      const row = db.select().from(jobs).where(eq(jobs.id, id)).get();
      expect(row?.status).toBe('new');
      expect(row?.filterReason).toBeNull();
      expect(row?.scoreState).toBe('pending');
      sqlite.close();
    }
  });

  it('does not touch human triage states or an unchanged hash', () => {
    const { db, clock, companyId } = setup();
    const repo = jobsRepo(db);
    repo.upsert(baseWrite(companyId, 'h1'), clock.now());
    const id = repo.find('greenhouse', 'job-1')?.id ?? 0;
    db.update(jobs)
      .set({ status: 'shortlisted', scoreState: 'current' })
      .where(eq(jobs.id, id))
      .run();

    // Text changes, but a shortlisted job stays shortlisted.
    repo.upsert(baseWrite(companyId, 'h2'), clock.now());
    expect(db.select().from(jobs).where(eq(jobs.id, id)).get()).toMatchObject({
      status: 'shortlisted',
      scoreState: 'pending',
    });

    // Same hash, scored job keeps scored.
    db.update(jobs).set({ status: 'scored' }).where(eq(jobs.id, id)).run();
    repo.upsert(baseWrite(companyId, 'h2'), clock.now());
    expect(db.select().from(jobs).where(eq(jobs.id, id)).get()?.status).toBe('scored');
  });

  it('orders deferred work before pending, errors and current cache checks', () => {
    const { db, clock, companyId } = setup();
    const repo = jobsRepo(db);
    const states = [
      { externalId: 'run-cap', scoreState: 'run_cap' as const, prescore: 0 },
      { externalId: 'pending', scoreState: 'pending' as const, prescore: 1 },
      { externalId: 'error', scoreState: 'llm_error' as const, prescore: 0.9 },
      { externalId: 'current', scoreState: 'current' as const, prescore: 0.8 },
    ];
    for (const state of states) {
      repo.upsert(
        {
          ...baseWrite(companyId, `hash-${state.externalId}`),
          externalId: state.externalId,
          title: state.externalId,
          dedupeKey: `dedupe-${state.externalId}`,
        },
        clock.now(),
      );
      db.update(jobs)
        .set({
          gateResult: { passed: true, gate: null, detail: null },
          scoreState: state.scoreState,
          prescore: state.prescore,
        })
        .where(eq(jobs.externalId, state.externalId))
        .run();
    }

    expect(repo.listScorable().map((job) => job.title)).toEqual([
      'run-cap',
      'pending',
      'error',
      'current',
    ]);

    // A score under an older key makes "current" stale: it joins the deferred work.
    const currentId = repo.find('greenhouse', 'current')?.id ?? 0;
    const old = { rubricVersion: 'r1', model: 'm', profileHash: 'p', preferencesHash: 'q-old' };
    scoresRepo(db, clock).insert({
      ...old,
      jobId: currentId,
      contentHash: 'hash-current',
      dimensions: scoreOutput().dimensions,
      summary: 's',
      redFlags: [],
      score: 80,
      verdict: 'strong',
    });
    const key = { ...old, preferencesHash: 'q-new' };
    expect(repo.listScorable({ key }).map((job) => job.title)).toEqual([
      'current',
      'run-cap',
      'pending',
      'error',
    ]);
    expect(
      repo
        .listScorable({ key: old })
        .map((job) => job.title)
        .at(-1),
    ).toBe('current');

    // Jobs in the first areas go before everything else, whatever their tier.
    const errorId = repo.find('greenhouse', 'error')?.id ?? 0;
    db.insert(jobAreas).values({ jobId: errorId, area: 'portland' }).run();
    const ordered = repo.listScorable({ key, first: ['portland', 'remote'] });
    expect(ordered.map((job) => [job.title, job.inFirst])).toEqual([
      ['error', true],
      ['current', false],
      ['run-cap', false],
      ['pending', false],
    ]);
  });
});
