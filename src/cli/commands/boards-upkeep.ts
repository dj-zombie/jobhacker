import { DEFAULT_CONFIG_DIR, loadAllConfig } from '../../core/config/load.js';
import { LEGACY_SOURCES } from '../../core/config/schemas.js';
import { createDb } from '../../core/db/client.js';
import { type UpkeepDeps, harvestStored, relocateLatestScout } from '../../core/pipeline/upkeep.js';
import { DEFAULT_CACHE_PATH } from '../../core/sources/discover.js';
import { formatHarvest } from '../../core/sources/harvest.js';
import { lookedLine } from '../../core/sources/relocate.js';
import { systemClock } from '../../core/util/clock.js';
import { createHttp } from '../../core/util/http.js';
import { createLogger } from '../../core/util/logger.js';

/** `boards:harvest` — probe every board stored search hits link to, with no per-run cap. */
export async function boardsHarvest(): Promise<void> {
  await withUpkeep('boards:harvest', async (deps, listed) => {
    const started = Date.now();
    const result = await harvestStored({ ...deps, listed });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const lines = [
      `harvest: ${formatHarvest(result.stats)}`,
      `  search hits read: ${result.hits}`,
      `  wall: ${seconds}s`,
    ];
    const unreadable = Object.entries(result.stats.unreadable_by_ats).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    lines.push(
      unreadable.length > 0
        ? `  unreadable links by ATS: ${unreadable.map(([ats, n]) => `${ats} ${n}`).join(' · ')}`
        : '  unreadable links by ATS: none',
    );
    for (const board of result.added) {
      lines.push(`  + ${board.ats}/${board.token} · ${board.postings} postings · ${board.name}`);
    }
    console.log(lines.join('\n'));
  });
}

/** `boards:relocate` — look for where each gone board in the latest finished scout moved. */
export async function boardsRelocate(): Promise<void> {
  await withUpkeep('boards:relocate', async (deps) => {
    const result = await relocateLatestScout({ ...deps, clock: systemClock });
    if (!result) {
      console.log('relocate: no finished scout yet');
      return;
    }
    const lines = [
      `relocate: scout run ${result.runId}, ${result.relocations.length} gone ${result.relocations.length === 1 ? 'board' : 'boards'}`,
    ];
    for (const r of result.relocations) {
      lines.push(`  ${r.name} (${r.ats}/${r.token})`);
      lines.push(`    ${lookedLine(r)}`);
      lines.push(
        `    search hits from a company named like it: ${r.matched_hits}; name tried on: ${r.looked.join(', ') || 'none'}`,
      );
      for (const c of r.candidates) {
        lines.push(`    - ${c.ats}/${c.token} · ${c.postings} postings · ${c.name} (via ${c.via})`);
      }
    }
    lines.push(`  written to run ${result.runId}'s stats, so the scout card shows it`);
    console.log(lines.join('\n'));
  });
}

async function withUpkeep(
  command: string,
  run: (
    deps: UpkeepDeps,
    listed: ReturnType<typeof loadAllConfig>['companies']['companies'],
  ) => Promise<void>,
): Promise<void> {
  let sqlite: ReturnType<typeof createDb>['sqlite'] | undefined;
  try {
    const config = loadAllConfig();
    const opened = createDb();
    sqlite = opened.sqlite;
    await run(
      {
        db: opened.db,
        http: createHttp(),
        log: createLogger(),
        dir: DEFAULT_CONFIG_DIR,
        cachePath: DEFAULT_CACHE_PATH,
        enabled: (config.criteria.sources ?? LEGACY_SOURCES).boards.enabled,
        keys: {
          workable: process.env.WORKABLE_API_KEY,
          teamtailor: process.env.TEAMTAILOR_API_KEY,
        },
      },
      config.companies.companies,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const hint = /no such table/i.test(message)
      ? '\nDatabase is not migrated. Run `pnpm cli db:migrate` first.'
      : '';
    console.error(`${command} FAILED\n\n${message}${hint}`);
    process.exitCode = 1;
  } finally {
    sqlite?.close();
  }
}
