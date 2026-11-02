import { z } from 'zod';

/**
 * Fit-scoring prompt (FR-5, PHASE2 D12). The model rates six dimensions 0–5
 * (null = the posting doesn't say) with a reason each; the 0–100 score and the
 * verdict are computed locally from weights (`pipeline/rank.ts`), never by the
 * model. `VERSION` is stored as `job_scores.rubric_version`; bump it whenever
 * the rubric or output contract changes so existing scores are recomputed.
 */
export const VERSION = 'score-2026-10-25-places-v3';

/** The job text is truncated to roughly this many characters before scoring. */
export const JOB_TEXT_CHAR_CAP = 12_000;

const dimension = z
  .object({
    score: z.number().int().min(0).max(5).nullable(),
    reason: z.string().min(1).max(500),
  })
  .strict();

export const scoreOutputSchema = z
  .object({
    dimensions: z
      .object({
        role_fit: dimension,
        tech_fit: dimension,
        domain_interest: dimension,
        seniority_fit: dimension,
        logistics_fit: dimension,
        comp_fit: dimension,
      })
      .strict(),
    summary: z.string().min(1).max(500),
    red_flags: z.array(z.string().min(1)).max(5),
  })
  .strict();

export type ScoreOutput = z.infer<typeof scoreOutputSchema>;

export interface ScorePromptInput {
  /** The candidate's `preferences.md`, verbatim. */
  preferences: string;
  /** Profile summary, skills and experience. Never contact details (invariant 4). */
  profile: string;
  /** The job posting: company, title, location and its places, comp, and truncated description. */
  job: string;
}

export const SCORE_SYSTEM = [
  'You rate how well one job posting fits one candidate, on six separate dimensions.',
  "You get the candidate's own description of what they want (prose), a short candidate",
  'profile, and the posting. Rate each dimension on its own; do not let one dimension',
  'colour another. The overall score is computed later from weights, not by you.',
  '',
  'Each dimension is an integer 0-5, or null when the posting genuinely does not say',
  'enough to judge it. Each needs a one-sentence reason grounded in the posting.',
  'Every dimension is always an object {"score": ..., "reason": "..."}; when it cannot be',
  'judged, set "score" to null and say why in "reason". Never set a dimension itself to null.',
  '',
  'role_fit: function, discipline and work shape only. Is this the kind of work they want?',
  '  Do not consider level, IC/management track, technology, industry, location or pay here.',
  '  5 exactly the role they describe; 3 adjacent or mixed; 1 mostly different work;',
  '  0 a different function entirely (e.g. sales, recruiting or design for an engineer).',
  "tech_fit: overlap between the posting's stack and the profile's skills.",
  '  5 core stack matches; 3 partial overlap, learnable; 0 unrelated stack.',
  '  null when the posting names no technologies.',
  'domain_interest: how well the product or industry matches what they say excites them.',
  '  5 squarely in a stated interest; 3 neutral; 1 something they say they avoid.',
  'seniority_fit: both level and IC/management track versus what they want.',
  '  5 the level and track they want; 3 one step off; 1 a major mismatch; 0 far off',
  '  (e.g. intern/new-grad for a senior, or people management when they want IC work).',
  '  null when neither level nor track is stated or implied.',
  'logistics_fit: location, remote policy and employment type versus their constraints.',
  '  The posting\'s "Location classified as" line says which of the candidate\'s places the',
  '  job is in, parsed from its location text. Use it for where the job is, and judge it',
  '  against what the candidate says about those places; do not re-derive the geography.',
  '  5 clearly workable; 3 unclear (e.g. "remote" with no country stated); 1 a location or',
  '  employment type the candidate calls a poor fit; 0 impossible (onsite or',
  '  country-restricted somewhere they cannot work). If the reason says it is not workable,',
  '  the score must be 0 or 1, never 3.',
  'comp_fit: stated pay versus their floor.',
  '  5 comfortably above the floor; 3 straddles it; 0 clearly below.',
  '  null when the posting states no pay. If the candidate has not set a floor, comp_fit',
  '  must be null regardless of the stated pay.',
  '',
  'Also return:',
  '- summary: one plain sentence saying what the job is and where.',
  '- red_flags: up to 5 short, concrete concerns from the posting (empty array if none).',
  '',
  'Judge only from the text provided. Never invent facts about the candidate or the job.',
  'Missing information is null, not a guess.',
  'Return only the JSON object.',
].join('\n');

export function scoreUserPrompt(input: ScorePromptInput): string {
  return [
    '## What the candidate wants (their words)',
    input.preferences,
    '',
    '## Candidate profile',
    input.profile,
    '',
    '## Job posting',
    input.job,
  ].join('\n');
}
