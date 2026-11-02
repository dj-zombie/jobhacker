import { describe, expect, it } from 'vitest';
import {
  countryFromLocation,
  locationQuery,
  matchLocationOption,
  parseLocation,
} from './location.js';

const opts = (...texts: string[]) => texts.map((text, i) => ({ text, tag: `#o${i}` }));

describe('parseLocation / countryFromLocation', () => {
  it('reads a US "City, ST" location', () => {
    expect(parseLocation('Phoenix, AZ')).toEqual({
      city: 'Phoenix',
      state: 'Arizona',
      country: 'United States',
    });
    expect(countryFromLocation('Portland, Oregon')).toBe('United States');
    expect(countryFromLocation('Austin, TX, USA')).toBe('United States');
  });

  it('keeps a stated non-US country and does not guess a missing one', () => {
    expect(countryFromLocation('Toronto, Canada')).toBe('Canada');
    expect(countryFromLocation('Phoenix')).toBeUndefined();
  });

  it('searches a typeahead by city', () => {
    expect(locationQuery('Phoenix, AZ')).toBe('Phoenix');
  });
});

describe('matchLocationOption', () => {
  it('picks the city in the right state, not a lookalike', () => {
    // Real Greenhouse/Ashby suggestions for "Phoenix" (2026-10-23).
    const options = opts(
      'City of Phoenix, Arizona, United States',
      'Phoenixville, Pennsylvania, United States',
      'Phoenix, Oregon, United States',
      'Phoenix, Arizona, United States',
    );
    expect(matchLocationOption(options, 'Phoenix, AZ')).toBe('#o3');
  });

  it('returns undefined when no option is clearly the place', () => {
    expect(
      matchLocationOption(opts('Phoenix, Oregon, United States'), 'Phoenix, AZ'),
    ).toBeUndefined();
    expect(matchLocationOption([], 'Phoenix, AZ')).toBeUndefined();
  });
});
