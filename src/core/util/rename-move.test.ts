import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { chromeUsesDir, moveLegacyChromeProfile, moveLegacyDb } from './rename-move.js';

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function tmp(): string {
  dir = mkdtempSync(join(tmpdir(), 'jobhacker-rename-'));
  return dir;
}

describe('moveLegacyDb', () => {
  it('moves the database with its -wal and -shm files, and logs once', () => {
    const root = tmp();
    const legacy = join(root, 'old.db');
    for (const suffix of ['', '-wal', '-shm'])
      writeFileSync(`${legacy}${suffix}`, `content${suffix}`);
    const logs: string[] = [];
    const target = join(root, 'new', 'jobhacker.db');

    const moved = moveLegacyDb(target, (m) => logs.push(m), legacy);

    expect(moved).toEqual([`${legacy}-wal`, `${legacy}-shm`, legacy]);
    expect(readFileSync(target, 'utf8')).toBe('content');
    expect(readFileSync(`${target}-wal`, 'utf8')).toBe('content-wal');
    expect(readFileSync(`${target}-shm`, 'utf8')).toBe('content-shm');
    expect(existsSync(legacy)).toBe(false);
    expect(logs).toHaveLength(1);
    expect(moveLegacyDb(target, (m) => logs.push(m), legacy)).toEqual([]);
    expect(logs).toHaveLength(1);
  });

  it('finishes a move that stopped after the sidecars', () => {
    const root = tmp();
    const legacy = join(root, 'old.db');
    const target = join(root, 'jobhacker.db');
    writeFileSync(legacy, 'main');
    writeFileSync(`${target}-wal`, 'already moved');

    expect(moveLegacyDb(target, () => {}, legacy)).toEqual([legacy]);
    expect(readFileSync(target, 'utf8')).toBe('main');
    expect(readFileSync(`${target}-wal`, 'utf8')).toBe('already moved');
  });

  it('removes an empty leftover instead of warning', () => {
    const root = tmp();
    const legacy = join(root, 'old.db');
    const target = join(root, 'jobhacker.db');
    writeFileSync(legacy, '');
    writeFileSync(`${legacy}-wal`, '');
    writeFileSync(`${legacy}-shm`, 'index');
    writeFileSync(target, 'new');
    const logs: string[] = [];

    expect(moveLegacyDb(target, (m) => logs.push(m), legacy)).toEqual([]);
    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(`${legacy}-wal`)).toBe(false);
    expect(existsSync(`${legacy}-shm`)).toBe(false);
    expect(readFileSync(target, 'utf8')).toBe('new');
    expect(logs).toEqual([]);
  });

  it('leaves both alone when the new database already exists, and warns', () => {
    const root = tmp();
    const legacy = join(root, 'old.db');
    const target = join(root, 'jobhacker.db');
    writeFileSync(legacy, 'old');
    writeFileSync(target, 'new');
    const logs: string[] = [];

    expect(moveLegacyDb(target, (m) => logs.push(m), legacy)).toEqual([]);
    expect(readFileSync(legacy, 'utf8')).toBe('old');
    expect(readFileSync(target, 'utf8')).toBe('new');
    expect(logs).toEqual([expect.stringContaining('both')]);
  });

  it('does nothing, silently, when there is no old database', () => {
    const root = tmp();
    const logs: string[] = [];
    expect(
      moveLegacyDb(join(root, 'jobhacker.db'), (m) => logs.push(m), join(root, 'old.db')),
    ).toEqual([]);
    expect(logs).toEqual([]);
  });
});

describe('moveLegacyChromeProfile', () => {
  function profiles(): { legacyDir: string; newDir: string } {
    const root = tmp();
    const legacyDir = join(root, '.old-chrome');
    mkdirSync(join(legacyDir, 'Default'), { recursive: true });
    writeFileSync(join(legacyDir, 'Default', 'Cookies'), 'signed in');
    return { legacyDir, newDir: join(root, '.jobhacker-chrome') };
  }

  it('moves the profile folder, keeping its contents, when Chrome is not running', () => {
    const { legacyDir, newDir } = profiles();
    const result = moveLegacyChromeProfile({ newDir, legacyDir, debuggerUp: false, psOutput: '' });
    expect(result).toEqual({ action: 'moved', from: legacyDir, to: newDir });
    expect(readFileSync(join(newDir, 'Default', 'Cookies'), 'utf8')).toBe('signed in');
    expect(existsSync(legacyDir)).toBe(false);
  });

  it('refuses while something listens on the debugging port', () => {
    const { legacyDir, newDir } = profiles();
    const result = moveLegacyChromeProfile({ newDir, legacyDir, debuggerUp: true, psOutput: '' });
    expect(result.action).toBe('refused');
    expect(result.action === 'refused' && result.reason).toContain('port 9222');
    expect(existsSync(legacyDir)).toBe(true);
    expect(existsSync(newDir)).toBe(false);
  });

  it('refuses while a Chrome process uses the old folder', () => {
    const { legacyDir, newDir } = profiles();
    const ps = `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=${legacyDir} --flag\n`;
    const result = moveLegacyChromeProfile({ newDir, legacyDir, debuggerUp: false, psOutput: ps });
    expect(result.action).toBe('refused');
    expect(existsSync(legacyDir)).toBe(true);
  });

  it('does nothing when the new folder exists or the old one is gone', () => {
    const { legacyDir, newDir } = profiles();
    mkdirSync(newDir);
    expect(moveLegacyChromeProfile({ newDir, legacyDir, debuggerUp: false, psOutput: '' })).toEqual(
      {
        action: 'none',
      },
    );
    rmSync(newDir, { recursive: true });
    rmSync(legacyDir, { recursive: true });
    expect(moveLegacyChromeProfile({ newDir, legacyDir, debuggerUp: false, psOutput: '' })).toEqual(
      {
        action: 'none',
      },
    );
  });
});

describe('chromeUsesDir', () => {
  it('matches the flag with or without quotes, and nothing else', () => {
    expect(chromeUsesDir('Chrome --user-data-dir=/u/.old-chrome --x', '/u/.old-chrome')).toBe(true);
    expect(chromeUsesDir('Chrome --user-data-dir="/u/.old-chrome"', '/u/.old-chrome')).toBe(true);
    expect(chromeUsesDir('Chrome --user-data-dir=/u/.jobhacker-chrome', '/u/.old-chrome')).toBe(
      false,
    );
  });
});
