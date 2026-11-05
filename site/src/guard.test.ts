import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The demo's grep guard (invariant 1). The replay on /form/ sets values the way a person
 * would see them filled, and never clicks, presses or submits: no file under `site/` may
 * contain the tokens `src/core/apply/guard.test.ts` forbids. The sample form itself has no
 * action and a disabled submit button.
 */

const SITE = join(process.cwd(), 'site');
const SKIP_DIRS = new Set(['dist', 'node_modules', '.wrangler']);
// The test files hold the token list and drive nothing.
const SKIP = /\.test\.ts$/;
const FORBIDDEN = ['.click(', '.press(', '.submit(', '.requestSubmit(', 'keyboard.'] as const;

function sourceFilesIn(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) out.push(...sourceFilesIn(full));
    } else if (/\.(tsx?|m?js|html)$/.test(name) && !SKIP.test(name)) out.push(full);
  }
  return out;
}

describe('demo site grep guard', () => {
  const files = sourceFilesIn(SITE).map((full) => relative(SITE, full));

  it('checks the replay, the form page and the sample form', () => {
    expect(files).toContain('src/replay.ts');
    expect(files).toContain('src/form.tsx');
    expect(files).toContain('form/sample-form.html');
  });

  it.each(files)('%s contains no submit/click/press/keyboard calls', (rel) => {
    const source = readFileSync(join(SITE, rel), 'utf8');
    for (const token of FORBIDDEN) {
      expect(source.includes(token), `${rel} must not contain "${token}"`).toBe(false);
    }
  });

  it('the sample form has no action and its submit button is disabled', () => {
    const html = readFileSync(join(SITE, 'form/sample-form.html'), 'utf8');
    expect(html).not.toMatch(/\baction\s*=/i);
    expect(html).not.toMatch(/\bformaction\s*=/i);
    const buttons = html.match(/<button\b[^>]*>/gi) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      if (/type="submit"/i.test(button)) expect(button).toMatch(/\bdisabled\b/);
      else expect(button).toMatch(/type="button"/i);
    }
  });
});
