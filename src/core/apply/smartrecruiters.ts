import type { Profile } from '../config/schemas.js';
import { genericAdapter } from './adapters/generic.js';
import { type FillDeps, fillForm } from './fill.js';
import type { SafePage } from './safe-page.js';
import type { FillReport, FilledField, RawFormField, UnfilledField } from './types.js';

/**
 * SmartRecruiters Easy Apply orchestration (RECOVERY step 1). The generic
 * fill covers the contact block, profiles, résumé and the hiring note. This
 * module adds what a one-page scan cannot see:
 *
 * - experience and education entries, which only exist after Add is clicked,
 *   one editor at a time, each committed with its own Save (Add/Save are not
 *   Submit; every click still goes through `SafePage`'s refusal);
 * - the wizard's Next button, clicked only when the site shows no validation
 *   error on the current page, after which the next page is filled too.
 *
 * A role whose profile date has no month ("2013") is not given an invented
 * January: it is reported unfilled with the reason. Exact duplicate roles in
 * the profile (same company, title and years, from the résumé/LinkedIn merge)
 * are entered once, keeping the copy with the most bullet text.
 */

const MONTHS: Record<string, { month: number; abbr: string }> = {
  jan: { month: 1, abbr: 'Jan' },
  feb: { month: 2, abbr: 'Feb' },
  mar: { month: 3, abbr: 'Mar' },
  apr: { month: 4, abbr: 'Apr' },
  may: { month: 5, abbr: 'May' },
  jun: { month: 6, abbr: 'Jun' },
  jul: { month: 7, abbr: 'Jul' },
  aug: { month: 8, abbr: 'Aug' },
  sep: { month: 9, abbr: 'Sep' },
  sept: { month: 9, abbr: 'Sep' },
  oct: { month: 10, abbr: 'Oct' },
  nov: { month: 11, abbr: 'Nov' },
  dec: { month: 12, abbr: 'Dec' },
};

export interface ProfileMonthYear {
  month: number;
  abbr: string;
  year: number;
  /** "MM/YYYY", the format the month-year picker displays. */
  display: string;
}

/** Parse "Nov 2025" / "AUG 2025" into a month-year; null when no month is stated. */
export function parseProfileMonthYear(value: string): ProfileMonthYear | null {
  const match = value.trim().match(/^([A-Za-z]+)\.?\s+(\d{4})$/);
  if (!match) return null;
  const month = MONTHS[(match[1] as string).toLowerCase()];
  const year = Number.parseInt(match[2] as string, 10);
  if (!month || !Number.isFinite(year)) return null;
  const mm = String(month.month).padStart(2, '0');
  return { ...month, year, display: `${mm}/${year}` };
}

/** True for an open-ended profile date ("PRESENT", "current", …). */
export function isPresent(value: string): boolean {
  return /present|current|now/i.test(value);
}

type Experience = Profile['experience'][number];

function norm(value: string): string {
  // Saved-entry aria labels carry a literal "&amp;" for "&" in a title.
  return value.replace(/&amp;/g, '&').toLowerCase().replace(/\s+/g, ' ').trim();
}

function yearOf(value: string): string {
  return value.match(/\d{4}/)?.[0] ?? '';
}

/**
 * Drop exact duplicate roles (same company, title, start year and end
 * year/present), keeping the entry with the most bullet text. The merged
 * profile carries a few of these from the résumé/LinkedIn reconciliation.
 */
export function dedupeExperience(experience: Experience[]): Experience[] {
  const best = new Map<string, { role: Experience; index: number; weight: number }>();
  experience.forEach((role, index) => {
    const key = [
      norm(role.company),
      norm(role.title),
      yearOf(role.start),
      isPresent(role.end) ? 'present' : yearOf(role.end),
    ].join('|');
    const weight = role.bullets.reduce((sum, b) => sum + b.text.length, 0);
    const existing = best.get(key);
    if (!existing || weight > existing.weight) best.set(key, { role, index, weight });
  });
  return [...best.values()].sort((a, b) => a.index - b.index).map((entry) => entry.role);
}

