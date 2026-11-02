import { loadAllConfig } from '../../core/config/load.js';
import { createDb } from '../../core/db/client.js';
import { computeFunnel, renderFunnel } from '../../core/pipeline/funnel.js';
import { reconcilePlacement } from '../../core/pipeline/reconcile.js';
import { scoringInputs } from '../../core/pipeline/score.js';
import { systemClock } from '../../core/util/clock.js';
import { reportCliError } from '../errors.js';

/**
 * `funnel` (FR-11) — where every job is. Re-applies the gates and prescores
 * from the current config first (cheap, no LLM), so an edited criteria.yaml
 * or preferences.md shows its effect immediately.
 */
export function funnelCommand(): void {
  let sqlite: ReturnType<typeof createDb>['sqlite'] | undefined;
  try {
    const config = loadAllConfig();
    const opened = createDb();
    sqlite = opened.sqlite;
    reconcilePlacement(opened.db, config.criteria, config.preferences, systemClock);
    const { key } = scoringInputs(config.criteria, config.profile, config.preferences);
    console.log(renderFunnel(computeFunnel(opened.db, systemClock, config.criteria, key)));
  } catch (err) {
    reportCliError('funnel', err);
  } finally {
    sqlite?.close();
  }
}
