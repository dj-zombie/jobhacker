import type { OpenQuestion } from '../apply/types.js';
import type { Profile } from '../config/schemas.js';
import {
  FORM_ANSWERS_SYSTEM,
  type FormAnswersOutput,
  type FormAnswersPromptQuestion,
  formAnswersOutputSchema,
  formAnswersUserPrompt,
} from '../llm/prompts/form-answers.js';
import type { LlmClient, LlmUsage } from '../llm/types.js';
import { tokenize } from '../util/text.js';
import { properNounCandidates, standaloneNumbers } from './grounding.js';

/**
 * Draft answers to the open questions on one application form (FR-7, FR-8).
 * One writing-model call covers every question; each draft is then checked
 * against the profile (invariant 3):
 *   - a choice answer must be one of the form's options;
 *   - every number must appear in the profile, standard answers, preferences
 *     or the question;
 *   - every technology / proper noun must appear in those or the job posting;
 *   - an essay must cite real profile bullet ids.
 * Rejected drafts are retried once with the problems listed; whatever still
 * fails becomes a `[NEEDS INPUT: …]` marker, so nothing ungrounded is filled.
 */

export interface DraftFormAnswersDeps {
  llm: LlmClient;
  model: string;
  profile: Profile;
  /** `preferences.md` text (may be empty). */
  preferences: string;
  /** Company, title, location and truncated description. */
  jobText: string;
  /** The application's cover note (may be empty). */
  coverNote: string;
}

export interface DraftedAnswer {
  label: string;
  /** The grounded answer, or null when there is none. */
  answer: string | null;
  /** What Kris must supply, when the facts do not determine the answer. */
  needsInput: string | null;
  sourceIds: string[];
}

export interface DraftFormAnswersResult {
  answers: DraftedAnswer[];
  usage: LlmUsage;
  retried: boolean;
  /** Drafts that failed grounding twice and became NEEDS INPUT. */
  rejected: number;
}

const MAX_OUTPUT_TOKENS = 4_000;

/** The value an answer is saved under: the answer, a NEEDS INPUT marker, or ''. */
export function storedAnswer(a: DraftedAnswer): string {
  if (a.answer !== null) return a.answer;
  if (a.needsInput) return `[NEEDS INPUT: ${a.needsInput}]`;
  return '';
}

/** Profile as prompt text: everything a form might ask about, minus email/phone. */
export function renderProfileForAnswers(profile: Profile): string {
  const lines: string[] = [];
  lines.push(`Name: ${profile.contact.name}`, `Location: ${profile.contact.location}`);
  const links = Object.entries(profile.links).filter(([, v]) => typeof v === 'string' && v);
  if (links.length > 0) lines.push(`Links: ${links.map(([k, v]) => `${k} ${v}`).join(', ')}`);
  lines.push('', 'Summary:', profile.summary.trim(), '', 'Skills:');
  for (const [group, items] of Object.entries(profile.skills)) {
    lines.push(`- ${group}: ${items.join(', ')}`);
  }
  lines.push('', 'Experience (bullet ids in brackets):');
  for (const exp of profile.experience) {
    const where = exp.location ? `, ${exp.location}` : '';
    lines.push(`${exp.title} — ${exp.company} (${exp.start}–${exp.end}${where})`);
    for (const b of exp.bullets) lines.push(`  [${b.id}] ${b.text}`);
  }
  if (profile.projects.length > 0) {
    lines.push('', 'Projects:');
    for (const proj of profile.projects) {
      lines.push(proj.name);
      for (const b of proj.bullets) lines.push(`  [${b.id}] ${b.text}`);
    }
  }
  lines.push('', 'Education:');
  if (profile.education.length === 0) lines.push('(none listed)');
  for (const e of profile.education) {
    const when = [e.start, e.end].filter(Boolean).join('–');
    lines.push(
      `- ${[e.school, e.credential].filter(Boolean).join(', ')}${when ? ` (${when})` : ''}`,
    );
  }
  return lines.join('\n');
}

