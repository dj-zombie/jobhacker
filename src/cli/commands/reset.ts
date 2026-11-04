import { DEFAULT_BACKUP_DIR } from '../../core/db/backup.js';
import { createDb } from '../../core/db/client.js';
import { applyReset, assertResetIdle, formatResetPlan, planReset } from '../../core/db/reset.js';
import { systemClock } from '../../core/util/clock.js';

/**
 * `reset` prints the plan and writes nothing. `reset --yes` backs up, then applies it.
 * Either one exits 1, having written nothing, while a scout or score run is live.
 */
export async function resetCommand(options: { yes?: boolean }): Promise<void> {
  const { db, sqlite } = createDb();
  try {
    await assertResetIdle(db, systemClock);
    if (!options.yes) {
      console.log(`reset (dry run, nothing written)\n${formatResetPlan(planReset(db))}`);
      return;
    }
    const result = await applyReset({
      db,
      sqlite,
      destDir: DEFAULT_BACKUP_DIR,
      clock: systemClock,
    });
    console.log(
      `reset\n  backup  ${result.backupPath}\nbefore\n${formatResetPlan(result.before)}\nafter\n${formatResetPlan(result.after)}`,
    );
  } finally {
    sqlite.close();
  }
}
