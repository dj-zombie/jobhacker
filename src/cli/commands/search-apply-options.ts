import { ConfigError, loadAllConfig } from '../../core/config/load.js';
import { LEGACY_SOURCES } from '../../core/config/schemas.js';
import { createDb } from '../../core/db/client.js';
import { backfillApplyOptions, formatBackfill } from '../../core/pipeline/apply-backfill.js';
import { systemClock } from '../../core/util/clock.js';
import { createHttp } from '../../core/util/http.js';
import { createLogger } from '../../core/util/logger.js';

/**
 * `search:apply-options [--max n]` — fetch JSearch's job details for the
 * shortlisted or prepped search jobs stored without apply options, and
 * re-rank their apply URL (J29). One call per job, charged to the JSearch
 * budget first; it stops at the budget.
 */
export async function searchApplyOptions(opts: { max: string }): Promise<void> {
  const max = Number(opts.max);
  if (!Number.isInteger(max) || max <= 0) {
    console.error('search:apply-options FAILED\n\n--max must be a positive integer');
    process.exitCode = 1;
    return;
  }
  const key = process.env.JSEARCH_API_KEY;
  if (!key) {
    console.error('search:apply-options FAILED\n\nJSEARCH_API_KEY is not set');
    process.exitCode = 1;
    return;
  }
  let sqlite: ReturnType<typeof createDb>['sqlite'] | undefined;
  try {
    const config = loadAllConfig();
    const sources = config.criteria.sources ?? LEGACY_SOURCES;
    if (!sources.search.jsearch.enabled) {
      console.log('search:apply-options: JSearch is disabled in criteria.yaml; nothing fetched');
      return;
    }
    const opened = createDb();
    sqlite = opened.sqlite;
    const result = await backfillApplyOptions(
      {
        db: opened.db,
        http: createHttp(),
        clock: systemClock,
        log: createLogger(),
        key,
        budget: sources.search.jsearch.monthly_call_budget,
      },
      { max },
    );
    console.log(formatBackfill(result));
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`search:apply-options FAILED\n\n${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  } finally {
    sqlite?.close();
  }
}
