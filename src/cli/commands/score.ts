import { loadAllConfig } from '../../core/config/load.js';
import { createDb } from '../../core/db/client.js';
import { runsRepo } from '../../core/db/repo/runs.js';
import { createAnthropicLlm } from '../../core/llm/anthropic.js';
import { type LlmClient, LlmError } from '../../core/llm/types.js';
import { whereDefault } from '../../core/pipeline/areas.js';
import {
  ScoreBusyError,
  formatScorePlan,
  requestScoreStop,
  runScoreBatch,
  scorePace,
  scoreRunState,
  startScoreRun,
} from '../../core/pipeline/score-run.js';
import type { ScoreStats } from '../../core/pipeline/score.js';
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

/** An explicit run with no numeric cap. The queue, not this number, is the limit. */
const NO_CAP = Number.MAX_SAFE_INTEGER;

/**
 * `score [--limit n] [--places] [--all]` — re-apply gates and prescore, then
 * LLM-score gate-survivors. With no flags, the cap is `max_new_scores_per_run`.
 * `--limit n` is this run's cap and may be higher. `--places` scores only the
 * default places. `--all` scores every job still waiting. `--limit 0` makes no
 * LLM calls. Ctrl-C finishes calls already sent and starts no more.
 */
export async function scoreCommand(
  options: { limit?: string; places?: boolean; all?: boolean } = {},
): Promise<void> {
  const parsed = parseLimit(options.limit);
  if (parsed === 'invalid') {
    console.error('score FAILED\n\n--limit must be a non-negative integer');
    process.exitCode = 1;
    return;
  }

  const limit = parsed !== 'none' ? parsed : options.all || options.places ? NO_CAP : undefined;

  let sqlite: ReturnType<typeof createDb>['sqlite'] | undefined;
  let onSigint: (() => void) | undefined;
  try {
    const config = loadAllConfig();
    const llm = limit === 0 ? noCalls : createAnthropicLlm();
    const opened = createDb();
    sqlite = opened.sqlite;
    const db = opened.db;
    const pace = scorePace(db, systemClock, config.criteria.llm.scoring_model);
    let announced = false;
    const runId = startScoreRun(db, systemClock, {
      first: whereDefault(config.criteria),
      ...(limit != null ? { limit } : {}),
      ...(options.places ? { onlyFirst: true } : {}),
    });
    onSigint = () => {
      if (scoreRunState(db, systemClock, runId)?.stop) {
        console.error('\nstopping now');
        process.exit(130);
      }
      requestScoreStop(db, systemClock, runId);
      console.error('\nStopping after the jobs already sent. Press Ctrl-C again to quit now.');
    };
    process.on('SIGINT', onSigint);
    await runScoreBatch(runId, {
      db,
      llm,
      clock: systemClock,
      log: createLogger(),
      criteria: config.criteria,
      profile: config.profile,
      preferences: config.preferences,
      onProgress: (progress) => {
        if (announced) return;
        announced = true;
        console.log(`score run ${runId}: ${formatScorePlan(progress.total, pace)}`);
      },
    });
    const state = scoreRunState(db, systemClock, runId);
    if (state?.ok === false) {
      console.error(`score FAILED\n\n${state.error ?? 'the run failed'}`);
      process.exitCode = 1;
      return;
    }
    if (state?.stop) console.log('stopped');
    console.log(`score run ${runId}: ok`);
    const stats = runsRepo(db, systemClock).get(runId)?.stats;
    if (isScoreStats(stats)) {
      console.log(`  ${formatGateSummary(stats.gates)}`);
      console.log(`  prescored: ${stats.prescored}`);
      console.log(`  ${formatScoreSummary(stats)}`);
    }
  } catch (err) {
    if (err instanceof ScoreBusyError) {
      console.error(`score FAILED\n\n${err.message}`);
      process.exitCode = 1;
      return;
    }
    reportCliError('score', err);
  } finally {
    if (onSigint) process.off('SIGINT', onSigint);
    sqlite?.close();
  }
}

function parseLimit(raw: string | undefined): number | 'none' | 'invalid' {
  if (raw == null) return 'none';
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return 'invalid';
  return n;
}

function isScoreStats(stats: unknown): stats is ScoreStats {
  if (!stats || typeof stats !== 'object') return false;
  const row = stats as Partial<ScoreStats>;
  return row.gates != null && typeof row.prescored === 'number' && typeof row.scored === 'number';
}
