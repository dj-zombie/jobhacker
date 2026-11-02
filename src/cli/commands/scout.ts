import { ConfigError, loadAllConfig } from '../../core/config/load.js';
import { createDb } from '../../core/db/client.js';
import { createAnthropicLlm } from '../../core/llm/anthropic.js';
import { LlmError } from '../../core/llm/types.js';
import {
  type ScoutScoringDeps,
  formatScoutSummary,
  runScout,
  sourceKeysFromEnv,
} from '../../core/pipeline/scout.js';
import { systemClock } from '../../core/util/clock.js';
import { createHttp } from '../../core/util/http.js';
import { createLogger } from '../../core/util/logger.js';

/**
 * `scout` — fetch active boards, upsert jobs, gate and prescore them, and
 * (unless `--no-score`) LLM-score the survivors with the configured model.
 */
export async function scoutCommand(options: { score?: boolean } = {}): Promise<void> {
  let sqlite: ReturnType<typeof createDb>['sqlite'] | undefined;
  try {
    const config = loadAllConfig();

    let scoring: ScoutScoringDeps | undefined;
    if (options.score !== false) {
      scoring = { llm: createAnthropicLlm(), profile: config.profile };
    }

    const opened = createDb();
    sqlite = opened.sqlite;
    const result = await runScout({
      db: opened.db,
      http: createHttp(),
      clock: systemClock,
      log: createLogger(),
      companies: config.companies.companies,
      criteria: config.criteria,
      preferences: config.preferences,
      scoring,
      sourceKeys: sourceKeysFromEnv(process.env),
    });
    console.log(formatScoutSummary(result));
    if (!result.ok) process.exitCode = 1;
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error('scout FAILED\n');
      console.error(err.message);
      process.exitCode = 1;
      return;
    }
    if (err instanceof LlmError) {
      console.error(`scout FAILED\n\n${err.message}`);
      process.exitCode = 1;
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (/no such table/i.test(message)) {
      console.error(`${message}\nDatabase is not migrated. Run \`pnpm cli db:migrate\` first.`);
      process.exitCode = 1;
      return;
    }
    throw err;
  } finally {
    sqlite?.close();
  }
}
