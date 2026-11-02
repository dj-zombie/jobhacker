import { z } from 'zod';

/**
 * Generic form mapping (Phase 3 Slice 2). The model sees a harvested field
 * list plus the profile and prepared answers, and returns a value for each
 * field id. `llm-map.ts` drops anything ungrounded. Kris reviews low-confidence
 * fills before he submits. `VERSION` is bumped when the rules change.
 */
export const VERSION = 'field-map-2026-10-24';

export const fieldMapOutputSchema = z
  .object({
    mappings: z.array(
      z
        .object({
          id: z.number().int().min(0),
          value: z.string().nullable(),
          confidence: z.enum(['high', 'low']),
          source: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export type FieldMapOutput = z.infer<typeof fieldMapOutputSchema>;

export interface FieldMapPromptQuestion {
  id: number;
  label: string;
  hint: string;
  required: boolean;
  kind: 'text' | 'textarea' | 'choice';
  options: string[];
}

export interface FieldMapPromptInput {
  job: string;
  profile: string;
  standardAnswers: string;
  preferences: string;
  questions: FieldMapPromptQuestion[];
}

export const FIELD_MAP_SYSTEM = [
  'You map one job application form onto facts the candidate has already stated.',
  'The candidate reviews the form before submitting. You do not submit anything.',
  '',
  'Hard rules:',
  '- Use only the profile, standard answers, and preferences. Do not invent employers,',
  '  titles, dates, years, numbers, degrees, technologies, or locations.',
  '- Every number you write must appear in those facts. Do not copy a number from the',
  "  job posting and present it as the candidate's.",
  '- A "choice" question must be answered with exactly one of its listed options.',
  '- If the facts do not determine the answer, set "value" to null. Do not guess.',
  '- "confidence" is "high" only when the value is copied from the facts or is the',
  '  option those facts select. Use "low" when you wrote a sentence.',
  '- "source" is a short name of the fact you used, such as a standard-answer key or',
  '  "profile". Use "" when value is null.',
  '- Skip nothing by omitting an id. Return one row per question id.',
].join('\n');

export function fieldMapUserPrompt(input: FieldMapPromptInput): string {
  const questions = input.questions.map((q) => ({
    id: q.id,
    label: q.label,
    hint: q.hint,
    required: q.required,
    kind: q.kind,
    options: q.options,
  }));
  return [
    'Job:',
    input.job.trim() || '(no description)',
    '',
    'Profile:',
    input.profile.trim() || '(empty)',
    '',
    'Standard answers:',
    input.standardAnswers.trim() || '(none)',
    '',
    'Preferences:',
    input.preferences.trim() || '(none)',
    '',
    'Questions:',
    JSON.stringify(questions),
  ].join('\n');
}
