import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createLogger } from '../util/logger.js';
import { moveLegacyDb } from '../util/rename-move.js';
import { schema } from './schema.js';

export type Db = ReturnType<typeof createDb>['db'];

const BUILT_IN_DB_PATH = './data/jobhacker.db';
export const DEFAULT_DB_PATH = process.env.DATABASE_PATH ?? BUILT_IN_DB_PATH;
export const MIGRATIONS_DIR = 'drizzle';

/** On the built-in path, finish the one-time move from the pre-JobHacker file first (J2). */
function moveLegacyIfDefault(path: string): void {
  if (path === BUILT_IN_DB_PATH) moveLegacyDb(path, (message) => createLogger().info(message));
}

/**
 * Open the SQLite database with the required pragmas and return a Drizzle
 * client plus the raw connection. Pass `':memory:'` for tests.
 *
 * Pragmas (ARCHITECTURE § Stack):
 *  - `journal_mode = WAL` for concurrent reads during a write.
 *  - `foreign_keys = ON` so cascades and references are enforced.
 */
export function createDb(path: string = DEFAULT_DB_PATH) {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
    moveLegacyIfDefault(path);
  }

  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

/**
 * Open an existing database file read-only, for commands that must never
 * write (`stats`). SQLite itself rejects any write on this connection.
 */
export function openDbReadonly(path: string = DEFAULT_DB_PATH) {
  moveLegacyIfDefault(path);
  const sqlite = new Database(path, { readonly: true, fileMustExist: true });
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

/**
 * Open an existing database file for reading and writing, never creating one. The UI uses this,
 * so a missing or moved database shows an error state instead of a new empty file.
 */
export function openExistingDb(path: string = DEFAULT_DB_PATH) {
  moveLegacyIfDefault(path);
  const sqlite = new Database(path, { fileMustExist: true });
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

/** Apply all pending migrations from the `drizzle/` folder. */
export function migrateDb(db: Db, migrationsFolder: string = MIGRATIONS_DIR): void {
  drizzleMigrate(db, { migrationsFolder });
}

/**
 * Convenience for tests: an in-memory database with migrations applied.
 */
export function createMigratedTestDb(migrationsFolder: string = MIGRATIONS_DIR) {
  const { db, sqlite } = createDb(':memory:');
  migrateDb(db, migrationsFolder);
  return { db, sqlite };
}
