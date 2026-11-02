import { ConfigError, loadAllConfig } from '../../core/config/load.js';
import { LEGACY_SOURCES } from '../../core/config/schemas.js';
import { discoverBoards } from '../../core/sources/discover.js';
import { createHttp } from '../../core/util/http.js';
import { createLogger } from '../../core/util/logger.js';

/** `boards:discover --seed <file>` — probe ATSs and append live boards. */
export async function boardsDiscover(options: { seed: string }): Promise<void> {
  if (!options.seed) {
    console.error('boards:discover FAILED\n\n--seed <file> is required');
    process.exitCode = 1;
    return;
  }
  try {
    const config = loadAllConfig();
    const sources = config.criteria.sources ?? LEGACY_SOURCES;
    const started = Date.now();
    const stats = await discoverBoards({
      seedPath: options.seed,
      http: createHttp({ timeoutMs: 8_000, maxTries: 1 }),
      log: createLogger(),
      enabled: sources.boards.enabled,
      keys: {
        workable: process.env.WORKABLE_API_KEY,
        teamtailor: process.env.TEAMTAILOR_API_KEY,
      },
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      [
        `discover: ${stats.added} added, ${stats.already} already listed, ${stats.misses} misses, ${stats.empty} empty, ${stats.cached} cached, ${stats.errors} errors`,
        `  lines: ${stats.lines}`,
        `  probed: ${stats.probed}`,
        `  wall: ${seconds}s`,
      ].join('\n'),
    );
    if (stats.errors > 0 && stats.added === 0 && stats.already === 0) process.exitCode = 1;
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`boards:discover FAILED\n\n${err.message}`);
      process.exitCode = 1;
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`boards:discover FAILED\n\n${message}`);
    process.exitCode = 1;
  }
}
