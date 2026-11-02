import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * The pre-JobHacker paths (J2). This is the only module that names them, and
 * it exists only for the one-time moves to the new paths. The files are moved,
 * never recreated: the database holds every job, and the Chrome profile holds
 * every site Kris is signed in to.
 */
export const LEGACY_DB_PATH = './data/jobhunt.db';
export const LEGACY_CHROME_DIR = join(homedir(), '.jobhunt-chrome');

/**
 * Move the legacy database, with its `-wal` and `-shm` files, to `newPath`
 * when `newPath` is missing and the legacy file exists. The sidecars move
 * before the main file, so a move interrupted halfway is finished by the next
 * call. Returns the files moved; logs once when it moves anything.
 */
export function moveLegacyDb(
  newPath: string,
  log: (message: string) => void,
  legacyPath: string = LEGACY_DB_PATH,
): string[] {
  if (!existsSync(legacyPath)) return [];
  if (existsSync(newPath)) {
    log(
      `both ${newPath} and the pre-JobHacker ${legacyPath} exist. Using ${newPath}; the old file is untouched. If your jobs are missing, they're in the old file.`,
    );
    return [];
  }
  mkdirSync(dirname(newPath), { recursive: true });
  const moved: string[] = [];
  for (const suffix of ['-wal', '-shm', '']) {
    const from = `${legacyPath}${suffix}`;
    if (!existsSync(from)) continue;
    renameSync(from, `${newPath}${suffix}`);
    moved.push(from);
  }
  log(`moved the database to ${newPath}: ${moved.join(', ')}`);
  return moved;
}

export type ChromeProfileMove =
  | { action: 'none' }
  | { action: 'moved'; from: string; to: string }
  | { action: 'refused'; reason: string };

/** Does any line of `ps -ax -o command=` run Chrome with `dir` as its user-data-dir? */
export function chromeUsesDir(psOutput: string, dir: string): boolean {
  return psOutput
    .split('\n')
    .some(
      (line) =>
        line.includes(`--user-data-dir=${dir}`) || line.includes(`--user-data-dir="${dir}"`),
    );
}

/**
 * Move the legacy Chrome profile to `newDir` when `newDir` is missing and the
 * legacy folder exists, but only while that Chrome isn't running: nothing on
 * the debugging port, and no process using the legacy folder. Otherwise it
 * refuses and says why. Moving keeps every sign-in; a fresh folder would lose them.
 */
export function moveLegacyChromeProfile(input: {
  newDir: string;
  debuggerUp: boolean;
  psOutput: string;
  legacyDir?: string;
}): ChromeProfileMove {
  const legacyDir = input.legacyDir ?? LEGACY_CHROME_DIR;
  if (existsSync(input.newDir) || !existsSync(legacyDir)) return { action: 'none' };
  const quit = `Quit that Chrome (Chrome menu → Quit, or ⌘Q in its window), then run \`pnpm cli chrome\` again. It will move ${legacyDir} to ${input.newDir}, keeping your sign-ins.`;
  if (input.debuggerUp) {
    return {
      action: 'refused',
      reason: `Chrome is still running with the old profile (something is listening on port 9222). ${quit}`,
    };
  }
  if (chromeUsesDir(input.psOutput, legacyDir)) {
    return { action: 'refused', reason: `A Chrome process is still using ${legacyDir}. ${quit}` };
  }
  renameSync(legacyDir, input.newDir);
  return { action: 'moved', from: legacyDir, to: input.newDir };
}
