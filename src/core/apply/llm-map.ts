import type { Profile } from '../config/schemas.js';
import {
  FIELD_MAP_SYSTEM,
  type FieldMapOutput,
  type FieldMapPromptQuestion,
  fieldMapOutputSchema,
  fieldMapUserPrompt,
} from '../llm/prompts/field-map.js';
import type { LlmClient, LlmUsage } from '../llm/types.js';
import { renderProfileForAnswers } from '../prep/form-answers.js';
import {
  type FieldMapping,
  isEeoField,
  isStandardKey,
  isUsable,
  matchOption,
  questionKey,
} from './field-map.js';
import type { RawFormField } from './types.js';

/**
 * LLM field mapping for a form that has no ATS adapter (Phase 3 Slice 2).
 * The model returns a value per harvested question id. This module drops EEO
 * fields, ungrounded numbers, and choice answers that are not one of the
 * options, then turns the rest into fill mappings. Low-confidence and prose
 * answers are marked `draft` so the form outlines them for review.
 */

const QUESTION_CAP = 40;

export interface MappingQuestion extends FieldMapPromptQuestion {
  selector: string;
}

export interface MapFormFieldsDeps {
  llm: LlmClient;
  model: string;
  profile: Profile;
  preferences: string;
  /** Prepared answers already saved on the application. */
  answers: Record<string, string>;
  /** Company, title, and a short posting excerpt. Numbers here are not facts about Kris. */
  jobText: string;
}

export interface MapFormFieldsResult {
  mappings: Map<string, FieldMapping>;
  usage: LlmUsage;
  questions: number;
  kept: number;
  dropped: number;
}

export function questionsForMapping(fields: RawFormField[]): MappingQuestion[] {
  const questions: MappingQuestion[] = [];
  const seenRadio = new Set<string>();
  for (const field of fields) {
    if (questions.length >= QUESTION_CAP) break;
    if (skipField(field)) continue;
    if (isVagueAuthorizationQuestion(field.group ?? field.label)) continue;
    if (field.type === 'radio') {
      const key = field.name ?? field.group ?? field.selector;
      if (seenRadio.has(key)) continue;
      seenRadio.add(key);
      const group = fields.filter(
        (other) => other.type === 'radio' && (other.name ?? other.group ?? other.selector) === key,
      );
      const label = questionKey(field.group || field.label);
      if (!label || isEeoField(label)) continue;
      questions.push({
        id: questions.length,
        selector: field.selector,
        label,
        hint: (field.hint ?? '').slice(0, 300),
        required: group.some((item) => item.required) || field.required,
        kind: 'choice',
        options: group.map((item) => item.label).filter((label) => label.trim().length > 0),
      });
      continue;
    }
    const label = questionKey(field.label);
    if (!label || isEeoField(label)) continue;
    const options = field.options.map((option) => option.label).filter((item) => item.trim());
    const choice = (field.tag === 'select' || field.tag === 'toggle') && options.length > 0;
    questions.push({
      id: questions.length,
      selector: field.selector,
      label,
      hint: (field.hint ?? '').slice(0, 300),
      required: field.required,
      kind: choice ? 'choice' : field.tag === 'textarea' ? 'textarea' : 'text',
      options: choice ? options : [],
    });
  }
  return questions;
}

function skipField(field: RawFormField): boolean {
  if (field.inEeoSection || field.isFile) return true;
  if (field.inEntryEditor) return true;
  if (field.type === 'checkbox' || field.type === 'hidden' || field.type === 'submit') return true;
  if (isEeoField(field.group ?? field.label)) return true;
  return false;
}

/**
 * Work-authorization / working-rights questions whose country is not named
 * ("Do you have working rights in the country you're applying to?") must not
 * be answered from a US standard answer: the job may be in another country,
 * and the profile states US authorization only. Explicitly-US questions keep
 * the deterministic standard-answer path (they never reach the model as a
 * guess: `mapFormFields` drops these from the model's list entirely).
 */
