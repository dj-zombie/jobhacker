import { describe, expect, it } from 'vitest';
import { type RemoteType, classifyPlaces } from './places.js';

/*
  Real location strings from public ATS postings (Oct 2026) plus the classic traps.
  Every row is [location, remote type, expected areas].
*/
const CASES: [string, RemoteType, string[]][] = [
  // Portland metro
  ['Portland, OR', 'onsite', ['portland']],
  ['Portland, OR / Hybrid', 'hybrid', ['portland']], // Panthalassa recruiter role
  ['Hybrid - Portland, OR', 'hybrid', ['portland']],
  ['Portland (Hybrid)', 'hybrid', ['portland']],
  ['Beaverton, Oregon, United States', 'onsite', ['portland']],
  ['Hillsboro, OR', 'onsite', ['portland']],
  ['Vancouver, WA', 'onsite', ['portland']], // Panthalassa pilot manufacturing, across the river
  ['Greater Portland Area', 'onsite', ['portland']],
  ['Oregon', 'onsite', ['portland']],
  // Fictiv: multi-location, Portland preferred, remote limited to three states
  ['Oakland, CA or Portland, OR preferred | Open to remote in CA, OR, WA', 'onsite', ['portland']],
  // Phoenix metro
  ['Phoenix, Arizona', 'onsite', ['phoenix']], // SmartRent
  ['Avondale, Arizona', 'onsite', ['phoenix']], // SmartRent
  ['Scottsdale, AZ', 'hybrid', ['phoenix']],
  ['Tempe, USA', 'onsite', ['phoenix']],
  ['Chandler, AZ 85226', 'onsite', ['phoenix']],
  ['Glendale, AZ', 'onsite', ['phoenix']],
  ['Mesa, AZ', 'onsite', ['phoenix']],
  ['Greater Phoenix Area', 'onsite', ['phoenix']],
  // Remote
  ['US - Remote', 'remote', ['remote']], // Smarsh: Portland HQ, remote role
  ['Remote - US', 'remote', ['remote']],
  ['Remote (United States)', 'remote', ['remote']],
  ['Remote, Global', 'remote', ['remote']],
  ['Remote', 'remote', ['remote']],
  ['USA (Remote)', 'remote', ['remote']],
  ['New York, NY (Remote)', 'remote', ['remote']],
  ['North America', 'remote', ['remote']], // Linear
  ['United States', 'remote', ['remote']],
  ['Albuquerque, NM, USA Remote', 'remote', ['remote']], // Speechify: city is SEO, the job is remote
  ['Tempe, USA Remote', 'remote', ['remote']], // ...so this is Remote, not Phoenix
  ['Remote in Oregon', 'remote', ['portland']], // state-limited remote counts for that place only
  ['Portland, OR; Remote - US', 'hybrid', ['portland', 'remote']],
  // Traps: none of these are Kris's areas
  ['Toronto, ON', 'onsite', []], // the telehealth company literally named "Phoenix"
  ['Vancouver, BC', 'onsite', []],
  ['Vancouver', 'onsite', []],
  ['Portland, ME', 'onsite', []],
  ['Glendale, CA', 'onsite', []],
  ['Costa Mesa, CA', 'onsite', []],
  ['Peoria, IL', 'onsite', []],
  ['San Francisco, CA', 'hybrid', []],
  ['Oakland, CA Office', 'onsite', []],
  ['California, USA', 'hybrid', []],
  ['Remote, Poland', 'remote', []],
  ['United Kingdom (Remote)', 'remote', []],
  ['Brazil (Remote)', 'remote', []],
  ['Remote - Latin America', 'remote', []],
  ['Spain', 'remote', []],
  ['Lisbon, Portugal', 'onsite', []],
  ['Tel Aviv', 'hybrid', []],
  ['Hybrid', 'hybrid', []],
  ['Office Location Flexible', 'unknown', []],
  ['Albuquerque, New Mexico', 'onsite', []], // "Mexico" inside "New Mexico" is not abroad
  // J3 hand-check of the real database (2026-10-25): misfiled before the rule fixes.
  ['Arizona, United States', 'onsite', ['phoenix']], // a state and the country is the state
  ['Oregon, Ohio, United States', 'onsite', []], // ...but Oregon, Ohio is a city in Ohio
  ['Remote (Washington, Oregon, Idaho, Montana, Wyoming, Utah only)', 'remote', ['portland']],
  ['Remote (Michigan, Minnesota, Wisconsin, or Iowa only)', 'remote', []],
  ['Remote (Northern CA and Nevada only)', 'remote', []],
  ['Remote (UT or ID residents only) | Full-time | $7.25–$10/hr', 'remote', []],
  ['Remote - Located in CA, CO, NY, TX, FL, GA, MA, NJ, PA', 'remote', []],
  [
    '| [REMOTE (US) only currently residing in: Alabama, Florida, Georgia, Michigan, Mississippi, Missouri, North Carolina, Oklahoma, Tennessee, Texas, or Virginia.] | Full-time',
    'remote',
    [],
  ],
  ['Remote, AR, AZ, FL, KS, GA, MO, NC, SC, TN, TX, UT, VA', 'remote', ['phoenix']],
  [
    'California, Arizona, Washington, Colorado, Utah, Nevada, Oregon, US Remote',
    'remote',
    ['portland', 'phoenix'],
  ],
  // ...and what those fixes must leave alone.
  ['Remote (US Only) | https://www.sphinxdefense.com', 'remote', ['remote']],
  ['REMOTE (US only) or NYC/Dallas', 'remote', ['remote']],
  ['Remote, CA, Oklahoma, LA, or TX preferred', 'remote', ['remote']], // preferred isn't limited
  ['Georgia, USA, Remote', 'remote', ['remote']], // one state is the Speechify pattern
  ['Washington, DC, Remote', 'remote', ['remote']],
  ['Remote (Global / US/EU/Africa time zones welcome)', 'remote', ['remote']],
  ['REMOTE (US or Canada) | Full Time', 'remote', ['remote']],
  ['Full-Time | REMOTE (US & Canada) | $150,000 - $180,000 USD', 'remote', ['remote']],
  ['REMOTE (Americas: US or LatAm) | Part-time contract', 'remote', ['remote']],
  ['REMOTE (AMER or EMEA time zones) | Full-time', 'remote', ['remote']],
  ['Remote (US/Canada only) | Full-time', 'remote', ['remote']],
];

