import { z } from 'zod';
import type { IndustryConfig } from '../../config/schemas.js';

/**
 * Company industry (J26). The model assigns at most one industry from the
 * closed list, or none. It sees the company name and the roles it posts,
 * never a job description, so one posting that says "game" cannot decide.
 */

export const INDUSTRY_PROMPT_VERSION = 'industry-1';

/** How many distinct open-job titles the prompt and the input hash use. */
export const INDUSTRY_TITLE_CAP = 40;

const REASON_MAX = 300;

export function industryOutputSchema(ids: readonly string[]) {
  return z
    .object({
      industry_id: z
        .string()
        .nullable()
        .refine((id) => id === null || ids.includes(id), {
          message: `industry_id must be null or one of: ${ids.join(', ')}`,
        }),
      reason: z.string().min(1).max(REASON_MAX),
    })
    .strict();
}

export type IndustryOutput = z.infer<ReturnType<typeof industryOutputSchema>>;

export interface IndustryPromptInput {
  industries: readonly Pick<IndustryConfig, 'id' | 'label'>[];
  /** `preferences.md`, so "game tools" counts and a bank does not. */
  preferences: string;
  company: string;
  titles: readonly string[];
}

export const INDUSTRY_SYSTEM = [
  'You decide which one industry a company is in, or that it is in none of them.',
  "You get the candidate's own description of the industries that interest them,",
  'the closed list of industry ids you may return, the company name, and the titles',
  'of roles that company currently has open. You get no job description.',
  '',
  'Return industry_id as one id from the list, or null. Also return a one-sentence',
  'reason that names the evidence you used: the company name, or the roles.',
  '',
  'Prefer null when you are not sure. The company name can be enough on its own',
  '(a studio whose name is the industry). A set of roles that only that industry',
  'posts is enough. One role title that merely contains a word from an industry',
  'name is not enough. Do not infer an industry from a technology, a seniority,',
  'or a single unusual title among ordinary engineering roles.',
].join('\n');

/** Distinct titles, sorted, capped. The prompt and the input hash share this list. */
export function industryTitles(titles: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const title of titles) {
    const trimmed = title.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out.slice(0, INDUSTRY_TITLE_CAP);
}

export function industryUserPrompt(input: IndustryPromptInput): string {
  const list = input.industries.map((industry) => `- ${industry.id}: ${industry.label}`).join('\n');
  const titles = industryTitles(input.titles);
  const roles = titles.length ? titles.map((title) => `- ${title}`).join('\n') : '- (none)';
  return [
    '## What the candidate wants',
    input.preferences.trim(),
    '',
    '## Industries you may assign, or null',
    list,
    '',
    `Company: ${input.company.trim()}`,
    '',
    'Open roles:',
    roles,
  ].join('\n');
}
