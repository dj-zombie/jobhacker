import { loadAllConfig } from '../../core/config/load.js';
import { createDb } from '../../core/db/client.js';
import { createAnthropicLlm } from '../../core/llm/anthropic.js';
import { type LlmClient, LlmError } from '../../core/llm/types.js';
import { formatEmployerRun, nameEmployers } from '../../core/pipeline/employer-names.js';
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
 * `search:employers [--limit n]` — read the employer from the posting text of
 * each search job stored under a placeholder ("Remote", "Confidential"), one
 * model call each. `--limit 0` makes no call.
 */
export async function searchEmployersCommand(options: { limit?: string } = {}): Promise<void> {
  const raw = options.limit;
  const limit = raw == null ? undefined : Number(raw);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
    console.error('search:employers FAILED\n\n--limit must be a non-negative integer');
    process.exitCode = 1;
    return;
  }
  let sqlite: ReturnType<typeof createDb>['sqlite'] | undefined;
  try {
    const config = loadAllConfig();
    const llm = limit === 0 ? noCalls : createAnthropicLlm();
    const opened = createDb();
    sqlite = opened.sqlite;
    const result = await nameEmployers({
      db: opened.db,
      llm,
      clock: systemClock,
      log: createLogger(),
      criteria: config.criteria,
      ...(limit === undefined ? {} : { limit }),
    });
    console.log(formatEmployerRun(result));
  } catch (err) {
    reportCliError('search:employers', err);
  } finally {
    sqlite?.close();
  }
}
