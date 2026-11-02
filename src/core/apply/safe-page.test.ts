import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SUBMIT_TEXT_RE, isSubmitLikeText, pageMayHydrate } from './safe-page.js';

describe('isSubmitLikeText', () => {
  it.each([
    ['Submit application', true],
    ['Apply now', true],
    ['Send', true],
    ['Finish', true],
    ['Complete application', true],
    ['SUBMIT', true],
    ['Open menu', false],
    ['Add another', false],
    ['Continue editing', false],
  ])('%s → %s', (text, expected) => {
    expect(isSubmitLikeText(text)).toBe(expected);
  });

  it('exports the pattern used to refuse clicks (invariant 1)', () => {
    expect(SUBMIT_TEXT_RE.test('please submit')).toBe(true);
  });
});

describe('no string-form page evaluation (CSP)', () => {
  // Playwright evaluates a string predicate/expression with an in-page
  // `eval`, which a nonce CSP (Ashby, 2026-10-24) forbids — `goto` died
  // before any field was filled. Function forms go through CDP and are fine.
  it('safe-page.ts never passes a string to waitForFunction/evaluate', () => {
    const source = readFileSync(new URL('./safe-page.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/waitForFunction\(\s*[`'"]/);
    expect(source).not.toMatch(/\.evaluate\(\s*[`'"]/);
  });
});

describe('pageMayHydrate', () => {
  it('is true for Greenhouse Remix markup and false for a static form', () => {
    expect(pageMayHydrate('<div class="remix-css-1">react-select</div>')).toBe(true);
    expect(pageMayHydrate('<form><input name="name"></form>')).toBe(false);
    expect(pageMayHydrate('We use React and TypeScript')).toBe(false);
  });
});
