import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { type Db, createMigratedTestDb } from '../db/client.js';
import { companiesRepo } from '../db/repo/companies.js';
import { eventsRepo } from '../db/repo/events.js';
import { jobsRepo } from '../db/repo/jobs.js';
import { runsRepo } from '../db/repo/runs.js';
import { scoresRepo } from '../db/repo/scores.js';
import { jobs } from '../db/schema.js';
import { scoreOutput } from '../testing/fixtures.js';
import { type Clock, fixedClock } from '../util/clock.js';
import { ReviewError, scoutHeader, triageJob, undoTriage } from './review.js';

const MODEL = 'claude-haiku-5-5';
const RUBRIC = 'score-2026-10-22';

let sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'];

afterEach(() => {
  sqlite?.close();
});

interface SeedJob {
  externalId: string;
  title: string;
  remoteType?: 'remote' | 'hybrid' | 'onsite' | 'unknown';
  locationRaw?: string | null;
  postedAt?: string | null;
  contentHash?: string;
  status?: 'scored' | 'shortlisted' | 'skipped' | 'archived' | 'new';
  closedAt?: string | null;
  duplicateOf?: number | null;
  score?: { score: number; verdict: 'strong' | 'maybe' | 'no'; contentHash?: string };
}

function setup(seeds: SeedJob[]): { db: Db; clock: Clock; ids: number[] } {
  const made = createMigratedTestDb();
  sqlite = made.sqlite;
  const db = made.db;
  const clock = fixedClock('2026-10-22T12:00:00.000Z');
  const companyId = companiesRepo(db, clock).upsert({
    name: 'Acme',
    ats: 'greenhouse',
    token: 'acme',
    active: true,
    tags: [],
  }).id;
  const scores = scoresRepo(db, clock);
  const ids: number[] = [];

  for (const seed of seeds) {
    const hash = seed.contentHash ?? `hash-${seed.externalId}`;
    jobsRepo(db).upsert(
      {
        companyId,
        ats: 'greenhouse',
        externalId: seed.externalId,
        title: seed.title,
        locationRaw: seed.locationRaw ?? 'Remote, US',
        remoteType: seed.remoteType ?? 'remote',
        employmentType: 'full_time',
        url: `https://example.com/${seed.externalId}`,
        applyUrl: null,
        descriptionText: 'Build things with TypeScript.',
        compMin: null,
        compMax: null,
        compCurrency: null,
        postedAt: seed.postedAt ?? '2026-10-20T00:00:00.000Z',
        contentHash: hash,
        dedupeKey: `dk-${seed.externalId}`,
      },
      clock.now(),
    );
    const row = db.select().from(jobs).where(eq(jobs.externalId, seed.externalId)).get();
    const id = row?.id ?? 0;
    ids.push(id);
    db.update(jobs)
      .set({
        status: seed.status ?? 'scored',
        closedAt: seed.closedAt ?? null,
        duplicateOf: seed.duplicateOf ?? null,
      })
      .where(eq(jobs.id, id))
      .run();
    if (seed.score) {
      scores.insert({
        jobId: id,
        contentHash: seed.score.contentHash ?? hash,
        rubricVersion: RUBRIC,
        model: MODEL,
        profileHash: 'p',
        preferencesHash: 'q',
        dimensions: scoreOutput({}, Math.round(seed.score.score / 20)).dimensions,
        summary: 'A job.',
        score: seed.score.score,
        verdict: seed.score.verdict,
        redFlags: [],
      });
    }
  }
  return { db, clock, ids };
}

