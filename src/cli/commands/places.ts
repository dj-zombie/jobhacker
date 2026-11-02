import { loadConfigFile } from '../../core/config/load.js';
import { criteriaSchema } from '../../core/config/schemas.js';
import { createDb } from '../../core/db/client.js';
import { applyAreas, areaCounts, whereDefault } from '../../core/pipeline/areas.js';
import { reportCliError } from '../errors.js';

/**
 * `places:reclassify` (PLACES § 4) — classify every job's places from the
 * current `criteria.yaml` and print the counts per area. Scout does the same
 * on every run; use this after editing `places`. No network, no model.
 */
export function placesReclassifyCommand(): void {
  let sqlite: ReturnType<typeof createDb>['sqlite'] | undefined;
  try {
    const criteria = loadConfigFile('criteria', criteriaSchema);
    const opened = createDb();
    sqlite = opened.sqlite;
    const started = performance.now();
    const result = applyAreas(opened.db, criteria);
    const ms = Math.round(performance.now() - started);
    console.log(`classified ${result.jobs} jobs in ${ms} ms; ${result.changed} changed`);
    const counts = areaCounts(opened.db, criteria);
    const width = Math.max(...counts.map((c) => c.area.length));
    console.log(
      `  ${'area'.padEnd(width)}  ${'all jobs'.padStart(8)}  ${'past gates'.padStart(10)}`,
    );
    for (const row of counts) {
      console.log(
        `  ${row.area.padEnd(width)}  ${String(row.total).padStart(8)}  ${String(row.visible).padStart(10)}`,
      );
    }
    console.log(
      `  (a job in two areas counts in both; where_default: ${whereDefault(criteria).join(', ') || 'anywhere'})`,
    );
  } catch (err) {
    reportCliError('places:reclassify', err);
  } finally {
    sqlite?.close();
  }
}
