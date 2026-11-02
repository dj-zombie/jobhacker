/**
 * Location helpers for form filling (pure). The profile stores a location like
 * "Phoenix, AZ"; location typeaheads offer "Phoenix, Arizona, United States".
 * These map one to the other and derive the country, without guessing: an
 * unrecognised region yields `undefined`, and the field is left for Kris.
 */

const US_STATES: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
};

const US_NAMES = new Set([
  'us',
  'usa',
  'u.s.',
  'u.s.a.',
  'united states',
  'united states of america',
]);

interface ParsedLocation {
  city: string;
  /** Full US state name when the region is a US state. */
  state?: string;
  /** Country, when stated or implied by a US state. */
  country?: string;
}

function stateName(part: string): string | undefined {
  const code = part.trim().toUpperCase();
  if (US_STATES[code]) return US_STATES[code];
  const lower = part.trim().toLowerCase();
  return Object.values(US_STATES).find((name) => name.toLowerCase() === lower);
}

export function parseLocation(location: string): ParsedLocation | undefined {
  const parts = location
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const city = parts[0];
  if (!city) return undefined;
  const rest = parts.slice(1);
  let state: string | undefined;
  let country: string | undefined;
  for (const part of rest) {
    const s = stateName(part);
    if (s && !state) {
      state = s;
      country = country ?? 'United States';
      continue;
    }
    if (US_NAMES.has(part.toLowerCase())) country = 'United States';
    else if (!state) country = part;
  }
  return { city, state, country };
}

/** The country a profile location is in, or `undefined` when it does not say. */
export function countryFromLocation(location: string): string | undefined {
  return parseLocation(location)?.country;
}

/** What to type into a location typeahead to get suggestions (the city). */
export function locationQuery(location: string): string {
  return parseLocation(location)?.city ?? location.trim();
}

/**
 * Pick the typeahead option for a profile location. The option's first part
 * must be the city, and its other parts must agree with the stated region.
 * Returns the option's tag, or `undefined` when no option is clearly it.
 */
export function matchLocationOption(
  options: { text: string; tag: string }[],
  location: string,
): string | undefined {
  const want = parseLocation(location);
  if (!want) return undefined;
  const city = want.city.toLowerCase();
  const matches = options.filter((o) => {
    const parts = o.text.split(',').map((p) => p.trim().toLowerCase());
    if (parts[0] !== city) return false;
    const rest = parts.slice(1);
    if (want.state) {
      const st = want.state.toLowerCase();
      const code = Object.keys(US_STATES).find((k) => US_STATES[k]?.toLowerCase() === st);
      if (!rest.some((p) => p === st || p === code?.toLowerCase())) return false;
    }
    if (want.country && !want.state) {
      if (!rest.some((p) => p === want.country?.toLowerCase())) return false;
    }
    return true;
  });
  return matches[0]?.tag;
}