/** The site rejects `;` in entry descriptions ("cannot contain: ;"). */
export function sanitizeDescription(text: string): string {
  return text.replace(/;/g, ',');
}

/** A role's description: its bullets, one per line, site-safe. */
export function experienceDescription(role: Experience): string {
  return sanitizeDescription(role.bullets.map((b) => b.text).join('\n'));
}

/** "Computer Science Coursework" → major "Computer Science", no degree. */
export function educationMajor(credential: string | undefined): string {
  if (!credential) return '';
  if (educationDegree(credential)) return '';
  return credential
    .replace(/\bcoursework\b/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A real degree in the credential, or '' when it is coursework, not a degree. */
export function educationDegree(credential: string | undefined): string {
  if (!credential) return '';
  return /bachelor|master|associate|doctor|ph\.?d|m\.?b\.?a/i.test(credential)
    ? credential.trim()
    : '';
}

interface SectionResult {
  filled: FilledField[];
  unfilled: UnfilledField[];
}

async function fillEditorText(
  page: SafePage,
  field: RawFormField | undefined,
  value: string,
  locationMatch = false,
): Promise<boolean> {
  if (!field || value.trim() === '') return false;
  if (field.autocomplete) {
    return page.fillAutocomplete(field.selector, value, { locationMatch });
  }
  await page.fill(field.selector, value);
  return (await page.inputValue(field.selector)).trim().length > 0;
}

/** Close any open entry editor without saving (its data all comes from the profile). */
async function cancelOpenEditors(page: SafePage): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const fields = await page.scanFields();
    if (!fields.some((f) => f.inEntryEditor)) return;
    const clicked = await page.clickLabeledButton('Cancel').catch(() => false);
    if (!clicked) return;
    await page.settle(500);
  }
}

/**
 * Does a saved-entry label name this entry? Experience labels read
 * "Edit experience <Title> <Company>", so the title must come first and the
 * remainder must be the company (or empty, when the company name was not in
 * the site's suggestions). A bare title match would claim one company's entry
 * from another's when both titles are "Quality Assurance".
 */
export function savedEntryMatches(
  label: string,
  kind: 'experience' | 'education',
  title: string,
  company?: string,
): boolean {
  const text = norm(label);
  const prefix = `edit ${kind} `;
  if (!text.startsWith(prefix)) return false;
  const rest = text.slice(prefix.length);
  if (kind === 'education') return rest.includes(norm(title));
  const titleNorm = norm(title);
  if (!rest.startsWith(titleNorm)) return false;
  const remainder = rest.slice(titleNorm.length).trim().replace(/^,/, '').trim();
  if (remainder === '') return true;
  return company ? remainder.startsWith(norm(company)) : false;
}

async function waitForSaved(
  page: SafePage,
  kind: 'experience' | 'education',
  title: string,
  company?: string,
): Promise<{ saved: boolean; errors: string[] }> {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const saved = await page.savedEntryLabels();
    if (saved.some((label) => savedEntryMatches(label, kind, title, company))) {
      return { saved: true, errors: [] };
    }
    await page.settle(400);
  }
  return { saved: false, errors: await page.validationMessages() };
}

/** Cancel the open entry editor, but only when one is actually open. */
async function cancelIfEditorOpen(page: SafePage): Promise<void> {
  const fields = await page.scanFields();
  if (!fields.some((f) => f.inEntryEditor)) return;
  await page.clickLabeledButton('Cancel').catch(() => false);
  await page.settle(400);
}

