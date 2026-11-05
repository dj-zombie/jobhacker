import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigError } from './errors.js';
import { EMPTY_PREFERENCES } from './load.js';
import { PREFERENCES_FILE } from './schemas.js';
import { type ConfigWriteDeps, backupConfigFile, writeFileAtomic } from './write.js';

/** Far longer than any taste document; a guard against a runaway paste. */
const MAX_PREFERENCES_CHARS = 200_000;

export interface SavedPreferences {
  changed: boolean;
  text: string;
  /** Where the previous file was copied, or null when nothing was written. */
  backup: string | null;
}

/**
 * Write `preferences.md` exactly as Kris typed it (J18). Blank text is refused with the message
 * `loadPreferences` uses. The same text as the file writes nothing. Otherwise the file is copied
 * to the backup folder and replaced through a temporary file and a rename.
 */
export function savePreferences(
  dir: string,
  text: string,
  deps: ConfigWriteDeps,
): SavedPreferences {
  const file = join(dir, PREFERENCES_FILE);
  if (text.trim().length === 0) throw new ConfigError(file, [EMPTY_PREFERENCES]);
  if (text.length > MAX_PREFERENCES_CHARS) {
    throw new ConfigError(file, [
      `preferences: longer than ${MAX_PREFERENCES_CHARS.toLocaleString('en-US')} characters`,
    ]);
  }
  let original: string;
  try {
    original = readFileSync(file, 'utf8');
  } catch {
    throw new ConfigError(file, [
      'file not found. Copy config/preferences.example.md to config/preferences.md and edit it.',
    ]);
  }
  if (original === text) return { changed: false, text, backup: null };
  const backup = backupConfigFile(file, deps);
  writeFileAtomic(file, text);
  return { changed: true, text, backup };
}
