/**
 * Phone-widget helpers (pure). SmartRecruiters Easy Apply defaults the phone
 * country from the *job's* city, so typing a national number into a +61 widget
 * fails the site's own validation. The country must come from the profile
 * location (Phoenix, AZ → United States), and the box gets the national number
 * in the plain-digit form the widget formats itself.
 */

export interface PhoneCountry {
  /** ISO 3166-1 alpha-2 code the widget stores (`value="US"`). */
  iso: string;
  /** Country name to search the widget's dropdown with. */
  name: string;
  /** International dialing code, digits only. */
  dial: string;
}

const COUNTRIES: Record<string, PhoneCountry> = {
  'united states': { iso: 'US', name: 'United States', dial: '1' },
  'united states of america': { iso: 'US', name: 'United States', dial: '1' },
  usa: { iso: 'US', name: 'United States', dial: '1' },
  canada: { iso: 'CA', name: 'Canada', dial: '1' },
};

/** The phone country for a profile country name, or `undefined` if unmapped. */
export function phoneCountryFor(country: string | undefined | null): PhoneCountry | undefined {
  if (!country) return undefined;
  return COUNTRIES[country.trim().toLowerCase()];
}

/**
 * The national number to type once the widget's country is set: digits only,
 * with the country's own dialing code stripped when the stored number carries
 * it (a US number stored as 11 digits starting with 1).
 */
export function nationalNumber(phone: string, country: PhoneCountry): string {
  const digits = phone.replace(/\D/g, '');
  if (country.dial === '1' && digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1);
  }
  if (digits.startsWith(country.dial) && digits.length > country.dial.length + 6) {
    return digits.slice(country.dial.length);
  }
  return digits;
}