function renderStandardAnswers(profile: Profile): string {
  return Object.entries(profile.standard_answers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

/** Lowercased, trailing-dot-stripped tokens, so "U.S." and "U.S" compare equal. */
function termSet(text: string): Set<string> {
  return new Set(tokenize(text).map((t) => t.replace(/\.+$/, '')));
}

interface GroundingBasis {
  numbers: Set<string>;
  terms: Set<string>;
  bulletIds: Set<string>;
}

function basisFor(
  deps: DraftFormAnswersDeps,
  profileText: string,
  standard: string,
): GroundingBasis {
  const factual = [profileText, standard, deps.preferences].join('\n');
  const bulletIds = new Set<string>();
  for (const exp of deps.profile.experience) for (const b of exp.bullets) bulletIds.add(b.id);
  for (const proj of deps.profile.projects) for (const b of proj.bullets) bulletIds.add(b.id);
  return {
    numbers: standaloneNumbers(factual),
    terms: termSet(`${factual}\n${deps.jobText}`),
    bulletIds,
  };
}

interface Checked {
  answer: string | null;
  needsInput: string | null;
  sourceIds: string[];
  violations: string[];
}

/** Check one raw draft against its question and the grounding basis (pure). */
export function checkDraft(
  q: OpenQuestion,
  raw: FormAnswersOutput['answers'][number] | undefined,
  basis: GroundingBasis,
): Checked {
  if (!raw)
    return { answer: null, needsInput: 'no draft was returned', sourceIds: [], violations: [] };
  const text = raw.answer?.trim() ?? '';
  const needsInput = raw.needs_input?.trim() || null;
  if (text === '') return { answer: null, needsInput, sourceIds: [], violations: [] };

  if (q.kind === 'choice') {
    const option = q.options.find((o) => o.trim().toLowerCase() === text.toLowerCase());
    if (!option) {
      return {
        answer: null,
        needsInput,
        sourceIds: [],
        violations: [`answer "${text}" is not one of the options (${q.options.join(' | ')})`],
      };
    }
    return { answer: option, needsInput: null, sourceIds: [], violations: [] };
  }

  const violations: string[] = [];
  const questionText = `${q.label} ${q.hint}`;
  const claims = text.replace(/\[NEEDS INPUT[^\]]*\]/gi, ' ');
  const questionNumbers = standaloneNumbers(questionText);
  for (const n of standaloneNumbers(claims)) {
    if (!basis.numbers.has(n) && !questionNumbers.has(n)) {
      violations.push(`number "${n}" is not in the profile`);
    }
  }
  const questionTerms = termSet(questionText);
  for (const term of properNounCandidates(claims)) {
    const t = term.toLowerCase().replace(/\.+$/, '');
    if (!basis.terms.has(t) && !questionTerms.has(t)) {
      violations.push(`"${term}" is not in the profile or the posting`);
    }
  }
  const sourceIds = raw.source_ids.filter((id) => id.trim() !== '');
  for (const id of sourceIds) {
    if (!basis.bulletIds.has(id)) violations.push(`unknown source id "${id}"`);
  }
  if (q.kind === 'textarea' && sourceIds.length === 0) {
    violations.push('an essay answer must list the profile bullet ids it draws on');
  }
  return { answer: violations.length > 0 ? null : text, needsInput: null, sourceIds, violations };
}

function promptQuestions(questions: OpenQuestion[], ids: number[]): FormAnswersPromptQuestion[] {
  return ids.map((id) => {
    const q = questions[id] as OpenQuestion;
    return {
      id,
      label: q.label,
      hint: q.hint,
      required: q.required,
      kind: q.kind,
      options: q.options,
    };
  });
}

function byId(output: FormAnswersOutput): Map<number, FormAnswersOutput['answers'][number]> {
  const map = new Map<number, FormAnswersOutput['answers'][number]>();
  for (const a of output.answers) if (!map.has(a.id)) map.set(a.id, a);
  return map;
}

export async function draftFormAnswers(
  deps: DraftFormAnswersDeps,
  questions: OpenQuestion[],
): Promise<DraftFormAnswersResult> {
  const usage: LlmUsage = { model: deps.model, inputTokens: 0, outputTokens: 0, calls: 0 };
  if (questions.length === 0) return { answers: [], usage, retried: false, rejected: 0 };

  const profileText = renderProfileForAnswers(deps.profile);
  const standard = renderStandardAnswers(deps.profile);
  const basis = basisFor(deps, profileText, standard);
  const base = {
    job: deps.jobText,
    profile: profileText,
    standardAnswers: standard,
    preferences: deps.preferences,
    coverNote: deps.coverNote,
  };

  const call = async (ids: number[], violations?: string[]) => {
    const res = await deps.llm.structured({
      model: deps.model,
      system: FORM_ANSWERS_SYSTEM,
      user: formAnswersUserPrompt({
        ...base,
        questions: promptQuestions(questions, ids),
        violations,
      }),
      schema: formAnswersOutputSchema,
      maxTokens: MAX_OUTPUT_TOKENS,
      promptName: 'form-answers',
    });
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;
    usage.calls += res.usage.calls;
    return byId(res.value);
  };

  const allIds = questions.map((_, i) => i);
  const first = await call(allIds);
  const checked = allIds.map((id) =>
    checkDraft(questions[id] as OpenQuestion, first.get(id), basis),
  );

  const failed = allIds.filter((id) => (checked[id]?.violations.length ?? 0) > 0);
  let retried = false;
  if (failed.length > 0) {
    retried = true;
    const notes = failed.flatMap((id) =>
      (checked[id]?.violations ?? []).map((v) => `[${id}] ${v}`),
    );
    const second = await call(failed, notes);
    for (const id of failed) {
      checked[id] = checkDraft(questions[id] as OpenQuestion, second.get(id), basis);
    }
  }

  let rejected = 0;
  const answers = allIds.map((id): DraftedAnswer => {
    const q = questions[id] as OpenQuestion;
    const c = checked[id] as Checked;
    if (c.violations.length > 0) {
      rejected++;
      return {
        label: q.label,
        answer: null,
        needsInput: `the drafted answer was not grounded in your profile (${c.violations.join('; ')})`,
        sourceIds: [],
      };
    }
    return { label: q.label, answer: c.answer, needsInput: c.needsInput, sourceIds: c.sourceIds };
  });

  return { answers, usage, retried, rejected };
}
