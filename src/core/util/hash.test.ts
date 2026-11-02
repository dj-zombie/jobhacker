import { describe, expect, it } from 'vitest';
import { contentHash, dedupeKey, sha256 } from './hash.js';

describe('contentHash', () => {
  it('is a 64-char hex sha256', () => {
    const h = contentHash('Senior Frontend', 'Build great UIs');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across whitespace-only differences', () => {
    const a = contentHash('Senior   Frontend', 'Build  great   UIs');
    const b = contentHash('Senior Frontend', 'Build great UIs');
    expect(a).toBe(b);
  });

  it('changes when the description changes', () => {
    const a = contentHash('Senior Frontend', 'Build great UIs');
    const b = contentHash('Senior Frontend', 'Build great APIs');
    expect(a).not.toBe(b);
  });
});

describe('dedupeKey', () => {
  it('is a 40-char hex sha1', () => {
    expect(dedupeKey('Acme', 'Engineer', 'Remote')).toMatch(/^[0-9a-f]{40}$/);
  });

  it('ignores case, accents and surrounding whitespace', () => {
    const a = dedupeKey('Acmé Inc', 'Senior Engineer', 'Remote (US)');
    const b = dedupeKey('  acme inc ', 'senior engineer', 'remote (us)');
    expect(a).toBe(b);
  });

  it('treats legal suffixes and punctuation on the company name as the same company', () => {
    const a = dedupeKey('Stripe, Inc.', 'Engineer', 'Remote');
    const b = dedupeKey('Stripe LLC', 'Engineer', 'Remote');
    const c = dedupeKey('stripe', 'Engineer', 'Remote');
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it('differs when the title differs', () => {
    const a = dedupeKey('Acme', 'Senior Engineer', 'Remote');
    const b = dedupeKey('Acme', 'Staff Engineer', 'Remote');
    expect(a).not.toBe(b);
  });
});

describe('sha256', () => {
  it('matches a known vector', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
