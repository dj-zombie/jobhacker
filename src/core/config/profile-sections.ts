import { z } from 'zod';
import type { Profile } from './schemas.js';

/** The `profile.yaml` sections Settings edits (J18). Projects and `cover_note` stay as written. */
export const PROFILE_SECTIONS = [
  'contact',
  'links',
  'summary',
  'skills',
  'experience',
  'education',
  'standard_answers',
  'self_identification',
] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

export function isProfileSection(value: string): value is ProfileSection {
  return (PROFILE_SECTIONS as readonly string[]).includes(value);
}

/** Sections `renderProfile` includes, so an edit to one changes the score cache key (D30). */
export const SCORED_SECTIONS: readonly ProfileSection[] = ['summary', 'skills', 'experience'];

export const SELF_ID_KEYS = [
  'gender',
  'race_ethnicity',
  'veteran_status',
  'disability_status',
] as const;
export type SelfIdKey = (typeof SELF_ID_KEYS)[number];
export const DECLINE = 'decline';

const text = z.string().max(20_000);
const keyed = z.array(z.object({ key: text, value: text }).strict()).max(500);

/**
 * What Settings sends for each section. It's the file's shape, except that maps whose keys
 * Kris can rename (skill groups, answers, self-ID overrides) are lists of rows, optional
 * fields are `''` when unset, and a new entry or bullet has no `id` yet.
 */
export const sectionInputSchemas = {
  contact: z.object({ name: text, email: text, phone: text, location: text }).strict(),
  links: z.object({ linkedin: text, github: text, portfolio: text }).strict(),
  summary: text,
  skills: z.array(z.object({ group: text, items: z.array(text).max(1000) }).strict()).max(100),
  experience: z
    .array(
      z
        .object({
          id: text.optional(),
          company: text,
          title: text,
          start: text,
          end: text,
          location: text,
          bullets: z.array(z.object({ id: text.optional(), text }).strict()).max(200),
        })
        .strict(),
    )
    .max(200),
  education: z
    .array(
      z
        .object({ id: text.optional(), school: text, credential: text, start: text, end: text })
        .strict(),
    )
    .max(50),
  standard_answers: keyed,
  self_identification: z
    .object({
      gender: text,
      race_ethnicity: text,
      veteran_status: text,
      disability_status: text,
      overrides: keyed,
    })
    .strict(),
} satisfies Record<ProfileSection, z.ZodTypeAny>;

export type SectionInputs = { [S in ProfileSection]: z.infer<(typeof sectionInputSchemas)[S]> };

/** The stored profile, in the shape Settings edits. */
export function toSectionInputs(profile: Profile): SectionInputs {
  const self = profile.self_identification;
  return {
    contact: { ...profile.contact },
    links: {
      linkedin: profile.links.linkedin ?? '',
      github: profile.links.github ?? '',
      portfolio: profile.links.portfolio ?? '',
    },
    summary: profile.summary,
    skills: Object.entries(profile.skills).map(([group, items]) => ({ group, items: [...items] })),
    experience: profile.experience.map((e) => ({
      id: e.id,
      company: e.company,
      title: e.title,
      start: e.start,
      end: e.end,
      location: e.location ?? '',
      bullets: e.bullets.map((b) => ({ id: b.id, text: b.text })),
    })),
    education: profile.education.map((e) => ({
      id: e.id,
      school: e.school,
      credential: e.credential ?? '',
      start: e.start ?? '',
      end: e.end ?? '',
    })),
    standard_answers: Object.entries(profile.standard_answers).map(([key, value]) => ({
      key,
      value,
    })),
    self_identification: {
      gender: self?.gender ?? DECLINE,
      race_ethnicity: self?.race_ethnicity ?? DECLINE,
      veteran_status: self?.veteran_status ?? DECLINE,
      disability_status: self?.disability_status ?? DECLINE,
      overrides: Object.entries(self?.overrides ?? {}).map(([key, value]) => ({ key, value })),
    },
  };
}

/**
 * A skill group's items as one editable text: comma-separated, or one per line when an item
 * has a comma in it, so `skillItemsFromText` always gives the same list back.
 */
export function skillItemsToText(items: readonly string[]): string {
  return items.join(items.some((item) => item.includes(',')) ? '\n' : ', ');
}

/** The items in a skill group's text: split on lines when there's more than one, else on commas. */
export function skillItemsFromText(text: string): string[] {
  const parts = text.includes('\n') ? text.split('\n') : text.split(',');
  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

/** A date that is a year and nothing else, like `2012`. Forms with a month picker leave its month blank. */
export function isYearOnly(date: string): boolean {
  return /^\d{4}$/.test(date.trim());
}

/** A value with a `[NEEDS INPUT …]` marker. The filler leaves that field blank and lists it. */
export function needsInput(value: string): boolean {
  return /\[NEEDS INPUT/i.test(value);
}
