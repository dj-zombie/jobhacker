import { ConfigError } from '../core/config/errors.js';
import { LlmError } from '../core/llm/types.js';

/**
 * Print a known failure (bad config, LLM setup, un-migrated DB) as a clean
 * message and set exit code 1. Anything else is rethrown so its stack shows.
 */
export function reportCliError(command: string, err: unknown): void {
  if (err instanceof ConfigError || err instanceof LlmError) {
    console.error(`${command} FAILED\n\n${err.message}`);
    process.exitCode = 1;
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/no such table|no such column/i.test(message)) {
    console.error(`${message}\nDatabase is not migrated. Run \`pnpm cli db:migrate\` first.`);
    process.exitCode = 1;
    return;
  }
  throw err;
}
