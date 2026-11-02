import { DEFAULT_CONFIG_DIR } from '../../core/config/load.js';
import { runConfigMigrate } from '../../core/config/migrate.js';
import { systemClock } from '../../core/util/clock.js';
import { reportCliError } from '../errors.js';

/**
 * `config:migrate [--force]` — convert a v1 keyword-list criteria.yaml to v2
 * and draft preferences.md from it (PHASE2 P2-1). The draft is printed so it
 * can be read and edited; `--force` overwrites an existing preferences.md.
 */
export function configMigrateCommand(options: { force?: boolean; dir?: string } = {}): void {
  try {
    const result = runConfigMigrate(options.dir ?? DEFAULT_CONFIG_DIR, {
      force: options.force,
      date: systemClock.now().slice(0, 10),
    });
    if (result.status === 'already-v2') {
      console.log(`${result.criteriaFile} is already in the v2 format; nothing to migrate.`);
      return;
    }
    console.log('config migrated');
    console.log(`  kept the v1 file as  ${result.backupFile}`);
    console.log(`  wrote v2 criteria to ${result.criteriaFile}`);
    if (result.wrotePreferences) {
      console.log(`  drafted              ${result.preferencesFile}  (edit it as prose)`);
      console.log(`\n----- ${result.preferencesFile} -----\n${result.preferences ?? ''}`);
    } else {
      console.log(
        `  left ${result.preferencesFile} as it was (it already exists; re-run with --force to overwrite)`,
      );
    }
  } catch (err) {
    reportCliError('config:migrate', err);
  }
}
