import { z } from 'zod';

/**
 * Resume-tailoring prompt (FR-7). The model selects and rephrases existing
 * profile bullets for one job; it must never invent experience (AGENTS
 * invariant 3). `grounding.ts` enforces that; this prompt just asks for it and
 * constrains the output shape. `VERSION` is bumped when the rubric changes.
 */
export const VERSION = 'tailor-2026-10-22';

/** The job text is truncated to roughly this many characters before tailoring. */
export const TAILOR_JOB_CHAR_CAP = 8_000;

export const tailorOutputSchema = z
  .object({
    bullets: z
      .array(
        z
          .object({
            source_id: z.string().min(1),
            text: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type TailorOutput = z.infer<typeof tailorOutputSchema>;

/** One source bullet offered to the model, with its stable id. */
export interface TailorSourceBullet {
  id: string;
  text: string;
}

export interface TailorPromptInput {
  /** Job summary: company, title, and truncated description. */
  job: string;
  /** The candidate's profile summary (never contact details). */
  summary: string;
  /** Every source bullet the model may choose from, with ids. */
  bullets: TailorSourceBullet[];
  /** On a retry, the grounding violations from the previous attempt. */
  violations?: string[];
}

export const TAILOR_SYSTEM = [
  'You tailor an existing resume to one job posting for a single candidate.',
  '',
  'You are given the candidate profile summary, a numbered list of SOURCE BULLETS',
  '(each with a stable id), and one job posting. Select the most relevant source',
  'bullets and rephrase each to emphasise what matters for this job.',
  '',
  'Hard rules (a violation makes the output rejected):',
  '- Use only the provided source bullets. Reference each by its exact `source_id`.',
  '- Do NOT invent numbers, metrics, percentages, companies, or technologies.',
  '  Every number in your rephrase must appear in that source bullet.',
  '  Every technology or proper noun must appear in that source bullet or the',
  '  profile skills.',
  '- Rephrase for emphasis and concision only; never add facts.',
  '',
  'Output a JSON object: { "bullets": [ { "source_id": string, "text": string } ] }.',
  'Pick between 4 and 8 bullets when that many relevant sources exist. Return only JSON.',
].join('\n');

export function tailorUserPrompt(input: TailorPromptInput): string {
  const sources = input.bullets.map((b) => `[${b.id}] ${b.text}`).join('\n');
  const parts = [
    '## Candidate profile summary',
    input.summary,
    '',
    '## Source bullets (choose from these; reference by id)',
    sources,
    '',
    '## Job posting',
    input.job,
  ];
  if (input.violations && input.violations.length > 0) {
    parts.push(
      '',
      '## Your previous attempt was rejected for these grounding violations',
      input.violations.map((v) => `- ${v}`).join('\n'),
      'Fix every one. Stay strictly within the source bullets and profile skills.',
    );
  }
  return parts.join('\n');
}
