import type { SafePage } from '../safe-page.js';
import type { FormAdapter, RawFormField } from '../types.js';

/**
 * Ashby application-form adapter (FR-8). Ashby forms (seen live on Linear,
 * Ramp, OpenAI and Sentry, 2026-10-23) wrap each question in
 * `.ashby-application-form-field-entry` with a `.ashby-application-form-question-title`,
 * answer Yes/No questions with `aria-pressed` buttons, and put the voluntary
 * EEO survey in `.ashby-survey-form-container`, which is flagged so every field
 * in it is left untouched (invariant 7). The unlabeled "Autofill from resume"
 * uploader is excluded: uploading there makes Ashby overwrite the fields we
 * fill. This adapter only reads the page (via `scanFields`); it never clicks,
 * presses, submits, or uses the keyboard (enforced by `guard.test.ts`).
 */

const EEO_HEADING = 'voluntary self.?identif|equal (employment )?opportunity|demographic|eeo';

export const ashbyAdapter: FormAdapter = {
  ats: 'ashby',

  canHandle(url: string): boolean {
    return /ashbyhq\.com/i.test(url);
  },

  async detectFields(page: SafePage): Promise<RawFormField[]> {
    return page.scanFields({
      eeoHeadingPattern: EEO_HEADING,
      eeoWithin: '.ashby-survey-form-container',
      excludeWithin: '.ashby-application-form-autofill-input-root',
    });
  },
};
