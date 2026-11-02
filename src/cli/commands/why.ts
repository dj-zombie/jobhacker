import { loadAllConfig } from '../../core/config/load.js';
import { createDb } from '../../core/db/client.js';
import { reconcilePlacement } from '../../core/pipeline/reconcile.js';
import { scoringInputs } from '../../core/pipeline/score.js';
import { explainJob, renderWhy } from '../../core/pipeline/why.js';
import { systemClock } from '../../core/util/clock.js';
import { reportCliError } from '../errors.js';

/** `why <jobId>` (FR-11) — gate, prescore, every dimension with weight and reason. No LLM calls. */
export function whyCommand(rawId: string): void {
  const jobId = Number(rawId);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    console.error('why FAILED\n\n<jobId> must be a positive integer');
    process.exitCode = 1;
    return;
  }
  let sqlite: ReturnType<typeof createDb>['sqlite'] | undefined;
  try {
    const config = loadAllConfig();
    const { key } = scoringInputs(config.criteria, config.profile, config.preferences);
    const opened = createDb();
    sqlite = opened.sqlite;
    reconcilePlacement(opened.db, config.criteria, config.preferences, systemClock);
    const report = explainJob(opened.db, systemClock, jobId, {
      criteria: config.criteria,
      current: key,
      preferences: config.preferences,
    });
    if (!report) {
      console.error(`why FAILED\n\njob ${jobId} not found`);
      process.exitCode = 1;
      return;
    }
    console.log(renderWhy(report));
  } catch (err) {
    reportCliError('why', err);
  } finally {
    sqlite?.close();
  }
}
