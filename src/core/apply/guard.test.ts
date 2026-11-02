import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The grep guard (invariant 1, ARCHITECTURE § Apply). No file under
 * `src/core/apply/` other than `safe-page.ts` and `browser.ts` may drive the
 * browser directly: no `.click(`, `.press(`, `.submit(`, `.requestSubmit(`, or
 * `keyboard.`. All page access goes through `SafePage`, which has no submit
 * path. This test fails `pnpm check` if a forbidden token ever appears.
 */

const APPLY_DIR = join(process.cwd(), 'src/core/apply');
const ALLOWED = new Set(['safe-page.ts', 'browser.ts']);
// This file holds the token list, so it can't be scanned for it.
const SELF = 'guard.test.ts';
const FORBIDDEN = ['.click(', '.press(', '.submit(', '.requestSubmit(', 'keyboard.'] as const;

function sourceFilesIn(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFilesIn(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe('apply grep guard', () => {
  const files = sourceFilesIn(APPLY_DIR)
    .map((full) => relative(APPLY_DIR, full))
    .filter((rel) => !ALLOWED.has(rel) && rel !== SELF);

  it('checks every apply file except safe-page.ts and browser.ts', () => {
    expect(files).toContain('fill.ts');
    expect(files).toContain('apply.ts');
    expect(files).toContain('adapters/generic.ts');
    expect(files).not.toContain('safe-page.ts');
    expect(files).not.toContain('browser.ts');
  });

  it.each(files)('%s contains no submit/click/press/keyboard calls', (rel) => {
    const source = readFileSync(join(APPLY_DIR, rel), 'utf8');
    for (const token of FORBIDDEN) {
      expect(source.includes(token), `${rel} must not contain "${token}"`).toBe(false);
    }
  });
});
