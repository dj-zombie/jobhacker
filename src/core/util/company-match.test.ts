import { describe, expect, it } from 'vitest';
import { type TargetOrderRow, companyOnList, preferTargetCompanies } from './company-match.js';

describe('companyOnList', () => {
  it('matches a normalized name and a listed name inside the stored name', () => {
    expect(companyOnList('Stripe, Inc.', ['Stripe'])).toBe('Stripe');
    expect(companyOnList('Riot Games', ['Riot'])).toBe('Riot');
    expect(companyOnList('Metabase', ['Meta'])).toBeNull();
  });

  it('returns the first listed spelling that matches', () => {
    expect(companyOnList('Riot Games', ['Meta', 'Riot'])).toBe('Riot');
  });
});

function row(
  partial: Partial<TargetOrderRow> & Pick<TargetOrderRow, 'companyName'>,
): TargetOrderRow {
  return {
    current: false,
    inFirst: false,
    inIndustry: false,
    tier: 1,
    ...partial,
  };
}

describe('preferTargetCompanies', () => {
  it('keeps the given order when the list is empty', () => {
    const rows = [row({ companyName: 'Nike' }), row({ companyName: 'Acme' })];
    expect(preferTargetCompanies(rows, [])).toEqual(rows);
  });

  it('takes a not-yet-current listed company first inside the same tier', () => {
    const acme = row({ companyName: 'Acme' });
    const nike = row({ companyName: 'Nike, Inc.' });
    expect(preferTargetCompanies([acme, nike], ['Nike']).map((item) => item.companyName)).toEqual([
      'Nike, Inc.',
      'Acme',
    ]);
  });

  it('does not move a listed company that is already scored under the current key', () => {
    const acme = row({ companyName: 'Acme' });
    const nike = row({ companyName: 'Nike', current: true });
    expect(preferTargetCompanies([acme, nike], ['Nike']).map((item) => item.companyName)).toEqual([
      'Acme',
      'Nike',
    ]);
  });

  it('keeps industry and place groups, and deferred work, ahead of a listed job', () => {
    const listed = row({ companyName: 'Nike' });
    const industry = row({ companyName: 'Epic', inIndustry: true });
    const place = row({ companyName: 'Local', inFirst: true });
    const deferred = row({ companyName: 'Waiting', tier: 0 });
    expect(
      preferTargetCompanies([listed, deferred, place, industry], ['Nike']).map(
        (item) => item.companyName,
      ),
    ).toEqual(['Epic', 'Local', 'Waiting', 'Nike']);
  });
});
