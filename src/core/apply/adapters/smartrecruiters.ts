import { urlIsOn } from '../../util/host.js';
import type { SafePage } from '../safe-page.js';
import type { FormAdapter, RawFormField } from '../types.js';
import { genericAdapter } from './generic.js';

/**
 * SmartRecruiters Easy Apply adapter (J29). Its one-page scan is the generic
 * one; `smartrecruiters.ts` adds the entries and the wizard's Next. It has its
 * own name so the generic no-form rule (D185) leaves a SmartRecruiters form
 * alone. This file only reads the page.
 */
export const smartRecruitersAdapter: FormAdapter = {
  ats: 'smartrecruiters',

  canHandle(url: string): boolean {
    return urlIsOn(url, ['jobs.smartrecruiters.com']);
  },

  async detectFields(page: SafePage): Promise<RawFormField[]> {
    return genericAdapter.detectFields(page);
  },
};
