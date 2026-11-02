import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../util/clock.js';
import { backupDatabase, backupTimestamp } from './backup.js';
import { createMigratedTestDb } from './client.js';

let sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'];
let dir: string | undefined;

afterEach(() => {
  sqlite?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('backupTimestamp', () => {
  it('produces a filesystem-safe stamp without colons or milliseconds', () => {
    expect(backupTimestamp('2026-10-23T01:16:00.123Z')).toBe('2026-10-23T011600Z');
  });
});

describe('backupDatabase', () => {
  it('writes a timestamped copy that opens as a valid database', async () => {
    const made = createMigratedTestDb();
    sqlite = made.sqlite;
    dir = mkdtempSync(join(tmpdir(), 'jobhacker-backup-'));
    const clock = fixedClock('2026-10-23T01:16:00.000Z');

    const { path } = await backupDatabase({ sqlite, destDir: dir, clock });
    expect(path).toBe(join(dir, 'jobhacker-2026-10-23T011600Z.db'));
    expect(existsSync(path)).toBe(true);

    // The copy opens and has the migrated schema.
    const copy = new Database(path, { readonly: true });
    try {
      const tables = copy
        .prepare("select name from sqlite_master where type='table'")
        .all()
        .map((r) => (r as { name: string }).name);
      expect(tables).toContain('applications');
      expect(tables).toContain('jobs');
    } finally {
      copy.close();
    }
  });
});
