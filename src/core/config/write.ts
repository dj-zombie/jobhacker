import { randomUUID } from 'node:crypto';
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { DEFAULT_BACKUP_DIR, backupTimestamp } from '../db/backup.js';
import type { Clock } from '../util/clock.js';

/** Where the app's config writers copy a file before they change it (J18). Gitignored, under `data/`. */
export const DEFAULT_CONFIG_BACKUP_DIR = join(DEFAULT_BACKUP_DIR, 'config');

export interface ConfigWriteDeps {
  clock: Clock;
  /** Defaults to `DEFAULT_CONFIG_BACKUP_DIR`. */
  backupDir?: string;
}

/**
 * Copy `file` to `<backupDir>/<name>-<UTC stamp><ext>`, e.g. `profile-2026-11-04T080512Z.yaml`,
 * and return the copy's path. A second save in the same second gets `-2`, so no backup is
 * ever overwritten.
 */
export function backupConfigFile(file: string, deps: ConfigWriteDeps): string {
  const dir = deps.backupDir ?? DEFAULT_CONFIG_BACKUP_DIR;
  mkdirSync(dir, { recursive: true });
  const ext = extname(file);
  const name = basename(file, ext);
  const stamp = backupTimestamp(deps.clock.now());
  let path = join(dir, `${name}-${stamp}${ext}`);
  for (let n = 2; existsSync(path); n++) path = join(dir, `${name}-${stamp}-${n}${ext}`);
  copyFileSync(file, path, constants.COPYFILE_EXCL);
  return path;
}

/**
 * Write `text` to a temporary file in the same folder, then rename it over `file`, so a reader
 * sees the old file or the new one and never half of one. Keeps the file's permissions.
 */
export function writeFileAtomic(file: string, text: string): void {
  const tmp = join(dirname(file), `.${basename(file)}.${randomUUID()}.tmp`);
  let mode: number | undefined;
  try {
    mode = statSync(file).mode & 0o777;
  } catch {
    mode = undefined;
  }
  try {
    writeFileSync(tmp, text, mode === undefined ? undefined : { mode });
    renameSync(tmp, file);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // Nothing was left behind.
    }
    throw err;
  }
}
