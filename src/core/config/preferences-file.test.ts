import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../util/clock.js';
import { ConfigError } from './errors.js';
import { EMPTY_PREFERENCES, loadPreferences } from './load.js';
import { savePreferences } from './preferences-file.js';

const ORIGINAL = '# What I want\n\nSenior full-stack roles at product companies.\n';
const clock = fixedClock('2026-11-04T08:05:12.000Z');
let dir: string;
let backupDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jh-prefs-'));
  backupDir = join(dir, 'backups');
  writeFileSync(join(dir, 'preferences.md'), ORIGINAL);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const sha = () =>
  createHash('sha256')
    .update(readFileSync(join(dir, 'preferences.md')))
    .digest('hex');
const backups = () => {
  try {
    return readdirSync(backupDir);
  } catch {
    return [];
  }
};

describe('savePreferences', () => {
  it("refuses blank text with loadPreferences' message and leaves the file unchanged", () => {
    const before = sha();
    for (const blank of ['', '   ', '\n\n\t\n']) {
      let issues: string[] = [];
      try {
        savePreferences(dir, blank, { clock, backupDir });
      } catch (err) {
        if (err instanceof ConfigError) issues = err.issues;
      }
      expect(issues).toEqual([EMPTY_PREFERENCES]);
    }
    expect(sha()).toBe(before);
    expect(backups()).toEqual([]);
  });

  it('writes the text as typed and backs up the previous file', () => {
    const next = `${ORIGINAL}\nI also like developer tools.\n`;
    const result = savePreferences(dir, next, { clock, backupDir });
    expect(result.changed).toBe(true);
    expect(loadPreferences(dir)).toBe(next);
    expect(backups()).toEqual(['preferences-2026-11-04T080512Z.md']);
    expect(readFileSync(join(backupDir, 'preferences-2026-11-04T080512Z.md'), 'utf8')).toBe(
      ORIGINAL,
    );
  });

  it('writes nothing when the text is the same', () => {
    const before = sha();
    expect(savePreferences(dir, ORIGINAL, { clock, backupDir })).toEqual({
      changed: false,
      text: ORIGINAL,
      backup: null,
    });
    expect(sha()).toBe(before);
    expect(backups()).toEqual([]);
  });
});
