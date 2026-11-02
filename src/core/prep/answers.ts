import type { Profile } from '../config/schemas.js';

/**
 * Screening-answer preparation (FR-7). In Round 4 there is no form yet, so this
 * prepares the standard answers from the profile verbatim (they are the source
 * of truth). Answers that still carry a `[NEEDS INPUT: …]` marker are flagged so
 * the UI can surface them and the human fills them in. Form-detected screening
 * questions are matched to these in Round 5 (Apply assist).
 */

export interface PreparedAnswer {
  /** The profile key, e.g. `work_authorization_us`. */
  key: string;
  /** A human-readable label derived from the key. */
  question: string;
  /** The answer text, taken verbatim from the profile. */
  answer: string;
  /** True when the answer is still a `[NEEDS INPUT: …]` placeholder. */
  needsInput: boolean;
}

const NEEDS_INPUT = /\[NEEDS INPUT/i;

export function prepareAnswers(profile: Profile): PreparedAnswer[] {
  return Object.entries(profile.standard_answers).map(([key, answer]) => ({
    key,
    question: humanizeKey(key),
    answer,
    needsInput: NEEDS_INPUT.test(answer),
  }));
}

/** Turn `work_authorization_us` into `Work authorization us`. */
function humanizeKey(key: string): string {
  const spaced = key.replace(/_/g, ' ').trim();
  return spaced.length === 0 ? key : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
