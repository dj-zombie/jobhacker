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
import { type CitationGrounding, linkInNote } from './citations.js';
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
 * His own rough answer and his note for one question (D180) are added to that
 * question's allowed terms and numbers, as is the wording of a page he linked
 * (D181). Rejected drafts are retried once with the problems listed; whatever still
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
  /**
   * Reads the https link in a note and returns what the draft may take from
   * that page. Omitted, a note that contains a link is not drafted.
   */
  readLink?: (url: string) => Promise<CitationGrounding | null>;
}

/** What he gave for one question on the Answers tab (D180). */
export interface Guide {
  /** His rough answer, in his words, to rewrite. */
  draft?: string;
  /** What to say. Its first https link is read (D181). */
  note?: string;
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

/** Words and numbers that count as part of the question for this one draft. */
export interface DraftExtra {
  terms?: string;
  numbers?: string;
  /** He wrote a draft or a note, so an essay need not cite profile bullets. */
  guided?: boolean;
}

const ESSAY_CUE = /\b(sentence|sentences|paragraph|describe|tell us|share|why)\b/i;

/**
 * Opens like a yes/no question: "Will you…", "Are you…", or "If …, will you…".
 * A comma after the "if" clause keeps "If you want a long answer, describe…" out.
 */
const YES_NO_OPEN =
  /^(?:if\b[^?]{0,180},\s*)?(?:will|would|do|does|did|are|is|was|were|can|could|have|has|had|should)\b/i;

/** Yes or No, and nothing after it. A longer rough answer is not this. */
const CLOSED_ANSWER = /^(?:yes|no)\b[.!]?$/i;

/** At most this many words is one line he already wrote, not an essay to expand. */
const SHORT_ANSWER_WORDS = 12;

function wordsOf(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

/**
 * Draft no longer has the form's control (D182). A yes or no he wrote, any
 * other short answer, or a question that opens as yes/no, stays one line.
 * An essay cue, or a long question he has not answered shortly, is a textarea.
 */
export function guidedQuestionKind(label: string, rough = ''): 'text' | 'textarea' {
  const answer = rough.trim();
  if (CLOSED_ANSWER.test(answer)) return 'text';
  const essay = ESSAY_CUE.test(label);
  const answerWords = wordsOf(answer).length;
  if (!essay && answerWords > 0 && answerWords <= SHORT_ANSWER_WORDS) return 'text';
  if (!essay && YES_NO_OPEN.test(label.trim())) return 'text';
  if (wordsOf(label).length >= 8 || essay) return 'textarea';
  return 'text';
}

/** The longest note Draft will send. Longer than this is a pasted essay, not a steer. */
export const NOTE_MAX_CHARS = 800;

/** The longest rough answer Draft will send. */
export const DRAFT_MAX_CHARS = 4_000;

/** Check one raw draft against its question and the grounding basis (pure). */
export function checkDraft(
  q: OpenQuestion,
  raw: FormAnswersOutput['answers'][number] | undefined,
  basis: GroundingBasis,
  extra: DraftExtra = {},
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
  const questionNumbers = standaloneNumbers(`${questionText}\n${extra.numbers ?? ''}`);
  for (const n of standaloneNumbers(claims)) {
    if (!basis.numbers.has(n) && !questionNumbers.has(n)) {
      violations.push(`number "${n}" is not in the profile`);
    }
  }
  const questionTerms = termSet(`${questionText}\n${extra.terms ?? ''}`);
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
  if (q.kind === 'textarea' && sourceIds.length === 0 && !extra.guided) {
    violations.push('an essay answer must list the profile bullet ids it draws on');
  }
  return { answer: violations.length > 0 ? null : text, needsInput: null, sourceIds, violations };
}

function promptQuestions(
  questions: OpenQuestion[],
  ids: number[],
  guides?: ReadonlyMap<number, Guide>,
  sources?: ReadonlyMap<number, string>,
): FormAnswersPromptQuestion[] {
  return ids.map((id) => {
    const q = questions[id] as OpenQuestion;
    const draft = guides?.get(id)?.draft?.trim() || undefined;
    const guidance = guides?.get(id)?.note?.trim() || undefined;
    const source = sources?.get(id)?.trim() || undefined;
    return {
      id,
      label: q.label,
      hint: q.hint,
      required: q.required,
      kind: q.kind,
      options: q.options,
      ...(draft ? { draft } : {}),
      ...(guidance ? { guidance } : {}),
      ...(source ? { source } : {}),
    };
  });
}

function byId(output: FormAnswersOutput): Map<number, FormAnswersOutput['answers'][number]> {
  const map = new Map<number, FormAnswersOutput['answers'][number]>();
  for (const a of output.answers) if (!map.has(a.id)) map.set(a.id, a);
  return map;
}

/** His draft, his note and a page he linked count as grounding for that one question. */
function extraFor(guide: Guide | undefined, linked: CitationGrounding | undefined): DraftExtra {
  const own = [guide?.draft ?? '', guide?.note ?? ''].filter((part) => part.trim() !== '');
  if (own.length === 0 && !linked) return {};
  return {
    terms: [...own, linked?.terms ?? ''].join('\n'),
    numbers: [...own, linked?.numbers ?? ''].join('\n'),
    guided: true,
  };
}

export async function draftFormAnswers(
  deps: DraftFormAnswersDeps,
  questions: OpenQuestion[],
  guides?: ReadonlyMap<number, Guide>,
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

  const linked = new Map<number, CitationGrounding>();
  const blocked = new Map<number, string>();
  const allIds = questions.map((_, i) => i);
  for (const id of allIds) {
    const found = linkInNote(guides?.get(id)?.note ?? '');
    if (!found) continue;
    if (!found.ok) {
      blocked.set(id, found.reason);
      continue;
    }
    const page = deps.readLink ? await deps.readLink(found.url) : null;
    if (page) linked.set(id, page);
    else blocked.set(id, `could not read ${found.url}`);
  }
  const sourceText = new Map<number, string>();
  for (const [id, page] of linked) sourceText.set(id, page.terms.slice(0, 2_500));

  const call = async (ids: number[], violations?: string[]) => {
    const res = await deps.llm.structured({
      model: deps.model,
      system: FORM_ANSWERS_SYSTEM,
      user: formAnswersUserPrompt({
        ...base,
        questions: promptQuestions(questions, ids, guides, sourceText),
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

  const check = (id: number, raw: FormAnswersOutput['answers'][number] | undefined) =>
    checkDraft(
      questions[id] as OpenQuestion,
      raw,
      basis,
      extraFor(guides?.get(id), linked.get(id)),
    );

  const checked = new Map<number, Checked>();
  const askIds = allIds.filter((id) => !blocked.has(id));
  if (askIds.length > 0) {
    const first = await call(askIds);
    for (const id of askIds) checked.set(id, check(id, first.get(id)));
  }

  const failed = askIds.filter((id) => (checked.get(id)?.violations.length ?? 0) > 0);
  let retried = false;
  if (failed.length > 0) {
    retried = true;
    const problems = failed.flatMap((id) =>
      (checked.get(id)?.violations ?? []).map((v) => `[${id}] ${v}`),
    );
    const second = await call(failed, problems);
    for (const id of failed) checked.set(id, check(id, second.get(id)));
  }

  let rejected = 0;
  const answers = allIds.map((id): DraftedAnswer => {
    const q = questions[id] as OpenQuestion;
    const block = blocked.get(id);
    if (block) {
      rejected++;
      return { label: q.label, answer: null, needsInput: block, sourceIds: [] };
    }
    const c = checked.get(id) as Checked;
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
