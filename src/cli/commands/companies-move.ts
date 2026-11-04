import { ConfigError, DEFAULT_CONFIG_DIR, loadAllConfig } from '../../core/config/load.js';
import { BOARD_ATS, type BoardAts } from '../../core/config/schemas.js';
import { createDb } from '../../core/db/client.js';
import { MoveError, moveToLink } from '../../core/sources/move.js';
import { systemClock } from '../../core/util/clock.js';
import { createHttp } from '../../core/util/http.js';

/**
 * `companies:move <ats>/<token> <careers-url>` — verify the board at the link (one fetch), add it,
 * and set the old board inactive. Nothing is deleted.
 */
export async function companiesMove(from: string, url: string): Promise<void> {
  const match = /^([a-z]+)[/:](.+)$/.exec(from.trim());
  const ats = match?.[1];
  const token = match?.[2]?.trim();
  if (!ats || !token || !isAts(ats)) {
    console.error(
      `companies:move FAILED\n\nExpected <ats>/<token>, e.g. ashby/coinhako. Got "${from}".`,
    );
    process.exitCode = 1;
    return;
  }
  let sqlite: ReturnType<typeof createDb>['sqlite'] | undefined;
  try {
    const config = loadAllConfig();
    const entry = config.companies.companies.find((c) => c.ats === ats && c.token === token);
    const opened = createDb();
    sqlite = opened.sqlite;
    const moved = await moveToLink(
      {
        dir: DEFAULT_CONFIG_DIR,
        db: opened.db,
        clock: systemClock,
        http: createHttp(),
        keys: {
          workable: process.env.WORKABLE_API_KEY,
          teamtailor: process.env.TEAMTAILOR_API_KEY,
        },
      },
      { ats, token, name: entry?.name ?? token },
      url,
    );
    const how =
      moved.how === 'appended'
        ? 'appended, active'
        : moved.how === 'reactivated'
          ? 'was listed and off, now active'
          : 'already listed and active';
    console.log(
      [
        `moved ${moved.from.name} (${moved.from.ats}/${moved.from.token}) → ${moved.to.name} (${moved.to.ats}/${moved.to.token}), ${moved.postings} postings`,
        `  ${moved.file}: ${moved.to.ats}/${moved.to.token} ${how}; ${moved.from.ats}/${moved.from.token} set active: false`,
        `  companies row ${moved.from.ats}/${moved.from.token}: inactive`,
        '  Postings with the same ATS and id move to the new board on the next scout, with their scores and status.',
      ].join('\n'),
    );
  } catch (err) {
    if (err instanceof MoveError || err instanceof ConfigError) {
      console.error(`companies:move FAILED\n\n${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  } finally {
    sqlite?.close();
  }
}

function isAts(value: string): value is BoardAts {
  return (BOARD_ATS as readonly string[]).includes(value);
}
