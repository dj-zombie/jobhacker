import { backupDatabase } from '../../core/db/backup.js';
import { DEFAULT_DB_PATH, createDb } from '../../core/db/client.js';
import { systemClock } from '../../core/util/clock.js';

/** Default directory for timestamped database backups. */
export const DEFAULT_BACKUP_DIR = process.env.JOBHACKER_BACKUP_DIR ?? './data/backups';

/**
 * `backup` — copy the database to a timestamped file under `data/backups/`
 * (FR-9 "A backup is one file copy"). Uses SQLite's online backup, so it is safe
 * to run while the app is in use.
 */
export async function backupCommand(): Promise<void> {
  const { sqlite } = createDb();
  try {
    const { path } = await backupDatabase({
      sqlite,
      destDir: DEFAULT_BACKUP_DIR,
      clock: systemClock,
    });
    console.log(`backup ok\n  from: ${DEFAULT_DB_PATH}\n  to:   ${path}`);
  } finally {
    sqlite.close();
  }
}
