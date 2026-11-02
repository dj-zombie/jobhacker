import { z } from 'zod';

/**
 * Form-answer prompt (FR-7 "answers to the screening questions it detects",
 * FR-8). When Open & fill finds questions on a live application form that no
 * profile rule or saved answer covers, the writing model drafts an answer for
 * each one, as the candidate, from the profile only (AGENTS invariant 3).
 * `form-answers.ts` checks every draft (choice in the offered options, numbers
 * and proper nouns grounded, essay source ids real) and turns anything that
 * fails into a `[NEEDS INPUT: …]` marker. Kris reviews every draft before he
 * submits. `VERSION` is bumped when the rules change.
 */
export const VERSION = 'form-answers-2026-10-23';

export const FORM_ANSWERS_JOB_CHAR_CAP = 6_000;

export const formAnswersOutputSchema = z
  .object({
    answers: z.array(
      z
        .object({
          id: z.number().int().min(0),
          answer: z.string().nullable(),
          needs_input: z.string().nullable(),
          source_ids: z.array(z.string()),
        })
        .strict(),
    ),
  })
  .strict();

export type FormAnswersOutput = z.infer<typeof formAnswersOutputSchema>;

export interface FormAnswersPromptQuestion {
  id: number;
  label: string;
  hint: string;
  required: boolean;
  kind: 'text' | 'textarea' | 'choice';
  options: string[];
}

export interface FormAnswersPromptInput {
  /** Company, title, location and truncated description. */
  job: string;
  /** Profile summary, skills, experience with bullet ids, education. Never email/phone. */
  profile: string;
  /** The candidate's standard answers, "key: value" lines. */
  standardAnswers: string;
  /** `preferences.md`, the candidate's own words (may be empty). */
  preferences: string;
  /** The cover note already written for this job, for consistency (may be empty). */
  coverNote: string;
  questions: FormAnswersPromptQuestion[];
  /** On a retry, the problems with the previous drafts, by question id. */
  violations?: string[];
}

export const FORM_ANSWERS_SYSTEM = [
  'You draft answers to the questions on one job application form, in the first person,',
  'as the candidate. The candidate reviews every draft before submitting.',
  '',
  'Hard rules (a violation makes the answer rejected):',
  '- Every claim about the candidate must come from the provided profile, standard answers,',
  '  or preferences. Do NOT invent employers, titles, dates, years of experience, numbers,',
  '  degrees, certifications, technologies, locations, or reasons.',
  '- Every number you write must appear in the profile, standard answers, preferences, or',
  '  the question itself.',
  '- A "choice" question must be answered with exactly one of its listed options, copied',
  '  verbatim. Pick the option the facts support (work authorization, sponsorship, location,',
  '  relocation and on-site questions follow the standard answers, preferences and location).',
  '- If the facts do not determine the answer (a preference or fact the candidate has not',
  '  stated), set "answer" to null and "needs_input" to a short note of what is missing.',
  '  Do not guess. For an optional question you cannot answer, set both to null.',
  '- "text" questions get one or two sentences, or just the value when the question asks for',
  '  one (a date, a URL, a name). "textarea" questions get 60-150 words unless the',
  '  question asks for something else: specific, plain, no cliches, no greeting or sign-off.',
  '  List the ids of the experience bullets you drew on in "source_ids" (required for',
  '  textarea answers; [] otherwise).',
  '- "Why this company / role" questions: connect what the posting says about the work to',
  "  the candidate's relevant experience. Do not invent personal history with the company.",
  '- A question asking for a URL or profile link gets the matching link from the profile.',
  '',
  'Output a JSON object: { "answers": [ { "id": number, "answer": string | null,',
  '"needs_input": string | null, "source_ids": string[] } ] } with exactly one entry per',
  'question id. Return only JSON.',
].join('\n');

function renderQuestion(q: FormAnswersPromptQuestion): string {
  const head = `[${q.id}] (${q.required ? 'required' : 'optional'}, ${q.kind}) ${q.label}`;
  const lines = [head];
  if (q.hint) lines.push(`    help text: ${q.hint}`);
  if (q.kind === 'choice') lines.push(`    options: ${q.options.map((o) => `"${o}"`).join(' | ')}`);
  return lines.join('\n');
}

export function formAnswersUserPrompt(input: FormAnswersPromptInput): string {
  const parts = [
    '## Candidate profile',
    input.profile,
    '',
    '## Candidate standard answers',
    input.standardAnswers || '(none)',
    '',
    '## Candidate preferences (their words)',
    input.preferences.trim() || '(none)',
  ];
  if (input.coverNote.trim()) {
    parts.push('', '## Cover note already written for this application', input.coverNote.trim());
  }
  parts.push(
    '',
    '## Job posting',
    input.job,
    '',
    '## Questions on the application form',
    input.questions.map(renderQuestion).join('\n'),
  );
  if (input.violations && input.violations.length > 0) {
    parts.push(
      '',
      '## Your previous drafts for these questions were rejected',
      input.violations.map((v) => `- ${v}`).join('\n'),
      'Fix every one, or return null with a needs_input note where the facts are missing.',
    );
  }
  return parts.join('\n');
}
