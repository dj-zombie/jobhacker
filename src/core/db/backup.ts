import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type BetterSqlite3 from 'better-sqlite3';
import type { Clock } from '../util/clock.js';

/**
 * Database backup (FR-9 "A backup is one file copy"). Uses better-sqlite3's
 * online `backup()` API, which is safe to run while the database is in use
 * (WAL mode) — it produces a consistent copy without blocking writers. The copy
 * is written to `destDir/jobhacker-<timestamp>.db`.
 */

/** A filesystem-safe timestamp like `2026-10-23T011600Z` from an ISO string. */
export function backupTimestamp(iso: string): string {
  return iso
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[:]/g, '')
    .replace(/-/g, '-');
}

export interface BackupResult {
  path: string;
}

/**
 * Copy the open database to a timestamped file under `destDir`. Returns the
 * destination path. `sqlite` is the raw better-sqlite3 connection (from
 * `createDb`).
 */
export async function backupDatabase(options: {
  sqlite: BetterSqlite3.Database;
  destDir: string;
  clock: Clock;
}): Promise<BackupResult> {
  const { sqlite, destDir, clock } = options;
  mkdirSync(destDir, { recursive: true });
  const path = join(destDir, `jobhacker-${backupTimestamp(clock.now())}.db`);
  await sqlite.backup(path);
  return { path };
}
