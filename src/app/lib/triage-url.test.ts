import { describe, expect, it } from 'vitest';
import { paletteJobHref } from './triage-url.js';

const defaults = ['portland', 'phoenix', 'remote'];

describe('paletteJobHref', () => {
  it('switches to Anywhere when Where would hide the job, and drops the time filter', () => {
    expect(
      paletteJobHref(
        '?where=portland,phoenix,remote&seen=24h',
        { areas: [], band: 'strong' },
        defaults,
      ),
    ).toBe('/?where=anywhere');
  });

  it('treats a missing where as the default places', () => {
    expect(paletteJobHref('', { areas: [], band: 'maybe' }, defaults)).toBe('/?where=anywhere');
  });

  it('keeps Where when the job is in it, and still drops the time filter', () => {
    expect(
      paletteJobHref(
        '?where=portland&seen=7d&segment=weak',
        { areas: ['portland'], band: 'strong' },
        defaults,
      ),
    ).toBe('/?where=portland');
  });

  it('opens a weak job on the weak segment', () => {
    expect(paletteJobHref('', { areas: ['remote'], band: 'no' }, defaults)).toBe('/?segment=weak');
  });
});
