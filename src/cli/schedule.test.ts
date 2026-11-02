import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * The launchd template runs under a non-interactive login shell. That shell does
 * not source `.zshrc`, so nvm's `node` is not on PATH. `pnpm`'s shebang is
 * `#!/usr/bin/env node`, and launchd will not create a missing `StandardOutPath`
 * directory. This runs the plist's own command in that environment.
 */

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function plistCommand(): string {
  const xml = readFileSync(
    new URL('../../ops/space.jobhacker.scout.plist', import.meta.url),
    'utf8',
  );
  const commands = [...xml.matchAll(/<string>([^<]*__PNPM__[^<]*)<\/string>/g)].map(
    (m) => m[1] ?? '',
  );
  const command = commands[0];
  if (!command) throw new Error('plist has no __PNPM__ command');
  return command.replaceAll('&amp;', '&');
}

describe('launchd scout command', () => {
  it('runs a node-shebang pnpm when node is not already on PATH, and writes a log', () => {
    dir = mkdtempSync(join(tmpdir(), 'jobhacker-launchd-'));
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'node'), '#!/bin/sh\necho scout-ok\n', 'utf8');
    // Same shape as real pnpm: the kernel asks `env` for `node`.
    writeFileSync(join(bin, 'pnpm'), '#!/usr/bin/env node\n', 'utf8');
    chmodSync(join(bin, 'node'), 0o755);
    chmodSync(join(bin, 'pnpm'), 0o755);

    const repo = join(dir, 'repo');
    mkdirSync(repo);
    const command = plistCommand()
      .replaceAll('__REPO__', repo)
      .replaceAll('__PNPM__', join(bin, 'pnpm'));

    const result = spawnSync('/bin/zsh', ['-lc', command], {
      encoding: 'utf8',
      env: {
        HOME: dir,
        USER: 'jobhacker',
        LOGNAME: 'jobhacker',
        SHELL: '/bin/zsh',
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        NODE_ENV: 'test',
      },
    });

    const outPath = join(repo, 'data/logs/launchd.out.log');
    const captured = `${result.stdout}${existsSync(outPath) ? readFileSync(outPath, 'utf8') : ''}`;
    expect(result.status, result.stderr).toBe(0);
    expect(captured).toContain('scout-ok');
    expect(existsSync(outPath)).toBe(true);
  });
});
