import { createDb, migrateDb } from '../../core/db/client.js';
import { tableRowCounts } from '../../core/db/info.js';

/** `db:migrate` — apply all pending migrations to the configured database. */
export function dbMigrate(): void {
  const { db, sqlite } = createDb();
  try {
    migrateDb(db);
    console.log('migrations applied');
  } finally {
    sqlite.close();
  }
}

/** `db:info` — print each table and its row count. */
export function dbInfo(): void {
  const { sqlite } = createDb();
  try {
    const counts = tableRowCounts(sqlite);
    const width = Math.max(...counts.map((c) => c.table.length));
    console.log('table counts:');
    for (const { table, rows } of counts) {
      console.log(`  ${table.padEnd(width)}  ${rows}`);
    }
  } finally {
    sqlite.close();
  }
}
