import { loadAllConfig } from '../../core/config/load.js';
import { openDbReadonly } from '../../core/db/client.js';
import { scoringInputs } from '../../core/pipeline/score.js';
import { computeStats, renderStats } from '../../core/pipeline/stats.js';
import { systemClock } from '../../core/util/clock.js';
import { reportCliError } from '../errors.js';

/**
 * `stats` — the usefulness snapshot (AGENTS § The usefulness snapshot). Opens
 * the database read-only, so unlike `funnel` it doesn't re-apply the gates
 * first: it reports what's stored. No network, no model, no Chrome.
 */
export function statsCommand(): void {
  let sqlite: ReturnType<typeof openDbReadonly>['sqlite'] | undefined;
  try {
    const config = loadAllConfig();
    const opened = openDbReadonly();
    sqlite = opened.sqlite;
    const { key } = scoringInputs(config.criteria, config.profile, config.preferences);
    const stats = computeStats({
      db: opened.db,
      clock: systemClock,
      criteria: config.criteria,
      current: key,
    });
    console.log(renderStats(stats));
  } catch (err) {
    reportCliError('stats', err);
  } finally {
    sqlite?.close();
  }
}
