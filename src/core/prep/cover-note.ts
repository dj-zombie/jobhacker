import type { Profile } from '../config/schemas.js';
import {
  COVER_NOTE_SYSTEM,
  coverNoteOutputSchema,
  coverNoteUserPrompt,
} from '../llm/prompts/cover-note.js';
import type { LlmClient, LlmUsage } from '../llm/types.js';
import { renderProfileForAnswers } from './form-answers.js';
import { standaloneNumbers } from './grounding.js';

/**
 * Cover-letter generation (FR-7). The letter is written per job from the
 * full profile, Kris's preferences, and the posting. Grounding (invariant
 * 3): it may reference the job and company freely, but every number must
 * already be in the profile. A `[NEEDS INPUT]` marker is a grounding
 * violation, never an output: on failure the call retries once, then falls
 * back to a deterministic letter composed verbatim from profile facts
 * (summary, current role and one of its bullets, skills) — complete, with
 * no gap left for Kris to fill in.
 */

export interface CoverNoteResult {
  text: string;
  grounded: boolean;
  violations: string[];
  usage: LlmUsage;
  retried: boolean;
}

export interface CoverNoteDeps {
  llm: LlmClient;
  model: string;
  profile: Profile;
  /** Company display name, for the fallback letter. */
  company: string;
  /** The job summary + description, already truncated by the caller. */
  jobText: string;
  /** Kris's prose preferences, so "why this role" uses his own words. */
  preferences?: string;
}

const MAX_OUTPUT_TOKENS = 900;

export async function writeCoverNote(deps: CoverNoteDeps): Promise<CoverNoteResult> {
  const allowedNumbers = profileNumbers(deps.profile);
  const tone =
    deps.profile.cover_note?.tone ?? 'Direct, warm, specific. No clichés. Max 150 words.';
  const alwaysMention = deps.profile.cover_note?.always_mention ?? [];
  const profileText = renderProfileForAnswers(deps.profile);
  const promptInput = {
    job: deps.jobText,
    profile: profileText,
    preferences: deps.preferences ?? '',
    tone,
    alwaysMention,
  };

  let inputTokens = 0;
  let outputTokens = 0;
  let calls = 0;

  const first = await deps.llm.structured({
    model: deps.model,
    system: COVER_NOTE_SYSTEM,
    user: coverNoteUserPrompt(promptInput),
    schema: coverNoteOutputSchema,
    maxTokens: MAX_OUTPUT_TOKENS,
    promptName: 'cover-note',
  });
  inputTokens += first.usage.inputTokens;
  outputTokens += first.usage.outputTokens;
  calls += first.usage.calls;

  let text = first.value.text;
  let violations = groundCoverNote(text, allowedNumbers);
  let retried = false;

  if (violations.length > 0) {
    retried = true;
    const second = await deps.llm.structured({
      model: deps.model,
      system: COVER_NOTE_SYSTEM,
      user: coverNoteUserPrompt({ ...promptInput, violations }),
      schema: coverNoteOutputSchema,
      maxTokens: MAX_OUTPUT_TOKENS,
      promptName: 'cover-note',
    });
    inputTokens += second.usage.inputTokens;
    outputTokens += second.usage.outputTokens;
    calls += second.usage.calls;
    text = second.value.text;
    violations = groundCoverNote(text, allowedNumbers);
  }

  const usage: LlmUsage = { model: deps.model, inputTokens, outputTokens, calls };

  if (violations.length > 0) {
    return {
      text: fallbackLetter(deps.company, deps.profile),
      grounded: false,
      violations,
      usage,
      retried,
    };
  }

  return { text, grounded: true, violations: [], usage, retried };
}

/** Numbers that may legitimately appear in a cover letter: anything in the profile. */
function profileNumbers(profile: Profile): Set<string> {
  const parts = [profile.summary];
  for (const items of Object.values(profile.skills)) parts.push(...items);
  for (const exp of profile.experience) {
    parts.push(exp.title, exp.company, exp.start, exp.end);
    for (const b of exp.bullets) parts.push(b.text);
  }
  for (const proj of profile.projects) {
    parts.push(proj.name);
    for (const b of proj.bullets) parts.push(b.text);
  }
  return standaloneNumbers(parts.join(' '));
}

function groundCoverNote(text: string, allowed: ReadonlySet<string>): string[] {
  const violations: string[] = [];
  if (/\[NEEDS INPUT/i.test(text)) {
    violations.push(
      'the letter contains a [NEEDS INPUT] marker; write the finished letter from the profile, preferences, and posting instead',
    );
  }
  for (const n of standaloneNumbers(text)) {
    if (!allowed.has(n)) violations.push(`number "${n}" is not grounded in the profile`);
  }
  return violations;
}

/**
 * A complete letter composed only from profile facts, used when the model
 * cannot stay grounded. No placeholders: the summary, the current role with
 * one of its own bullets, and the skill list are all already his.
 */
export function fallbackLetter(company: string, profile: Profile): string {
  const current = profile.experience.find((e) => /present|current|now/i.test(e.end));
  const role = current ?? profile.experience[0];
  const skills = Object.values(profile.skills).flat().slice(0, 8);
  const lines = [`Dear ${company} team,`, '', profile.summary.trim(), ''];
  if (role) {
    lines.push(`As ${role.title} at ${role.company}, my recent work includes:`);
    const bullet = role.bullets[0];
    if (bullet) lines.push(bullet.text.trim());
    lines.push('');
  }
  if (skills.length > 0) {
    lines.push(`My core stack is ${skills.join(', ')}.`);
    lines.push('');
  }
  lines.push(
    `That experience is what I would bring to this role at ${company}, and I would welcome a conversation about it.`,
    '',
    'Best regards,',
    profile.contact.name,
  );
  return lines.join('\n');
}
