import { describe, expect, it } from 'vitest';
import { legacyViewHref, paletteJobHref } from './triage-url.js';

const defaults = ['portland', 'phoenix', 'remote'];

// Top matches lives at /matches since J23 (D168), so ⌘K sends a job there.
describe('paletteJobHref', () => {
  it('switches to Anywhere when Where would hide the job, and drops the time filter', () => {
    expect(
      paletteJobHref(
        '?where=portland,phoenix,remote&seen=24h',
        { areas: [], band: 'strong' },
        defaults,
      ),
    ).toBe('/matches?where=anywhere');
  });

  it('treats a missing where as the default places', () => {
    expect(paletteJobHref('', { areas: [], band: 'maybe' }, defaults)).toBe(
      '/matches?where=anywhere',
    );
  });

  it('keeps Where when the job is in it, and still drops the time filter', () => {
    expect(
      paletteJobHref(
        '?where=portland&seen=7d&segment=weak',
        { areas: ['portland'], band: 'strong' },
        defaults,
      ),
    ).toBe('/matches?where=portland');
  });

  it('opens a weak job on the weak segment', () => {
    expect(paletteJobHref('', { areas: ['remote'], band: 'no' }, defaults)).toBe(
      '/matches?segment=weak',
    );
  });
});

describe('legacyViewHref', () => {
  it('sends the old Top matches views to /matches, keeping where and seen', () => {
    expect(legacyViewHref('matches', { where: 'portland', seen: '7d' })).toBe(
      '/matches?where=portland&seen=7d',
    );
    expect(legacyViewHref('review', {})).toBe('/matches');
    expect(legacyViewHref('ranked', {})).toBe('/matches');
  });

  it('sends the other legacy views to their own path', () => {
    expect(legacyViewHref('new', {})).toBe('/new');
    expect(legacyViewHref('shortlist', { where: 'anywhere' })).toBe('/shortlist?where=anywhere');
    expect(legacyViewHref('unscored', {})).toBe('/unscored');
  });

  it('is null for no view or an unknown one, so the page renders', () => {
    expect(legacyViewHref(undefined, {})).toBeNull();
    expect(legacyViewHref('dashboard', {})).toBeNull();
  });
});
