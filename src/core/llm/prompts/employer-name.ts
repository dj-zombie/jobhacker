import { z } from 'zod';

/**
 * The hiring company of a search job listed under a placeholder employer
 * ("Remote", "Confidential"), read from the posting text (J29 fix). The model
 * returns the name and one sentence quoted from the posting; `groundEmployer`
 * keeps the name only when both are really in the text.
 */

export const EMPLOYER_NAME_PROMPT_VERSION = 'employer-name-1';

/** Characters of the description the model sees. A posting names its employer early. */
export const EMPLOYER_DESCRIPTION_CAP = 8000;

export const employerNameOutputSchema = z
  .object({
    employer: z.string().trim().min(1).max(80).nullable(),
    quote: z.string().trim().min(1).max(400).nullable(),
  })
  .strict();

export type EmployerNameOutput = z.infer<typeof employerNameOutputSchema>;

export const EMPLOYER_NAME_SYSTEM = [
  'You read one job posting and name the company that is hiring for it.',
  'The job listing gave a placeholder instead of the employer, such as "Remote" or',
  '"Confidential", so the name has to come from the posting text itself.',
  '',
  'Return employer as the company name exactly as the posting spells it, and quote',
  'as one sentence copied word for word from the posting that contains that name.',
  '',
  'A company that hires the person onto its own team is the employer, even when the',
  'work is for its clients. Return employer null and quote null when the posting does',
  'not name the hiring company: a recruiter or staffing agency filling a role at a',
  'company it does not name, or a stealth company that gives no name.',
  'Never return a job board, a client, a product, a technology, or the placeholder.',
  'Never guess a name from the title, the location or the wording.',
].join('\n');

export function employerNameUserPrompt(input: {
  listedAs: string;
  title: string;
  description: string;
}): string {
  return [
    `Listed employer: ${input.listedAs.trim()}`,
    `Title: ${input.title.trim()}`,
    '',
    'Posting:',
    input.description.trim().slice(0, EMPLOYER_DESCRIPTION_CAP),
  ].join('\n');
}

function folded(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * The employer to store, or null with the reason. The name must appear in the
 * posting, and the quote must be the posting's own words and contain the name.
 */
export function groundEmployer(
  output: EmployerNameOutput,
  posting: { title: string; description: string },
  isPlaceholder: (name: string) => boolean,
): { name: string; quote: string } | { name: null; reason: string } {
  if (output.employer === null) return { name: null, reason: 'the posting names no employer' };
  const name = output.employer.replace(/\s+/g, ' ').trim();
  if (isPlaceholder(name)) return { name: null, reason: 'the model gave a placeholder' };
  const text = folded(`${posting.title}\n${posting.description}`);
  if (!text.includes(folded(name))) return { name: null, reason: 'the name is not in the posting' };
  const quote = output.quote?.replace(/\s+/g, ' ').trim() ?? '';
  if (!quote || !folded(posting.description).includes(folded(quote))) {
    return { name: null, reason: "the quote is not the posting's words" };
  }
  if (!folded(quote).includes(folded(name))) {
    return { name: null, reason: 'the quote does not name the employer' };
  }
  return { name, quote };
}
