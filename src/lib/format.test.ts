import { describe, expect, it } from 'vitest';
import { formatAge, formatAgeLong } from './format.js';

describe('formatAgeLong', () => {
  it('uses the same buckets as the short age', () => {
    expect(formatAge(0.2)).toBe('now');
    expect(formatAgeLong(0.2)).toBe('First seen under an hour ago');
    expect(formatAge(1)).toBe('1h');
    expect(formatAgeLong(1)).toBe('First seen 1 hour ago');
    expect(formatAgeLong(4.4)).toBe('First seen 4 hours ago');
    expect(formatAge(36)).toBe('2d');
    expect(formatAgeLong(36)).toBe('First seen 2 days ago');
    expect(formatAge(24 * 14)).toBe('2w');
    expect(formatAgeLong(24 * 14)).toBe('First seen 2 weeks ago');
  });
});