export function isVagueAuthorizationQuestion(label: string): boolean {
  const vague =
    /working rights|right to work/i.test(label) ||
    (/authori|eligible/i.test(label) && /country you/i.test(label));
  if (!vague) return false;
  return !/united states|u\.s\.a?\.|america/i.test(label);
}

/**
 * Turn a validated model response into fill mappings. A choice must be one of
 * the offered options. Any other value is kept only when every number in it
 * already appears in the profile, answers, or preferences. Prose is always
 * `draft` so it is outlined for review.
 */
export function acceptMappings(
  questions: MappingQuestion[],
  output: FieldMapOutput,
  basis: string,
): { mappings: Map<string, FieldMapping>; kept: number; dropped: number } {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const mappings = new Map<string, FieldMapping>();
  let kept = 0;
  let dropped = 0;
  const basisLower = basis.toLowerCase();
  for (const row of output.mappings) {
    const question = byId.get(row.id);
    if (!question) {
      dropped += 1;
      continue;
    }
    const value = row.value?.trim() ?? '';
    if (!value) continue;
    if (!isUsable(value)) {
      mappings.set(question.selector, {
        kind: 'needs_input',
        source: row.source || 'field-map',
        reason: value,
      });
      dropped += 1;
      continue;
    }
    if (!grounded(value, question, basisLower)) {
      dropped += 1;
      continue;
    }
    const prose = question.kind === 'textarea' || value.length > 80;
    const via = row.confidence === 'low' || prose ? 'draft' : viaFor(row.source);
    mappings.set(question.selector, {
      kind: 'value',
      via,
      source: row.source.trim() || 'field-map',
      value,
    });
    kept += 1;
  }
  return { mappings, kept, dropped };
}

const RESERVED_SOURCES = new Set(['profile', 'preferences', 'field-map', '']);

function viaFor(source: string): 'profile' | 'answer' {
  const trimmed = source.trim();
  return isStandardKey(trimmed) && !RESERVED_SOURCES.has(trimmed) ? 'answer' : 'profile';
}

function grounded(value: string, question: MappingQuestion, basisLower: string): boolean {
  if (question.kind === 'choice') {
    return (
      matchOption(
        question.options.map((option) => ({ value: option, label: option })),
        value,
      ) !== undefined
    );
  }
  // A link has to be one Kris actually listed. A URL with no digits would
  // otherwise pass the number check and invent a Facebook or X account.
  if (/^https?:\/\//i.test(value) && !basisLower.includes(value.toLowerCase())) return false;
  const numbers = value.match(/\d+(?:\.\d+)?/g) ?? [];
  return numbers.every((number) => basisLower.includes(number.toLowerCase()));
}

export function mappingBasis(
  profile: Profile,
  answers: Record<string, string>,
  preferences: string,
): string {
  const standard = Object.entries(profile.standard_answers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
  const prepared = Object.entries(answers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
  return [renderProfileForAnswers(profile), standard, prepared, preferences].join('\n');
}

export async function mapFormFields(
  deps: MapFormFieldsDeps,
  fields: RawFormField[],
): Promise<MapFormFieldsResult> {
  const questions = questionsForMapping(fields);
  const empty: LlmUsage = {
    model: deps.model,
    inputTokens: 0,
    outputTokens: 0,
    calls: 0,
  };
  if (questions.length === 0) {
    return { mappings: new Map(), usage: empty, questions: 0, kept: 0, dropped: 0 };
  }
  const basis = mappingBasis(deps.profile, deps.answers, deps.preferences);
  const standard = Object.entries(deps.profile.standard_answers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
  const result = await deps.llm.structured({
    model: deps.model,
    system: FIELD_MAP_SYSTEM,
    user: fieldMapUserPrompt({
      job: deps.jobText,
      profile: renderProfileForAnswers(deps.profile),
      standardAnswers: standard,
      preferences: deps.preferences,
      questions,
    }),
    schema: fieldMapOutputSchema,
    maxTokens: 2000,
    promptName: 'field-map',
  });
  const accepted = acceptMappings(questions, result.value, basis);
  return {
    mappings: accepted.mappings,
    usage: result.usage,
    questions: questions.length,
    kept: accepted.kept,
    dropped: accepted.dropped,
  };
}
