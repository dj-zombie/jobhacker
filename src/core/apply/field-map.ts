import type { Profile } from '../config/schemas.js';
import { countryFromLocation } from './location.js';
import type { RawFormField } from './types.js';

/**
 * Deterministic field mapping (ARCHITECTURE § Flows "Apply assist" step 3).
 * Pure functions, fully unit-tested with no browser. Rules run in order:
 *   1. EEO / self-identification fields map to `eeo` here and are filled
 *      deterministically from `profile.yaml` by `self-id.ts` (invariant 7,
 *      D66) — never by these rules and never by the LLM.
 *   2. A resume / cover-letter file input maps to that PDF.
 *   3. Known profile fields (contact, links, location, country, current role,
 *      education, cover note) map from the profile by label keywords.
 *   4. An answer saved under this exact question (drafted for this form, or
 *      typed by Kris) is used; otherwise the standard answers are matched by
 *      normalized label text.
 * A rule that matches but has no usable value (missing, or still a
 * `[NEEDS INPUT: …]` marker) yields `needs_input`, so the field is reported
 * unfilled with the reason rather than filled with a guess. `unmapped` means
 * no rule applies: an open question for the drafting step.
 */

/** EEO / voluntary self-identification keywords (invariant 7). */
const EEO_RE =
  /\b(gender|sex|race|ethnic|ethnicity|hispanic|latino|latinx|latina|veteran|disab|disability|sexual orientation|pronoun|pronouns|transgender|national origin)\b/i;

export function isEeoField(label: string): boolean {
  return EEO_RE.test(label);
}

/** Split a full name into first / last (last = everything after the first token). */
export function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0] as string, last: '' };
  return { first: parts[0] as string, last: parts.slice(1).join(' ') };
}

/** A value is usable only if it is present and not a NEEDS INPUT placeholder. */
export function isUsable(value: string | undefined | null): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !/\[NEEDS INPUT/i.test(value);
}

export type FieldMapping =
  | { kind: 'eeo' }
  | { kind: 'file'; source: 'resume' | 'cover_letter' }
  | { kind: 'value'; via: 'profile' | 'answer' | 'draft' | 'cover'; source: string; value: string }
  | { kind: 'needs_input'; source: string; reason: string }
  | { kind: 'unmapped' };

export interface MapContext {
  profile: Profile;
  /**
   * key → answer text. Standard answers use snake_case keys; answers to a
   * specific form question are keyed by `questionKey(label)`.
   */
  answers: Record<string, string>;
  /** The application's cover note, for a cover-letter text box. */
  coverNote?: string | null;
  /**
   * A cover letter can be attached even when the note has a gap: Kris keeps
   * a written cover letter at `input/cover-letter.pdf`, which the caller
   * falls back to for a file upload (never for a text box).
   */
  coverLetterAvailable?: boolean;
}

/** The key an answer to a form question is saved under: its label, tidied. */
export function questionKey(label: string): string {
  return label
    .replace(/\s+/g, ' ')
    .replace(/\s*\*+\s*$/, '')
    .trim();
}

/** Standard (profile) answer keys are snake_case; form-question keys are prose. */
export function isStandardKey(key: string): boolean {
  return /^[a-z0-9_]+$/.test(key);
}

/** The roles marked current (end "present"), in profile order. */
function currentRoles(profile: Profile): Profile['experience'] {
  return profile.experience.filter((e) => /present|current|now/i.test(e.end));
}

/** Education to report on a form: the first entry, as Kris ordered them. */
function primaryEducation(profile: Profile): Profile['education'][number] | undefined {
  return profile.education[0];
}

function disciplineOf(credential: string | undefined): string {
  return (credential ?? '').replace(/\bcoursework\b/i, '').trim();
}

function githubHandle(url: string | undefined): string {
  if (!url) return '';
  const m = url.match(/github\.com\/([A-Za-z0-9-]+)/i);
  return m?.[1] ?? '';
}

/** The option a "working status with <Company>" question gets when Kris never worked there. */
const NEVER_EMPLOYED = 'Never employed or contracted';

