import { afterEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../../util/clock.js';
import { createMigratedTestDb } from '../client.js';
import { companiesRepo } from './companies.js';

let sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'];

afterEach(() => {
  sqlite?.close();
});

describe('companiesRepo.deactivateMissing (Known issue [1])', () => {
  it('deactivates active boards not in the keep list and leaves the rest', () => {
    const made = createMigratedTestDb();
    sqlite = made.sqlite;
    const clock = fixedClock('2026-10-23T00:00:00.000Z');
    const repo = companiesRepo(made.db, clock);

    repo.upsert({ name: 'A', ats: 'greenhouse', token: 'a', active: true, tags: [] });
    repo.upsert({ name: 'B', ats: 'lever', token: 'b', active: true, tags: [] });
    repo.upsert({ name: 'C', ats: 'ashby', token: 'c', active: false, tags: [] });

    // Keep only A; B should be deactivated, C is already inactive (not counted).
    const count = repo.deactivateMissing([{ ats: 'greenhouse', token: 'a' }]);
    expect(count).toBe(1);
    expect(repo.get('greenhouse', 'a')?.active).toBe(true);
    expect(repo.get('lever', 'b')?.active).toBe(false);
    expect(repo.get('ashby', 'c')?.active).toBe(false);
  });

  it('leaves search-source companies active even though they are not in companies.yaml', () => {
    const made = createMigratedTestDb();
    sqlite = made.sqlite;
    const repo = companiesRepo(made.db, fixedClock('2026-10-23T00:00:00.000Z'));
    repo.upsert({ name: 'Example', ats: 'hn', token: 'example', active: true, tags: ['search'] });
    repo.upsert({
      name: 'Example',
      ats: 'jsearch',
      token: 'example',
      active: true,
      tags: ['search'],
    });
    expect(repo.deactivateMissing([])).toBe(0);
    expect(repo.get('hn', 'example')?.active).toBe(true);
    expect(repo.get('jsearch', 'example')?.active).toBe(true);
  });
});
