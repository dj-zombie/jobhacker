import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { criteriaSchema } from '../config/schemas.js';
import { createMigratedTestDb } from '../db/client.js';
import { areasRepo } from '../db/repo/areas.js';
import { jobs } from '../db/schema.js';
import { seedJobs, testCriteria } from '../testing/fixtures.js';
import { fixedClock } from '../util/clock.js';
import {
  applyAreas,
  areaCounts,
  locationFact,
  parseWhere,
  placesConfigFrom,
  whereLabel,
} from './areas.js';
import { DEFAULT_PLACES } from './places.js';

const CRITERIA = testCriteria({ withPlaces: true });
const clock = fixedClock('2026-10-25T12:00:00.000Z');

let sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'] | undefined;

afterEach(() => {
  sqlite?.close();
  sqlite = undefined;
});

describe('placesConfigFrom', () => {
  it('loads criteria.example.yaml to exactly DEFAULT_PLACES', () => {
    const text = readFileSync(join('config', 'criteria.example.yaml'), 'utf8');
    const example = criteriaSchema.parse(parseYaml(text));
    expect(placesConfigFrom(example)).toEqual(DEFAULT_PLACES);
    expect(example.where_default).toEqual(['portland', 'phoenix', 'remote']);
  });

  it('has no places and no remote countries when the blocks are absent', () => {
    expect(placesConfigFrom(testCriteria())).toEqual({ places: [], remoteCountries: [] });
  });
});

describe('criteria places schema', () => {
  const base = { ...testCriteria(), places: DEFAULT_PLACES.places };

  it('rejects a where_default that names no place', () => {
    const result = criteriaSchema.safeParse({ ...base, where_default: ['portland', 'seattle'] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['where_default', 1]);
  });

  it('rejects reserved and duplicate place ids', () => {
    const portland = DEFAULT_PLACES.places[0];
    if (!portland) throw new Error('no portland');
    const places = [portland, portland, { ...portland, id: 'anywhere' }];
    const result = criteriaSchema.safeParse({ ...base, places });
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      'duplicate place id "portland"',
      `"anywhere" is reserved and can't be a place id`,
    ]);
  });
});

describe('parseWhere', () => {
  it('returns ids in config order, and [] for anywhere', () => {
    expect(parseWhere('remote,portland', CRITERIA)).toEqual(['portland', 'remote']);
    expect(parseWhere('anywhere', CRITERIA)).toEqual([]);
    expect(whereLabel(CRITERIA, ['portland', 'phoenix', 'remote'])).toBe(
      'Portland, Phoenix or Remote',
    );
  });

  it('throws on an unknown area instead of matching nothing', () => {
    expect(() => parseWhere('portlnd', CRITERIA)).toThrow(/unknown area "portlnd"/);
    expect(() => parseWhere('anywhere,remote', CRITERIA)).toThrow();
  });
});

describe('locationFact', () => {
  it('names the place and the text that matched, or says none', () => {
    const job = { title: 'Engineer', remoteType: 'onsite' as const };
    expect(locationFact({ ...job, locationRaw: 'Portland, OR' }, CRITERIA)).toBe(
      'Location classified as: Portland area (matched "Portland, OR")',
    );
    expect(
      locationFact({ ...job, locationRaw: 'Remote - US', remoteType: 'remote' }, CRITERIA),
    ).toBe('Location classified as: Remote (US)');
    expect(locationFact({ ...job, locationRaw: 'Toronto, ON' }, CRITERIA)).toBe(
      `Location classified as: none of the candidate's places ("Toronto, ON")`,
    );
  });
});

describe('applyAreas', () => {
  it('stores each job’s areas, counts them, and rewrites only what changed', () => {
    const opened = createMigratedTestDb();
    sqlite = opened.sqlite;
    const ids = seedJobs(opened.db, clock, [
      { title: 'A', locationRaw: 'Portland, OR', remoteType: 'onsite' },
      { title: 'B', locationRaw: 'Portland, OR; Remote - US', remoteType: 'hybrid' },
      { title: 'C', locationRaw: 'Toronto, ON', remoteType: 'onsite' },
      { title: 'D', locationRaw: 'Tempe, AZ', remoteType: 'onsite' },
    ]);

    expect(applyAreas(opened.db, CRITERIA)).toEqual({ jobs: 4, changed: 3 });
    const repo = areasRepo(opened.db);
    expect(repo.forJob(ids[1] ?? 0).sort()).toEqual(['portland', 'remote']);
    expect(repo.forJob(ids[2] ?? 0)).toEqual([]);
    expect(applyAreas(opened.db, CRITERIA)).toEqual({ jobs: 4, changed: 0 });

    const counts = areaCounts(opened.db, CRITERIA).map((c) => [c.area, c.total]);
    expect(counts).toEqual([
      ['portland', 2],
      ['phoenix', 1],
      ['remote', 1],
      ['none', 1],
    ]);

    // Without places, every job is "none" — and still stored (invariant 8).
    expect(applyAreas(opened.db, testCriteria())).toEqual({ jobs: 4, changed: 3 });
    expect(opened.db.select().from(jobs).all()).toHaveLength(4);
  });
});