export async function fillExperienceAndEducation(
  page: SafePage,
  profile: Profile,
): Promise<SectionResult> {
  const filled: FilledField[] = [];
  const unfilled: UnfilledField[] = [];
  await cancelOpenEditors(page);

  const alreadySaved = async (
    kind: 'experience' | 'education',
    title: string,
    company?: string,
  ) => {
    const saved = await page.savedEntryLabels();
    return saved.some((label) => savedEntryMatches(label, kind, title, company));
  };

  // --- Experience, newest first, every deduped role -------------------------
  for (const role of dedupeExperience(profile.experience)) {
    const label = `Experience: ${role.title} at ${role.company}`;
    if (await alreadySaved('experience', role.title, role.company)) {
      filled.push({ field: label, via: 'profile', source: `experience.${role.id}` });
      continue;
    }
    const start = parseProfileMonthYear(role.start);
    const present = isPresent(role.end);
    const end = present ? null : parseProfileMonthYear(role.end);
    if (!start) {
      unfilled.push({
        field: label,
        required: false,
        reason: `profile start date "${role.start}" has no month; not guessing one`,
      });
      continue;
    }
    if (!present && !end) {
      unfilled.push({
        field: label,
        required: false,
        reason: `profile end date "${role.end}" has no month; not guessing one`,
      });
      continue;
    }
    try {
      const opened = await page.clickLabeledButton('Add', 'Add experience entry');
      if (!opened) throw new Error('Add experience button not found');
      await page.settle(600);
      const fields = await page.scanFields();
      const editor = fields.filter((f) => f.inEntryEditor);
      const byLabel = (name: string) => editor.find((f) => f.label === name);

      if (!(await fillEditorText(page, byLabel('Title'), role.title))) {
        throw new Error('title did not commit');
      }
      const companyCommitted = await fillEditorText(page, byLabel('Company'), role.company);
      if (role.location) {
        await fillEditorText(page, byLabel('Office location'), role.location, true);
      }
      const description = byLabel('Description');
      if (description && role.bullets.length > 0) {
        await page.fill(description.selector, experienceDescription(role));
      }
      const from = byLabel('From');
      if (
        !from ||
        !(await page.fillMonthYear(from.selector, start.abbr, start.year, start.display))
      ) {
        throw new Error(`start date ${start.display} did not take`);
      }
      if (present) {
        const checkbox = editor.find((f) => f.type === 'checkbox');
        if (!checkbox || !(await page.checkEntryCheckbox(checkbox.selector))) {
          throw new Error('"I currently work here" was not checked');
        }
      } else if (end) {
        const to = byLabel('To');
        if (!to || !(await page.fillMonthYear(to.selector, end.abbr, end.year, end.display))) {
          throw new Error(`end date ${end.display} did not take`);
        }
      }
      const savedClicked = await page.clickLabeledButton('Save', 'Save experience entry');
      if (!savedClicked) throw new Error('Save experience button not found');
      const result = await waitForSaved(page, 'experience', role.title, role.company);
      if (!result.saved) {
        throw new Error(
          result.errors.length > 0
            ? `site validation: ${result.errors.join('; ')}`
            : 'entry did not appear after Save',
        );
      }
      filled.push({ field: label, via: 'profile', source: `experience.${role.id}` });
      if (!companyCommitted) {
        unfilled.push({
          field: `${label} — company name`,
          required: false,
          reason: 'the company name is not in the site suggestions; the entry was saved without it',
        });
      }
    } catch (err) {
      unfilled.push({
        field: label,
        required: false,
        reason: err instanceof Error ? err.message : 'could not be filled',
      });
      await cancelIfEditorOpen(page);
    }
  }

  // --- Education, every school ---------------------------------------------
  for (const edu of profile.education) {
    const label = `Education: ${edu.school}`;
    if (await alreadySaved('education', edu.school)) {
      filled.push({ field: label, via: 'profile', source: `education.${edu.id}` });
      continue;
    }
    try {
      const opened = await page.clickLabeledButton('Add', 'Add education entry');
      if (!opened) throw new Error('Add education button not found');
      await page.settle(600);
      const fields = await page.scanFields();
      const editor = fields.filter((f) => f.inEntryEditor);
      const byLabel = (name: string) => editor.find((f) => f.label === name);

      if (!(await fillEditorText(page, byLabel('Institution'), edu.school))) {
        throw new Error('institution did not commit');
      }
      const major = educationMajor(edu.credential);
      if (major) await fillEditorText(page, byLabel('Major'), major);
      const degree = educationDegree(edu.credential);
      if (degree) await fillEditorText(page, byLabel('Degree'), degree);
      // School location and dates are optional, and the profile states only
      // years for these schools: fill a date only when it names a month.
      const start = edu.start ? parseProfileMonthYear(edu.start) : null;
      const end = edu.end ? parseProfileMonthYear(edu.end) : null;
      const from = byLabel('From');
      if (start && from) {
        await page.fillMonthYear(from.selector, start.abbr, start.year, start.display);
      }
      const to = byLabel('To');
      if (end && to) {
        await page.fillMonthYear(to.selector, end.abbr, end.year, end.display);
      }
      const savedClicked = await page.clickLabeledButton('Save', 'Save education entry');
      if (!savedClicked) throw new Error('Save education button not found');
      const result = await waitForSaved(page, 'education', edu.school);
      if (!result.saved) {
        throw new Error(
          result.errors.length > 0
            ? `site validation: ${result.errors.join('; ')}`
            : 'entry did not appear after Save',
        );
      }
      filled.push({ field: label, via: 'profile', source: `education.${edu.id}` });
    } catch (err) {
      unfilled.push({
        field: label,
        required: false,
        reason: err instanceof Error ? err.message : 'could not be filled',
      });
      await cancelIfEditorOpen(page);
    }
  }

  return { filled, unfilled };
}

