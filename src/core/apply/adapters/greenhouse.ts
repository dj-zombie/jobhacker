import type { SafePage } from '../safe-page.js';
import type { FormAdapter, RawFormField } from '../types.js';

/**
 * Greenhouse application-form adapter (FR-8). Greenhouse groups its voluntary
 * self-identification questions under a heading such as "Voluntary Self
 * Identification" / "U.S. Equal Opportunity" / "Demographic Questions"; we flag
 * that whole section so those fields are left untouched (invariant 7). This
 * adapter only reads the page (via `scanFields`); it never clicks, presses,
 * submits, or uses the keyboard (enforced by `guard.test.ts`).
 */

const EEO_HEADING =
  'voluntary self.?identif|equal opportunity|demographic|u\\.s\\. standard demographic';

export const greenhouseAdapter: FormAdapter = {
  ats: 'greenhouse',

  canHandle(url: string): boolean {
    return /greenhouse\.io|grnh\.se/i.test(url);
  },

  async detectFields(page: SafePage): Promise<RawFormField[]> {
    return page.scanFields({ eeoHeadingPattern: EEO_HEADING });
  },
};
