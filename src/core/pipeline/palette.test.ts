import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { type Db, createMigratedTestDb } from '../db/client.js';
import { applicationsRepo } from '../db/repo/applications.js';
import { areasRepo } from '../db/repo/areas.js';
import { scoresRepo } from '../db/repo/scores.js';
import { jobs } from '../db/schema.js';
import {
  TEST_PREFERENCES,
  scoreOutput,
  seedJobs,
  testCriteria,
  testProfile,
} from '../testing/fixtures.js';
import { fixedClock } from '../util/clock.js';
import { paletteJobs } from './palette.js';
import { scoringInputs } from './score.js';

const NOW = '2026-10-25T12:00:00.000Z';
let sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'];

afterEach(() => {
  sqlite?.close();
});

describe('paletteJobs', () => {
  it('returns the best scored jobs from anywhere, and skips one with an application', () => {
    const made = createMigratedTestDb();
    sqlite = made.sqlite;
    const db: Db = made.db;
    const clock = fixedClock(NOW);
    const criteria = testCriteria({ withPlaces: true });
    const key = scoringInputs(criteria, testProfile(), TEST_PREFERENCES).key;
    const ids = seedJobs(db, clock, [
      { title: 'Low, in Portland' },
      { title: 'High, elsewhere' },
      { title: 'Applied' },
    ]);
    const scores = scoresRepo(db, clock);
    const fills = [2, 5, 5];
    ids.forEach((id, i) => {
      db.update(jobs)
        .set({
          status: 'scored',
          scoreState: 'current',
          gateResult: { passed: true, gate: null, detail: null },
        })
        .where(eq(jobs.id, id))
        .run();
      const output = scoreOutput({}, fills[i] ?? 0);
      scores.insert({
        jobId: id,
        contentHash: `hash-Acme-${i}`,
        ...key,
        dimensions: output.dimensions,
        summary: 'A test job.',
        score: (fills[i] ?? 0) * 20,
        verdict: (fills[i] ?? 0) >= 4 ? 'strong' : 'no',
        redFlags: [],
      });
    });
    areasRepo(db).replace([
      { jobId: ids[0] ?? 0, areas: ['portland'] },
      { jobId: ids[1] ?? 0, areas: [] },
      { jobId: ids[2] ?? 0, areas: ['remote'] },
    ]);
    applicationsRepo(db, clock).upsertForJob({ jobId: ids[2] ?? 0, status: 'prepped' });

    const rows = paletteJobs(db, clock, {
      key,
      weights: criteria.weights,
      bands: criteria.bands,
    });
    expect(rows.map((row) => row.title)).toEqual(['High, elsewhere', 'Low, in Portland']);
    expect(rows[0]?.areas).toEqual([]);
    expect(rows[1]?.areas).toEqual(['portland']);
    expect(rows[0]?.score).toBeGreaterThan(rows[1]?.score ?? 0);
  });
});