describe('triageJob', () => {
  it('sets the status and appends a triage event, atomically', () => {
    const { db, clock, ids } = setup([
      {
        externalId: 'a',
        title: 'Engineer',
        status: 'scored',
        score: { score: 80, verdict: 'strong' },
      },
    ]);
    const jobId = ids[0] ?? 0;

    const result = triageJob(db, clock, { jobId, action: 'shortlist' });
    expect(result).toMatchObject({ jobId, action: 'shortlist', from: 'scored', to: 'shortlisted' });

    const row = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
    expect(row?.status).toBe('shortlisted');

    const events = eventsRepo(db, clock).forJob(jobId);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('triage');
    expect(events[0]?.payload).toMatchObject({
      action: 'shortlist',
      from: 'scored',
      to: 'shortlisted',
    });
  });

  it('allows re-triage and records each transition', () => {
    const { db, clock, ids } = setup([
      { externalId: 'a', title: 'Engineer', score: { score: 80, verdict: 'strong' } },
    ]);
    const jobId = ids[0] ?? 0;

    triageJob(db, clock, { jobId, action: 'shortlist' });
    const second = triageJob(db, clock, { jobId, action: 'skip' });
    expect(second).toMatchObject({ from: 'shortlisted', to: 'skipped' });

    const row = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
    expect(row?.status).toBe('skipped');
    expect(eventsRepo(db, clock).forJob(jobId)).toHaveLength(2);
  });

  it('throws ReviewError for a missing job and writes nothing', () => {
    const { db, clock } = setup([]);
    expect(() => triageJob(db, clock, { jobId: 999, action: 'shortlist' })).toThrow(ReviewError);
    expect(eventsRepo(db, clock).ofType('triage')).toHaveLength(0);
  });
});

describe('undoTriage', () => {
  it('restores the status the last action moved the job from, and appends an undo event', () => {
    const { db, clock, ids } = setup([
      { externalId: 'a', title: 'Engineer', score: { score: 80, verdict: 'strong' } },
    ]);
    const jobId = ids[0] ?? 0;
    triageJob(db, clock, { jobId, action: 'skip' });

    const result = undoTriage(db, clock, { jobId });
    expect(result).toEqual({ jobId, undid: 'skip', from: 'skipped', to: 'scored' });
    expect(db.select().from(jobs).where(eq(jobs.id, jobId)).get()?.status).toBe('scored');
    const events = eventsRepo(db, clock).forJob(jobId);
    expect(events).toHaveLength(2);
    expect(events[0]?.payload).toEqual({
      action: 'undo',
      undid: 'skip',
      from: 'skipped',
      to: 'scored',
    });
  });

  it('walks back one action per undo, then refuses', () => {
    const { db, clock, ids } = setup([
      { externalId: 'a', title: 'Engineer', score: { score: 80, verdict: 'strong' } },
    ]);
    const jobId = ids[0] ?? 0;
    triageJob(db, clock, { jobId, action: 'shortlist' });
    triageJob(db, clock, { jobId, action: 'archive' });

    expect(undoTriage(db, clock, { jobId })).toMatchObject({ undid: 'archive', to: 'shortlisted' });
    expect(undoTriage(db, clock, { jobId })).toMatchObject({ undid: 'shortlist', to: 'scored' });
    expect(() => undoTriage(db, clock, { jobId })).toThrow(ReviewError);
    expect(db.select().from(jobs).where(eq(jobs.id, jobId)).get()?.status).toBe('scored');
    expect(eventsRepo(db, clock).forJob(jobId)).toHaveLength(4);
  });

  it('refuses when the status moved on since the action, and writes nothing', () => {
    const { db, clock, ids } = setup([
      { externalId: 'a', title: 'Engineer', score: { score: 80, verdict: 'strong' } },
    ]);
    const jobId = ids[0] ?? 0;
    triageJob(db, clock, { jobId, action: 'skip' });
    db.update(jobs).set({ status: 'archived' }).where(eq(jobs.id, jobId)).run();

    expect(() => undoTriage(db, clock, { jobId })).toThrow(ReviewError);
    expect(db.select().from(jobs).where(eq(jobs.id, jobId)).get()?.status).toBe('archived');
    expect(eventsRepo(db, clock).forJob(jobId)).toHaveLength(1);
  });

  it('throws for a missing job or one never triaged', () => {
    const { db, clock, ids } = setup([{ externalId: 'a', title: 'Engineer' }]);
    expect(() => undoTriage(db, clock, { jobId: 999 })).toThrow(ReviewError);
    expect(() => undoTriage(db, clock, { jobId: ids[0] ?? 0 })).toThrow(ReviewError);
    expect(eventsRepo(db, clock).ofType('triage')).toHaveLength(0);
  });
});

