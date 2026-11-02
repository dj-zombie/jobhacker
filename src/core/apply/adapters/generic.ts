import type { SafePage } from '../safe-page.js';
import type { FormAdapter, RawFormField } from '../types.js';

/**
 * Generic application-form adapter (Phase 3 Slice 2). Any page with ordinary
 * inputs is fillable. Greenhouse, Lever, and Ashby keep their own adapters for
 * widgets this scan does not special-case. This file only reads the page.
 */

const EEO_HEADING =
  'voluntary self.?identif|equal opportunity|demographic|eeo|diversity information|veteran status';

export const genericAdapter: FormAdapter = {
  ats: 'generic',

  canHandle(): boolean {
    return true;
  },

  async detectFields(page: SafePage): Promise<RawFormField[]> {
    return page.scanFields({ eeoHeadingPattern: EEO_HEADING });
  },
};
