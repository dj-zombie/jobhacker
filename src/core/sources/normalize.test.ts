import { describe, expect, it } from 'vitest';
import {
  inferRemoteType,
  normalizeEmployment,
  richTextToPlain,
  toUtcIso,
  yearlySalary,
} from './normalize.js';

describe('inferRemoteType', () => {
  it('prefers a structured workplace over the location text', () => {
    expect(inferRemoteType({ workplaceType: 'remote', location: 'New York, NY' })).toBe('remote');
    expect(inferRemoteType({ workplaceType: 'Hybrid', location: 'New York, NY (HQ)' })).toBe(
      'hybrid',
    );
    expect(inferRemoteType({ workplaceType: 'OnSite' })).toBe('onsite');
    expect(inferRemoteType({ workplaceType: 'on-site' })).toBe('onsite');
    expect(inferRemoteType({ workplaceType: 'on site' })).toBe('onsite');
  });

  it('reads hybrid and remote out of a location, otherwise treats a place as onsite', () => {
    expect(inferRemoteType({ location: 'San Francisco Bay Area (or Remote U.S.)' })).toBe('remote');
    expect(inferRemoteType({ location: 'Poland - Remote OR Romania - Remote' })).toBe('remote');
    expect(inferRemoteType({ location: 'US-Remote-CA' })).toBe('remote');
    expect(inferRemoteType({ location: 'Austin (Hybrid)' })).toBe('hybrid');
    expect(inferRemoteType({ location: 'San Francisco Bay Area' })).toBe('onsite');
    expect(inferRemoteType({ workplaceType: 'unspecified', location: '' })).toBe('unknown');
    expect(inferRemoteType({})).toBe('unknown');
  });
});

describe('normalizeEmployment', () => {
  it('maps the labels these boards actually use', () => {
    expect(normalizeEmployment('Permanent')).toBe('full_time');
    expect(normalizeEmployment('FullTime')).toBe('full_time');
    expect(normalizeEmployment('Full Time Contractor')).toBe('contract');
    expect(normalizeEmployment('Short Term')).toBe('temporary');
    expect(normalizeEmployment('Intern')).toBe('internship');
    expect(normalizeEmployment('None')).toBeNull();
    expect(normalizeEmployment('')).toBeNull();
    expect(normalizeEmployment('Seasonal')).toBe('Seasonal');
  });
});

describe('yearlySalary', () => {
  it('keeps the USD yearly span and ignores equity, bonus, and monthly pay', () => {
    const range = yearlySalary([
      {
        components: [
          {
            compensationType: 'EquityPercentage',
            interval: 'NONE',
            minValue: null,
            maxValue: null,
          },
          {
            compensationType: 'Salary',
            interval: '1 MONTH',
            currencyCode: 'USD',
            minValue: 10000,
            maxValue: 12000,
          },
          {
            compensationType: 'Salary',
            interval: '1 YEAR',
            currencyCode: 'CAD',
            minValue: 100,
            maxValue: 200,
          },
          {
            compensationType: 'Salary',
            interval: '1 year',
            currencyCode: 'USD',
            minValue: 211400.4,
            maxValue: 290600,
          },
          {
            compensationType: 'Bonus',
            interval: '1 YEAR',
            currencyCode: 'USD',
            minValue: 1,
            maxValue: 2,
          },
        ],
      },
      {
        components: [
          {
            compensationType: 'Salary',
            interval: '1 YEAR',
            currencyCode: 'USD',
            minValue: 240000,
            maxValue: 300000,
          },
        ],
      },
    ]);
    expect(range).toEqual({ min: 211400, max: 300000, currency: 'USD' });
  });

  it('swaps a reversed min and max', () => {
    expect(
      yearlySalary([
        {
          components: [
            {
              compensationType: 'Salary',
              interval: '1 YEAR',
              currencyCode: 'USD',
              minValue: 300,
              maxValue: 100,
            },
          ],
        },
      ]),
    ).toEqual({ min: 100, max: 300, currency: 'USD' });
  });

  it('uses the only currency when there is no USD, and returns empty when nothing qualifies', () => {
    expect(
      yearlySalary([
        {
          components: [
            {
              compensationType: 'Salary',
              interval: '1 YEAR',
              currencyCode: 'GBP',
              minValue: 80_000,
              maxValue: 90_000,
            },
          ],
        },
      ]),
    ).toEqual({ min: 80000, max: 90000, currency: 'GBP' });
    expect(yearlySalary([])).toEqual({ min: null, max: null, currency: null });
    expect(yearlySalary(null)).toEqual({ min: null, max: null, currency: null });
  });
});

describe('toUtcIso', () => {
  it('converts offsets and epoch milliseconds, and rejects junk', () => {
    expect(toUtcIso('2026-09-03T13:32:53-04:00')).toBe('2026-09-03T17:32:53.000Z');
    expect(toUtcIso(Date.UTC(2026, 9, 22))).toBe('2026-10-22T00:00:00.000Z');
    expect(toUtcIso('not a date')).toBeNull();
    expect(toUtcIso(null)).toBeNull();
    expect(toUtcIso('')).toBeNull();
  });
});

describe('richTextToPlain', () => {
  it('decodes Greenhouse-escaped HTML before stripping tags', () => {
    const text = richTextToPlain('&lt;p&gt;Hello &amp; welcome&lt;/p&gt;&lt;li&gt;One&lt;/li&gt;');
    expect(text).toBe('Hello & welcome\nOne');
    expect(text).not.toContain('&lt;');
  });
});
