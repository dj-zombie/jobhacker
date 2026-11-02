import { describe, expect, it } from 'vitest';
import { nationalNumber, phoneCountryFor } from './phone.js';

describe('phoneCountryFor', () => {
  it('maps the profile country (United States) to the widget country', () => {
    expect(phoneCountryFor('United States')).toEqual({
      iso: 'US',
      name: 'United States',
      dial: '1',
    });
    expect(phoneCountryFor('usa')?.iso).toBe('US');
    expect(phoneCountryFor('Canada')?.iso).toBe('CA');
  });

  it('returns undefined for an unmapped or missing country', () => {
    expect(phoneCountryFor('Australia')).toBeUndefined();
    expect(phoneCountryFor(undefined)).toBeUndefined();
    expect(phoneCountryFor('')).toBeUndefined();
  });
});

describe('nationalNumber', () => {
  const us = { iso: 'US', name: 'United States', dial: '1' };

  it('strips punctuation from a national number', () => {
    expect(nationalNumber('(555) 123-4567', us)).toBe('5551234567');
    expect(nationalNumber('555.123.4567', us)).toBe('5551234567');
  });

  it('drops a leading US country code', () => {
    expect(nationalNumber('+1 555 123 4567', us)).toBe('5551234567');
    expect(nationalNumber('15551234567', us)).toBe('5551234567');
  });

  it('keeps a short number untouched', () => {
    expect(nationalNumber('12345', us)).toBe('12345');
  });
});