describe('scoresRepo.detail', () => {
  it('returns the job, company, and current score', () => {
    const { db, clock, ids } = setup([
      { externalId: 'a', title: 'Engineer', score: { score: 80, verdict: 'strong' } },
    ]);
    const detail = scoresRepo(db, clock).detail(ids[0] ?? 0);
    expect(detail?.company).toBe('Acme');
    expect(detail?.job.title).toBe('Engineer');
    expect(detail?.score).toMatchObject({ score: 80, verdict: 'strong', summary: 'A job.' });
    expect(detail?.score?.dimensions?.role_fit.score).toBe(4);
  });

  it('returns a null score when only a stale-hash score exists', () => {
    const { db, clock, ids } = setup([
      {
        externalId: 'a',
        title: 'Engineer',
        score: { score: 80, verdict: 'strong', contentHash: 'old' },
      },
    ]);
    const detail = scoresRepo(db, clock).detail(ids[0] ?? 0);
    expect(detail?.score).toBeNull();
  });

  it('returns undefined for a missing job', () => {
    const { db, clock } = setup([]);
    expect(scoresRepo(db, clock).detail(999)).toBeUndefined();
  });
});

describe('scoutHeader', () => {
  it('reports absent when no scout run exists', () => {
    const { db, clock } = setup([]);
    expect(scoutHeader(db, clock)).toEqual({ present: false });
  });

  it('shapes the latest scout run with its counts', () => {
    const { db, clock } = setup([]);
    const runs = runsRepo(db, clock);
    const id = runs.start('scout');
    runs.finish(id, {
      ok: true,
      stats: {
        boards: 5,
        boards_ok: 5,
        boards_failed: 0,
        seen: 100,
        inserted: 3,
        updated: 97,
        closed: 0,
        duplicates: 2,
        gates: {
          checked: 100,
          passed: 18,
          gated: { closed: 0, duplicate: 2, blocklist: 5, age: 75 },
          newly_gated: 0,
          resurfaced: 0,
        },
        prescored: 18,
        skipped_jobs: 0,
        scoring: {
          model: MODEL,
          rubric_version: RUBRIC,
          candidates: 20,
          scored: 4,
          cached: 16,
          skipped_cap: 0,
          errors: 0,
          input_tokens: 0,
          output_tokens: 0,
          calls: 0,
          estimated_usd: 0,
          cost_is_estimate: false,
        },
        errors: [],
      },
    });

    const header = scoutHeader(db, clock);
    expect(header).toMatchObject({
      present: true,
      runId: id,
      running: false,
      ok: true,
      boardsOk: 5,
      boardsFailed: 0,
      seen: 100,
      gated: 80,
      scored: 4,
      errors: 0,
    });
  });

  it('reads the gated count from a pre-Phase-2 run that stored `filtered`', () => {
    const { db, clock } = setup([]);
    const runs = runsRepo(db, clock);
    const id = runs.start('scout');
    runs.finish(id, {
      ok: true,
      stats: { boards_ok: 1, filtered: 1029, scoring: 'skipped', errors: [] },
    });
    expect(scoutHeader(db, clock).gated).toBe(1029);
  });

  it('marks an unfinished run as running', () => {
    const { db, clock } = setup([]);
    runsRepo(db, clock).start('scout');
    expect(scoutHeader(db, clock).running).toBe(true);
  });
});