/** Ordered profile rules: a label test and the value it maps to. */
function profileRules(
  profile: Profile,
  field: Pick<RawFormField, 'label' | 'hint'>,
): { test: RegExp; source: string; value: string }[] {
  const { first, last } = splitName(profile.contact.name);
  const links = profile.links;
  const current = currentRoles(profile)[0];
  const edu = primaryEducation(profile);
  const wantsUsername = /user\s?name|handle/i.test(`${field.label} ${field.hint ?? ''}`);
  return [
    { test: /first name|given name|forename/i, source: 'contact.first_name', value: first },
    {
      test: /last name|surname|family name/i,
      source: 'contact.last_name',
      value: last,
    },
    {
      test: /full name|legal name|your name|^name$/i,
      source: 'contact.name',
      value: profile.contact.name,
    },
    { test: /e-?mail/i, source: 'contact.email', value: profile.contact.email },
    { test: /phone|mobile|telephone/i, source: 'contact.phone', value: profile.contact.phone },
    { test: /linkedin/i, source: 'links.linkedin', value: links.linkedin ?? '' },
    wantsUsername
      ? { test: /github/i, source: 'links.github', value: githubHandle(links.github) }
      : { test: /github/i, source: 'links.github', value: links.github ?? '' },
    {
      test: /portfolio|personal website|personal site|\bwebsite\b|^url$/i,
      source: 'links.portfolio',
      value: links.portfolio ?? '',
    },
    {
      // The country Kris lives in ("Country", "What country are you based
      // in?"), never citizenship, nationality or work authorization.
      test: /^(?!.*(citizen|national|passport|authori|eligib|visa|permit))(?:.*\b(what|which) country\b.*\b(based|located|live|reside|residing)\b|(current )?country( of residence)?\s*\*?$)/i,
      source: 'contact.country',
      value: countryFromLocation(profile.contact.location) ?? '',
    },
    {
      // "location" / "city" as a field name. Do not match "based in" or
      // "where are you" — those are screening questions, not the city field.
      test: /\b(location|city|town|where are you located|where are you based)\b/i,
      source: 'contact.location',
      value: profile.contact.location,
    },
    {
      test: /\b(current|most recent|present) (company|employer|organi[sz]ation)\b/i,
      source: 'experience.current.company',
      value: current?.company ?? '',
    },
    {
      test: /\b(current|most recent|present) (job )?(title|role|position)\b/i,
      source: 'experience.current.title',
      value: current?.title ?? '',
    },
    {
      test: /^(school|university|college|institution|school name|university name)\s*\*?$/i,
      source: 'education.school',
      value: edu?.school ?? '',
    },
    {
      test: /^(discipline|major|field of study|area of study)\s*\*?$/i,
      source: 'education.discipline',
      value: disciplineOf(edu?.credential),
    },
  ];
}

/** A cover-letter text box (not a file input). */
const COVER_TEXT_RE = /\bcover (letter|note)\b/i;

const STOPWORDS = new Set([
  'are',
  'you',
  'to',
  'the',
  'in',
  'a',
  'an',
  'of',
  'for',
  'do',
  'does',
  'is',
  'this',
  'that',
  'with',
  'on',
  'at',
  'by',
  'be',
  'been',
  'what',
  'which',
  'please',
  'select',
  'choose',
  'enter',
  'provide',
  'your',
  'our',
  'about',
  'now',
  'future',
  'any',
  'if',
  'can',
  'and',
  'or',
]);

// Ordered most-specific first so related forms reduce to the same root, e.g.
// "authorization"/"authorized"/"authorize" → "author"; "expectation(s)" → "expect".
const STEM_SUFFIXES = [
  'izations',
  'ization',
  'isation',
  'ations',
  'ation',
  'izing',
  'izes',
  'ized',
  'ize',
  'ships',
  'ship',
  'ing',
  'ied',
  'ies',
  'ed',
  'es',
  's',
];

function stem(token: string): string {
  for (const suf of STEM_SUFFIXES) {
    if (token.length > suf.length + 2 && token.endsWith(suf)) return token.slice(0, -suf.length);
  }
  return token;
}

/** Lowercase → split → drop stopwords → stem. */
export function significantTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
    .map(stem);
}

/** Human-readable label from an answer key (`work_authorization_us` → words). */
function keyPhrase(key: string): string {
  return key.replace(/[_-]+/g, ' ');
}

/**
 * Match a form label to the best prepared-answer key by token overlap. Returns
 * the key when at least 60% of the answer's significant tokens appear in the
 * label (and at least one token matches); otherwise `undefined`.
 */
