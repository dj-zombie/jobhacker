import type { Profile } from '../config/schemas.js';
import { isEeoField, matchOption } from './field-map.js';

/**
 * Deterministic self-identification mapper (invariant 7 as amended, D66).
 *
 * EEO / voluntary self-identification fields are filled ONLY from the
 * `self_identification` block in `profile.yaml`, exactly as written there.
 * This module is pure and is the only place those values are resolved: the
 * LLM field mapper never receives these fields (`llm-map.ts` drops them
 * before the prompt is built), and no value is ever derived from a name,
 * resume, or context.
 *
 * When no answer is configured for a field, the configured value is
 * `decline`: the form's own decline option is selected when one exists.
 * When no decline option exists either, the field is left blank and the
 * caller lists it in the fill report as needing input. Never a guess.
 */

export type SelfIdCategory = 'gender' | 'race_ethnicity' | 'veteran_status' | 'disability_status';

const CATEGORIES: { category: SelfIdCategory; test: RegExp }[] = [
  { category: 'veteran_status', test: /\bveteran\b/i },
  { category: 'disability_status', test: /\bdisab/i },
  {
    category: 'race_ethnicity',
    test: /\b(race|ethnic|ethnicity|hispanic|latino|latinx|latina)\b/i,
  },
  {
    category: 'gender',
    test: /\b(gender|sex|transgender)\b/i,
  },
];

/** Which configured answer (if any) owns this field's label. */
export function selfIdCategory(label: string): SelfIdCategory | null {
  for (const { category, test } of CATEGORIES) {
    if (test.test(label)) return category;
  }
  return null;
}

/** True when this label names a self-identification field at all. */
export function isSelfIdField(label: string): boolean {
  return isEeoField(label);
}

const DECLINE_RE =
  /decline|prefer not|do not wish|don't wish|not wish|rather not|refuse to|no answer|not (?:to )?disclose|skip this/i;

export function isDeclineOption(optionLabel: string): boolean {
  return DECLINE_RE.test(optionLabel);
}

/**
 * The value Kris configured for this field: his override for the category
 * when present, else the category's value, else `decline`. Pronoun fields
 * have no category key, so only an `overrides.pronouns` entry (or decline)
 * can answer them.
 */
export function configuredSelfIdValue(profile: Profile, label: string): string {
  const block = profile.self_identification;
  // Pronouns have no category key of their own: only an explicit
  // `overrides.pronouns` entry answers them (never the gender value).
  if (/\bpronouns?\b/i.test(label)) {
    const pronouns = block?.overrides?.pronouns;
    return pronouns && pronouns.trim().length > 0 ? pronouns.trim() : 'decline';
  }
  const category = selfIdCategory(label);
  const override = category ? block?.overrides?.[category] : undefined;
  if (override && override.trim().length > 0) return override.trim();
  if (category && block?.[category]) return block[category].trim();
  return 'decline';
}

/**
 * Pick the option text to select from a harvested option list, or
 * `undefined` when nothing on the form honestly matches the configured
 * value (the caller then leaves the field blank and flags it).
 *
 * `decline` matches only a real decline option — never a substantive
 * answer like "No, I do not have a disability", which is a disclosure
 * Kris has not made unless he wrote it in `profile.yaml`.
 */
export function pickSelfIdOption(options: string[], configured: string): string | undefined {
  const usable = options.map((o) => o.trim()).filter((o) => o.length > 0);
  if (usable.length === 0) return undefined;
  if (configured.trim().toLowerCase() === 'decline') {
    return usable.find((o) => isDeclineOption(o));
  }
  const want = configured.trim().toLowerCase();
  const exact = usable.find((o) => o.toLowerCase() === want);
  if (exact) return exact;
  // Forms word the same answer differently ("Man" vs "Male", "Woman" vs
  // "Female"). Those pairs name the same option Kris picked, in his words.
  const canonical = (text: string) =>
    text
      .toLowerCase()
      .replace(/\bman\b/g, 'male')
      .replace(/\bwoman\b/g, 'female')
      .replace(/\bmen\b/g, 'male')
      .replace(/\bwomen\b/g, 'female');
  const synonym = usable.find((o) => canonical(o) === canonical(configured));
  if (synonym) return synonym;
  const matched = matchOption(
    usable.map((o) => ({ value: o, label: o })),
    configured,
  );
  return matched;
}