/**
 * Full Easy Apply fill: page 1 (generic fill + entries), then Next — only
 * when the site shows no validation error — and the next wizard page's fill.
 * The merged report counts entries as filled fields and carries the site's
 * own wording for anything it rejects. Never clicks Submit.
 */
export async function fillSmartRecruitersForm(
  page: SafePage,
  deps: FillDeps,
  url: string,
): Promise<FillReport> {
  const first = await fillForm(page, genericAdapter, deps, url);
  const sections = await fillExperienceAndEducation(page, deps.profile);

  const filled = [...first.filled, ...sections.filled];
  const unfilled = [...first.unfilled, ...sections.unfilled];
  const skippedEeo = [...first.skipped_eeo];
  const selfIdentification = [...first.self_identification];
  let resumeAttached = first.resumeAttached;

  const errors = (await page.validationMessages()).filter(
    (message) => !/fields marked with \*/i.test(message),
  );
  // Never advance past a page the site (or the report) still calls incomplete.
  const requiredUnfilled = unfilled.filter((u) => u.required).map((u) => u.field);
  const blocking = [...errors, ...requiredUnfilled.map((field) => `${field} is still empty`)];
  let advanced = false;
  if (blocking.length === 0) {
    const clicked = await page.clickLabeledButton('Next').catch(() => false);
    if (clicked) {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const text = await page.readBodyText();
        if (/preliminary questions/i.test(text)) {
          advanced = true;
          break;
        }
        await page.settle(400);
      }
    }
  }

  if (advanced) {
    const second = await fillForm(page, genericAdapter, deps, url);
    filled.push(...second.filled);
    unfilled.push(...second.unfilled);
    for (const label of second.skipped_eeo) {
      if (!skippedEeo.includes(label)) skippedEeo.push(label);
    }
    for (const entry of second.self_identification) {
      if (!selfIdentification.some((e) => e.field === entry.field)) selfIdentification.push(entry);
    }
    resumeAttached = resumeAttached || second.resumeAttached;
  } else {
    unfilled.push({
      field: 'Next page (wizard)',
      required: true,
      reason:
        blocking.length > 0
          ? `not advanced: ${blocking.join('; ')}`
          : 'not advanced: the Next button was not found or did not advance',
    });
  }

  return {
    ats: deps.reportAts ?? 'smartrecruiters',
    url,
    filled,
    unfilled,
    skipped_eeo: skippedEeo,
    self_identification: selfIdentification,
    resumeAttached,
  };
}
