import type { SafePage } from '../safe-page.js';
import type { FormAdapter, RawFormField } from '../types.js';

/**
 * Lever application-form adapter (FR-8). Lever places its EEO / self-identification
 * questions under an "EEO" / "Voluntary Self Identification" / "Demographic"
 * heading; we flag that section so those fields stay untouched (invariant 7).
 * This adapter only reads the page (via `scanFields`); it never clicks, presses,
 * submits, or uses the keyboard (enforced by `guard.test.ts`).
 */

const EEO_HEADING = 'voluntary self.?identif|equal opportunity|demographic|\\beeo\\b';

export const leverAdapter: FormAdapter = {
  ats: 'lever',

  canHandle(url: string): boolean {
    return /lever\.co/i.test(url);
  },

  async detectFields(page: SafePage): Promise<RawFormField[]> {
    return page.scanFields({ eeoHeadingPattern: EEO_HEADING });
  },
};