export function matchAnswerKey(label: string, answerKeys: string[]): string | undefined {
  const labelTokens = new Set(significantTokens(label));
  if (labelTokens.size === 0) return undefined;

  let best: { key: string; matched: number; ratio: number } | undefined;
  for (const key of answerKeys) {
    const keyTokens = significantTokens(keyPhrase(key));
    if (keyTokens.length === 0) continue;
    // A long essay that happens to contain "how did you" is not that short question.
    if (labelTokens.size > keyTokens.length + 4) continue;
    let matched = 0;
    for (const t of keyTokens) if (labelTokens.has(t)) matched++;
    const ratio = matched / keyTokens.length;
    if (matched >= 1 && ratio >= 0.6) {
      if (!best || matched > best.matched || (matched === best.matched && ratio > best.ratio)) {
        best = { key, matched, ratio };
      }
    }
  }
  return best?.key;
}

/** Why a saved answer cannot be used: its marker text, or that it is blank. */
function unusableReason(value: string | undefined): string {
  const marker = value?.match(/\[NEEDS INPUT[^\]]*\]/i)?.[0];
  return marker ?? 'nothing in your profile answers this; left for you';
}

function coverNoteGap(coverNote: string | null | undefined): FieldMapping {
  const marker = coverNote?.match(/\[NEEDS INPUT[^\]]*\]/i)?.[0];
  return {
    kind: 'needs_input',
    source: 'cover_note',
    reason: marker
      ? `your cover note still has a gap, ${marker}; fill it in on the application page, then fill again`
      : 'no cover note yet; write one on the application page, then fill again',
  };
}