describe('classifyPlaces', () => {
  it.each(CASES)('%s (%s) -> %j', (location, remote, expected) => {
    expect(classifyPlaces({ location, remote }).areas).toEqual(expected);
  });

  it('falls back to a city in the title only when the location is empty', () => {
    expect(
      classifyPlaces({
        location: '',
        remote: 'unknown',
        title: 'Senior Software Engineer (Portland)',
      }).areas,
    ).toEqual(['portland']);
    expect(
      classifyPlaces({ location: 'Remote - US', remote: 'remote', title: 'Engineer (Portland)' })
        .areas,
    ).toEqual(['remote']);
  });

  it('records the evidence for each area', () => {
    const c = classifyPlaces({
      location: 'Oakland, CA or Portland, OR preferred | Open to remote in CA, OR, WA',
      remote: 'onsite',
    });
    expect(c.evidence.portland).toBe('Portland, OR preferred');
    expect(c.remoteStates).toEqual(['CA', 'OR', 'WA']);
  });

  it("never reads the company name, because it isn't an input", () => {
    // A company called "Phoenix" (Toronto) posting "Senior Frontend Developer (React)".
    expect(
      classifyPlaces({
        location: 'Toronto, ON',
        remote: 'onsite',
        title: 'Senior Frontend Developer (React)',
      }).areas,
    ).toEqual([]);
  });
});
