import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv, parseEnv } from './env.js';

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('parseEnv', () => {
  it('parses key/value lines, comments, and quotes', () => {
    const text = [
      '# a comment',
      '',
      'FOO=bar',
      'QUOTED="with spaces"',
      "SINGLE='single'",
      'EMPTY=',
      'bad line without equals',
      '1INVALID=nope',
      'WITH_EQUALS=a=b=c',
    ].join('\n');
    expect(parseEnv(text)).toEqual({
      FOO: 'bar',
      QUOTED: 'with spaces',
      SINGLE: 'single',
      EMPTY: '',
      WITH_EQUALS: 'a=b=c',
    });
  });
});

describe('loadEnv', () => {
  it('sets only variables that are not already in the environment', () => {
    dir = mkdtempSync(join(tmpdir(), 'jobhacker-env-'));
    const path = join(dir, '.env');
    const existing = 'JOBHACKER_TEST_EXISTING';
    const fresh = 'JOBHACKER_TEST_FRESH';
    process.env[existing] = 'keep-me';
    delete process.env[fresh];
    writeFileSync(path, `${existing}=overwrite\n${fresh}=new-value\n`, 'utf8');

    const set = loadEnv(path);
    expect(set).toEqual([fresh]);
    expect(process.env[existing]).toBe('keep-me');
    expect(process.env[fresh]).toBe('new-value');

    delete process.env[existing];
    delete process.env[fresh];
  });

  it('is a no-op for a missing file', () => {
    expect(loadEnv('/no/such/.env')).toEqual([]);
  });
});
