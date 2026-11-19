import { loadAllConfig } from '../../core/config/load.js';
import { createDb } from '../../core/db/client.js';
import { createAnthropicLlm } from '../../core/llm/anthropic.js';
import { type LlmClient, LlmError } from '../../core/llm/types.js';
import { classifyIndustries, industriesOf } from '../../core/pipeline/industry.js';
import { systemClock } from '../../core/util/clock.js';
import { createLogger } from '../../core/util/logger.js';
import { reportCliError } from '../errors.js';

/** Stands in for the model on `--limit 0`, so a count of the queue needs no API key. */
const noCalls: LlmClient = {
  structured() {
    return Promise.reject(new LlmError('no LLM calls are allowed with --limit 0'));
  },
};

/**
 * `industries [--limit n]` — suggest one industry per company from its name and
 * the roles it posts. `--limit 0` makes no model call. Kris's confirm or clear
 * is never overwritten.
 */
export async function industriesCommand(options: { limit?: string } = {}): Promise<void> {
  const limit = parseLimit(options.limit);
  if (limit === 'invalid') {
    console.error('industries FAILED\n\n--limit must be a non-negative integer');
    process.exitCode = 1;
    return;
  }

  let sqlite: ReturnType<typeof createDb>['sqlite'] | undefined;
  try {
    const config = loadAllConfig();
    const industries = industriesOf(config.criteria);
    if (industries.length === 0) {
      console.log('industries: none configured in criteria.yaml');
      return;
    }
    const llm = limit === 0 ? noCalls : createAnthropicLlm();
    const opened = createDb();
    sqlite = opened.sqlite;
    const stats = await classifyIndustries({
      db: opened.db,
      llm,
      clock: systemClock,
      log: createLogger(),
      criteria: config.criteria,
      preferences: config.preferences,
      limit: limit === 'none' ? undefined : limit,
    });
    const suggested = industries
      .map((industry) => `${industry.id} ${stats.byIndustry[industry.id] ?? 0}`)
      .join(' · ');
    console.log(
      `industries: ${stats.classified} classified · ${stats.none} none · ${stats.errors} errors · ${stats.waiting} waiting`,
    );
    console.log(`  ${suggested}`);
    console.log(`  skipped: ${stats.decided} decided · ${stats.unchanged} unchanged`);
    console.log(`  calls ${stats.calls} · est $${stats.estimated_usd.toFixed(4)}`);
  } catch (err) {
    reportCliError('industries', err);
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