export function mapField(field: RawFormField, ctx: MapContext): FieldMapping {
  // A radio button answers its group's question; the option is its own label.
  const question = field.group ?? field.label;

  // 1. Self-identification: resolved from profile.yaml by self-id.ts (D66).
  if (field.inEeoSection || isEeoField(question)) return { kind: 'eeo' };

  // 2. Resume / cover-letter file input. Greenhouse labels the control
  // "Attach" and puts "resume" / "cover_letter" on the id; Lever uses id/name
  // "resume". An empty label is still treated as the resume (a single
  // unlabeled file input; Ashby's unlabeled autofill uploader is excluded by
  // its adapter before it gets here).
  if (field.isFile) {
    const hint = `${field.label} ${field.name ?? ''} ${field.id ?? ''} ${field.hint ?? ''}`;
    // "Apply with resume" is the site's own autocomplete uploader, not the
    // résumé field. Leaving it empty keeps that parser from running.
    if (/apply-with|autofill|autocomplete/i.test(hint)) return { kind: 'unmapped' };
    if (/resume|curriculum|\bcv\b/i.test(hint) || field.label.trim() === '') {
      return { kind: 'file', source: 'resume' };
    }
    if (/cover/i.test(hint)) {
      return isUsable(ctx.coverNote) || ctx.coverLetterAvailable
        ? { kind: 'file', source: 'cover_letter' }
        : coverNoteGap(ctx.coverNote);
    }
    return { kind: 'unmapped' };
  }

  // 3a. A cover-letter text box gets the application's cover note.
  if (COVER_TEXT_RE.test(question) && field.tag !== 'select' && field.tag !== 'toggle') {
    if (isUsable(ctx.coverNote)) {
      return { kind: 'value', via: 'cover', source: 'cover_note', value: ctx.coverNote };
    }
    return coverNoteGap(ctx.coverNote);
  }

  // 3a-bis. A hiring-team note ("Let the company know about your interest…")
  // is not a cover letter: a gap in the cover note must not leave it blank.
  // It gets the profile summary verbatim, drafted (outlined amber) for review.
  if (
    /let the company know|message to the hiring|hiring (team|manager) (message|note)|about your interest/i.test(
      question,
    ) &&
    field.tag === 'textarea'
  ) {
    if (isUsable(ctx.profile.summary)) {
      return { kind: 'value', via: 'draft', source: 'profile.summary', value: ctx.profile.summary };
    }
    return {
      kind: 'needs_input',
      source: 'profile.summary',
      reason: 'no usable profile summary to base a hiring note on',
    };
  }

  // 3b. Known profile fields by label keyword.
  if (!field.group) {
    for (const rule of profileRules(ctx.profile, field)) {
      if (rule.test.test(question)) {
        if (isUsable(rule.value)) {
          return { kind: 'value', via: 'profile', source: rule.source, value: rule.value };
        }
        return {
          kind: 'needs_input',
          source: rule.source,
          reason: `not in your profile (${rule.source})`,
        };
      }
    }
  }

  // 3c. "What's your working status with <Company>?" — answerable from the
  // profile's employer list alone: no role at that company means the
  // never-employed option (the filler picks the menu option this prefixes).
  const statusMatch = question.match(
    /(?:working|employment) status (?:with|at|for)\s+(.+?)\s*\??$/i,
  );
  if (statusMatch && !field.group) {
    const company = (statusMatch[1] ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    const employed = ctx.profile.experience.some((role) => {
      const employer = role.company.toLowerCase();
      return employer === company || employer.includes(company) || company.includes(employer);
    });
    if (!employed && company.length > 1) {
      return {
        kind: 'value',
        via: 'profile',
        source: 'experience.companies',
        value: NEVER_EMPLOYED,
      };
    }
  }

  // 4a. An answer saved for exactly this question (drafted, or typed by Kris).
  const exact = questionKey(question);
  if (exact in ctx.answers && !isStandardKey(exact)) {
    const value: string | undefined = ctx.answers[exact];
    const blankOnPurpose = value !== undefined && value.trim() === '';
    if (isUsable(value)) return { kind: 'value', via: 'draft', source: exact, value };
    return {
      kind: 'needs_input',
      source: exact,
      reason: blankOnPurpose
        ? 'blank on purpose — you recorded no answer for this question'
        : unusableReason(value),
    };
  }

  // 4b. Standard answers, by label tokens. Only snake_case keys take part, so
  // a saved answer to one question is never fuzzily reused for another.
  const key = matchAnswerKey(question, Object.keys(ctx.answers).filter(isStandardKey));
  if (key) {
    const value = ctx.answers[key];
    if (isUsable(value)) return { kind: 'value', via: 'answer', source: key, value };
    return { kind: 'needs_input', source: key, reason: unusableReason(value) };
  }

  return { kind: 'unmapped' };
}

/**
 * The profile value behind a filled field, for showing the fill report back to
 * Kris: the value of the rule named by `source`, or for a bare `profile` source
 * the first rule whose label test matches. `undefined` when the source names no
 * single value (an experience or education entry) or the value is unusable.
 */
export function profileValue(profile: Profile, source: string, label: string): string | undefined {
  if (source === 'experience.companies') return NEVER_EMPLOYED;
  const question = questionKey(label);
  const rules = profileRules(profile, { label: question });
  const rule =
    source === 'profile'
      ? rules.find((r) => r.test.test(question))
      : rules.find((r) => r.source === source);
  return rule && isUsable(rule.value) ? rule.value : undefined;
}

/**
 * Choose the react-select option whose visible text best matches `desired`.
 * Each option carries an opaque `tag` (a selector the caller can click). Reuses
 * the same equality/substring/token logic as `matchOption`. Returns the tag of
 * the best option, or `undefined` when nothing reasonable matches.
 */
export function matchComboOption(
  options: { text: string; tag: string }[],
  desired: string,
): string | undefined {
  // matchOption treats an empty `value` as unselectable, so carry the tag there.
  const asOptions = options
    .filter((o) => o.tag !== '')
    .map((o) => ({ value: o.tag, label: o.text }));
  return matchOption(asOptions, desired);
}

/**
 * The Yes/No toggle option for an answer: the option whose label equals the
 * answer, or else the one named by the answer's leading "Yes" or "No" word
 * ("Yes, to Denver, CO" → Yes). Substring matching is too loose for two
 * short labels: "Yes, but not before May" contains "no".
 */
export function matchToggleOption<T extends { label: string }>(
  options: T[],
  answer: string,
): T | undefined {
  const want = answer.trim().toLowerCase();
  const exact = options.find((o) => o.label.trim().toLowerCase() === want);
  if (exact) return exact;
  const lead = /^(yes|no)\b/.exec(want)?.[1];
  if (!lead) return undefined;
  return options.find((o) => o.label.trim().toLowerCase() === lead);
}

/**
 * For a `<select>`, find the option value that best matches the desired text.
 * Matches on exact (case-insensitive) label or value first, then substring,
 * then token overlap. Returns `undefined` when nothing reasonable matches.
 */
export function matchOption(
  options: { value: string; label: string }[],
  desired: string,
): string | undefined {
  const want = desired.trim().toLowerCase();
  if (want === '') return undefined;

  const selectable = options.filter((o) => o.value !== '');
  for (const o of selectable) {
    if (o.label.toLowerCase() === want || o.value.toLowerCase() === want) return o.value;
  }
  for (const o of selectable) {
    const l = o.label.toLowerCase();
    if (l.includes(want) || want.includes(l)) return o.value;
  }
  const wantTokens = new Set(significantTokens(desired));
  for (const o of selectable) {
    const tokens = significantTokens(o.label);
    if (tokens.length > 0 && tokens.every((t) => wantTokens.has(t))) return o.value;
  }
  return undefined;
}
