import { z } from 'zod';

/**
 * Cover-letter prompt (FR-7). The letter is generated per job from the full
 * profile, Kris's preferences, and the posting itself (Kris, 2026-10-24: a
 * generated, job-specific cover letter is the feature — a `[NEEDS INPUT]`
 * marker is a failed generation, not an acceptable output). Grounding still
 * holds (invariant 3): every number must come from the profile, and the
 * "why this company" passage connects specifics in the posting to work and
 * preferences already in the profile — it never invents a personal history
 * with the company.
 */
export const VERSION = 'cover-note-2026-10-24-v2';

export const COVER_NOTE_JOB_CHAR_CAP = 6_000;

export const coverNoteOutputSchema = z
  .object({
    text: z.string().min(1),
  })
  .strict();

export type CoverNoteOutput = z.infer<typeof coverNoteOutputSchema>;

export interface CoverNotePromptInput {
  /** Job summary: company, title, and truncated description. */
  job: string;
  /** Full profile render: summary, skills, experience bullets, projects. */
  profile: string;
  /** Kris's prose preferences (what he wants and why). */
  preferences: string;
  /** Desired tone, e.g. "Direct, warm, specific. Max 150 words." */
  tone: string;
  /** Things the candidate always wants referenced, when relevant. */
  alwaysMention: string[];
  /** On a retry, the grounding violations from the previous attempt. */
  violations?: string[];
}

export const COVER_NOTE_SYSTEM = [
  'You write a finished, job-specific cover letter for one candidate applying to one job.',
  'The candidate reviews it before submitting. It must be complete and ready to send.',
  '',
  'Hard rules (a violation makes the output rejected):',
  '- Ground every claim in the provided profile. Do NOT invent numbers, employers,',
  '  titles, dates, or technologies. Every number you use must appear verbatim in',
  '  the profile (a metric from an experience bullet is ideal — cite one).',
  '- "Why this company": connect a specific in the posting (its product, stack, or',
  "  the work described) to the candidate's actual experience and stated",
  "  preferences. Never claim he has used the company's product, worked there, or",
  '  admired it for years — connect the work, not a fabricated personal history.',
  '- NEVER output a "[NEEDS INPUT …]" marker, a placeholder, or bracketed text.',
  '  Everything you need is in the profile, preferences, and posting.',
  '- Keep it concise and free of clichés. Honour the requested tone and word limit.',
  '- Open with "Dear <Company> team," (use the company from the posting) and sign',
  "  off with the candidate's name from the profile.",
  '',
  'Output a JSON object: { "text": string }. Return only JSON.',
].join('\n');

export function coverNoteUserPrompt(input: CoverNotePromptInput): string {
  const parts = [
    '## Candidate profile',
    input.profile,
    '',
    '## Candidate preferences (his words)',
    input.preferences.trim() || '(none stated)',
    '',
    '## Tone',
    input.tone,
  ];
  if (input.alwaysMention.length > 0) {
    parts.push(
      '',
      '## Always mention when relevant',
      input.alwaysMention.map((m) => `- ${m}`).join('\n'),
    );
  }
  parts.push('', '## Job posting', input.job);
  if (input.violations && input.violations.length > 0) {
    parts.push(
      '',
      '## Your previous attempt was rejected for these violations',
      input.violations.map((v) => `- ${v}`).join('\n'),
      'Fix every one. Write the finished letter from the facts provided.',
    );
  }
  return parts.join('\n');
}
