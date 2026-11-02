import { loadAllConfig } from '../../core/config/load.js';
import { createDb } from '../../core/db/client.js';
import { runsRepo } from '../../core/db/repo/runs.js';
import { createAnthropicLlm } from '../../core/llm/anthropic.js';
import { type LlmClient, LlmError } from '../../core/llm/types.js';
import { finishWithProgress, trackScoreRun } from '../../core/pipeline/score-run.js';
import { scoreNewJobs } from '../../core/pipeline/score.js';
import { formatGateSummary, formatScoreSummary } from '../../core/pipeline/scout.js';
import { systemClock } from '../../core/util/clock.js';
import { createLogger } from '../../core/util/logger.js';
import { reportCliError } from '../errors.js';

/** Stands in for the model on `--limit 0`, so a gate/prescore pass needs no API key. */
const noCalls: LlmClient = {
  structured() {
    return Promise.reject(new LlmError('no LLM calls are allowed with --limit 0'));
  },
};

/**
 * `score [--limit n]` — re-apply gates and prescore, then LLM-score the
 * gate-survivors in prescore order up to the per-run cap, without re-fetching
 * boards. `--limit 0` makes no LLM calls. Wrapped in a `score` run for bookkeeping.
 */
export async function scoreCommand(options: { limit?: string } = {}): Promise<void> {
  const limit = parseLimit(options.limit);
  if (limit === 'invalid') {
    console.error('score FAILED\n\n--limit must be a non-negative integer');
    process.exitCode = 1;
    return;
  }

  let sqlite: ReturnType<typeof createDb>['sqlite'] | undefined;
  try {
    const config = loadAllConfig();
    const llm = limit === 0 ? noCalls : createAnthropicLlm();
    const opened = createDb();
    sqlite = opened.sqlite;
    const runs = runsRepo(opened.db, systemClock);
    const runId = runs.start('score');
    try {
      const { stats } = await scoreNewJobs({
        db: opened.db,
        llm,
        clock: systemClock,
        log: createLogger(),
        criteria: config.criteria,
        profile: config.profile,
        preferences: config.preferences,
        limit: limit === 'none' ? undefined : limit,
        onProgress: trackScoreRun(opened.db, systemClock, runId),
      });
      finishWithProgress(opened.db, systemClock, runId, { ok: true, stats });
      console.log(`score run ${runId}: ok`);
      console.log(`  ${formatGateSummary(stats.gates)}`);
      console.log(`  prescored: ${stats.prescored}`);
      console.log(`  ${formatScoreSummary(stats)}`);
    } catch (err) {
      runs.finish(runId, { ok: false, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  } catch (err) {
    reportCliError('score', err);
  } finally {
    sqlite?.close();
  }
}

function parseLimit(raw: string | undefined): number | 'none' | 'invalid' {
  if (raw == null) return 'none';
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return 'invalid';
  return n;
}
