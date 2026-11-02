import { z } from 'zod';
import type { Profile } from '../config/schemas.js';
import { isApproved } from '../pipeline/tracker.js';
import { attachmentName } from '../prep/render.js';
import { FILLABLE_ATS } from './apply.js';
import { isUsable, profileValue, questionKey } from './field-map.js';
import type { FillReport, FilledField, UnfilledField } from './types.js';

const storedReportSchema = z.object({
  ats: z.string(),
  url: z.string(),
  filled: z.array(
    z.object({
      field: z.string(),
      via: z.enum(['profile', 'answer', 'resume', 'draft', 'cover']),
      source: z.string(),
    }),
  ),
  unfilled: z.array(
    z.object({ field: z.string(), required: z.boolean(), reason: z.string().optional() }),
  ),
  skipped_eeo: z.array(z.string()),
  // Reports stored before D66 have no self-identification list.
  self_identification: z.array(z.object({ field: z.string(), value: z.string() })).default([]),
  resumeAttached: z.boolean(),
});

/** The `applications.fill_report` column as a report, or null when there is none or it doesn't parse. */
export function parseStoredReport(value: unknown): FillReport | null {
  if (value == null) return null;
  const parsed = storedReportSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * The stored fill report as Kris reads it in the workspace (J7). Pure: it takes
 * the report, the application's answers and cover note, the profile and the
 * approvals, and returns one row per field with its state and where its value
 * came from. A report stores labels and sources only, never typed values, so a
 * value shown here is looked up again from the same source the fill used.
 * Self-identification rows show exactly the option the fill selected
 * (invariant 7); nothing here derives one.
 */

export type FillRowSource = 'profile' | 'drafted' | 'resume' | 'cover-note' | 'self-id';

/**
 * Where a blank field gets fixed. `answer`: an answer on the Answers tab fills
 * it next time. `cover`: the cover note has a gap. `profile`: the value has to
 * come from `profile.yaml`. `form`: only Kris can do it, on the page in Chrome.
 */
export type BlankFix = 'answer' | 'cover' | 'profile' | 'form';

export interface FillRow {
  id: string;
  label: string;
  value?: string;
  state: 'filled' | 'review' | 'blank';
  source?: FillRowSource;
  required?: boolean;
  note?: string;
  /** The saved-answer key behind a drafted answer or a blank question, when there is one. */
  answerKey?: string;
  /** Drafted rows: the key an approval is recorded under. */
  approvalKey?: string;
  /** Blank rows: where the fix lives. */
  fix?: BlankFix;
}

export interface FillView {
  rows: FillRow[];
  filled: number;
  review: number;
  blank: number;
  requiredBlank: number;
  resumeAttached: boolean;
  selfIdNote: string;
  /** The ATS has a form filler (Greenhouse, Lever, Ashby, SmartRecruiters). */
  hasAdapter: boolean;
  /**
   * Open the copy-paste fallback without being asked: the ATS has no filler,
   * the fill found no fields, or most fields came back blank.
   */
  fallbackOpen: boolean;
}

export interface FillViewInput {
  ats: string;
  report: FillReport | null;
  answers: Record<string, string>;
  coverNote: string | null;
  profile: Profile;
  approvals: ReadonlyMap<string, string>;
}

/** Shown in place of a drafted answer whose text the report can't recover. */
export const DRAFT_ON_FORM = 'Written into the form in Chrome. Check it there before you submit.';

export const NO_SELF_ID = 'This form has no self-identification questions.';

export function hasFormAdapter(ats: string): boolean {
  return (FILLABLE_ATS as readonly string[]).includes(ats) || ats === 'smartrecruiters';
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Shorter answers are a yes/no, a date or a dropdown value: picked on the form, not pasted. */
export const COPY_MIN_WORDS = 12;

export interface CopyRow {
  key: string;
  label: string;
  value: string;
}

/**
 * The copy-paste fallback's rows: the cover note, then written answers to this
 * form's own questions. Standard answers stay out (the filler maps them), as
 * does anything with a gap still in it.
 */
export function copyPasteRows(
  coverNote: string | null,
  answers: ReadonlyArray<{ key: string; label: string; value: string; standard: boolean }>,
): CopyRow[] {
  const rows: CopyRow[] = [];
  if (isUsable(coverNote)) rows.push({ key: 'cover-note', label: 'Cover note', value: coverNote });
  for (const a of answers) {
    if (!a.standard && isUsable(a.value) && wordCount(a.value) >= COPY_MIN_WORDS) {
      rows.push({ key: a.key, label: a.label, value: a.value });
    }
  }
  return rows;
}

/** The saved answer a drafted or question field is keyed by, if one exists. */
function savedAnswerKey(
  answers: Record<string, string>,
  source: string,
  label: string,
): string | undefined {
  if (source in answers) return source;
  const key = questionKey(label);
  return key in answers ? key : undefined;
}

function filledRow(id: string, f: FilledField, input: FillViewInput): FillRow {
  const { answers, profile, coverNote } = input;
  const base = { id, label: f.field };
  switch (f.via) {
    case 'resume':
      return {
        ...base,
        state: 'filled',
        source: 'resume',
        value: attachmentName(profile, 'Resume'),
      };
    case 'cover':
      return {
        ...base,
        state: 'filled',
        source: 'cover-note',
        value:
          f.source === 'cover_letter'
            ? attachmentName(profile, 'Cover_Letter')
            : isUsable(coverNote)
              ? `Your cover note, ${wordCount(coverNote)} words`
              : undefined,
      };
    case 'answer':
      return { ...base, state: 'filled', source: 'profile', value: answers[f.source] };
    case 'profile': {
      const value =
        f.source !== 'profile' && f.source in answers
          ? answers[f.source]
          : profileValue(profile, f.source, f.field);
      return { ...base, state: 'filled', source: 'profile', value };
    }
    case 'draft': {
      const draft = draftedAnswer(f, input);
      const approved = isApproved(input.approvals, draft.approvalKey, draft.value);
      return {
        ...base,
        state: approved ? 'filled' : 'review',
        source: 'drafted',
        value: isUsable(draft.value) ? draft.value : DRAFT_ON_FORM,
        answerKey: draft.answerKey,
        approvalKey: draft.approvalKey,
      };
    }
  }
}

/**
 * A drafted field's text and keys. `value` is '' when the report can't recover
 * it (the model mapper's drafts aren't saved as answers).
 */
function draftedAnswer(
  f: FilledField,
  input: Pick<FillViewInput, 'answers' | 'profile'>,
): { value: string; approvalKey: string; answerKey?: string } {
  if (f.source === 'profile.summary') {
    return { value: input.profile.summary, approvalKey: questionKey(f.field) };
  }
  const saved = savedAnswerKey(input.answers, f.source, f.field);
  const key = saved ?? questionKey(f.field);
  return {
    value: saved !== undefined ? (input.answers[saved] ?? '') : '',
    approvalKey: key,
    answerKey: key,
  };
}

/**
 * The drafted answer an approval for `approvalKey` covers, so "Looks good"
 * records a fingerprint of exactly the text the workspace shows.
 */
export function approvalTarget(
  input: Pick<FillViewInput, 'report' | 'answers' | 'profile'>,
  approvalKey: string,
): { question: string; value: string } | undefined {
  for (const f of input.report?.filled ?? []) {
    if (f.via !== 'draft') continue;
    const draft = draftedAnswer(f, input);
    if (draft.approvalKey === approvalKey) return { question: approvalKey, value: draft.value };
  }
  return undefined;
}

/** A blank field's reason in Kris's words, and where it gets fixed. */
export function blankReason(reason: string | undefined): { note?: string; fix: BlankFix } {
  const r = (reason ?? '').trim();
  if (r === '') return { fix: 'answer' };
  if (/^blank on purpose/i.test(r)) {
    return { note: 'Blank on purpose: no answer recorded for this question', fix: 'answer' };
  }
  if (/^nothing in your profile answers this/i.test(r)) {
    return { note: 'No answer in your profile', fix: 'answer' };
  }
  if (/cover note/i.test(r)) {
    return {
      note: /gap/i.test(r) ? 'Your cover note still has a gap to fill' : 'No cover note yet',
      fix: 'cover',
    };
  }
  const marker = r.match(/^\[NEEDS INPUT:\s*([^\]]*)\]?/i);
  if (marker) return { note: `Needs your input: ${(marker[1] ?? '').trim()}`, fix: 'answer' };
  if (/^not in your profile/i.test(r)) return { note: 'Not in your profile', fix: 'profile' };
  const date = r.match(/^profile (start|end) date "([^"]*)" has no month/i);
  if (date) {
    return {
      note: `Your profile ${date[1]?.toLowerCase()} date “${date[2]}” has no month, so it was left for you`,
      fix: 'profile',
    };
  }
  if (/^checkbox left for you/i.test(r)) return { note: 'A checkbox for you to tick', fix: 'form' };
  const option = r.match(/^no (?:dropdown )?option matches "([^"]*)"/i);
  if (option) return { note: `No option on the form matches “${option[1]}”`, fix: 'form' };
  if (/^no resume pdf/i.test(r)) return { note: 'No resume PDF yet', fix: 'form' };
  if (/^site validation:/i.test(r)) {
    return { note: `The site rejected it: ${r.replace(/^site validation:\s*/i, '')}`, fix: 'form' };
  }
  return { note: r.charAt(0).toUpperCase() + r.slice(1), fix: 'form' };
}

function blankRow(id: string, u: UnfilledField, answers: Record<string, string>): FillRow {
  const { note, fix } = blankReason(u.reason);
  return {
    id,
    label: u.field,
    state: 'blank',
    required: u.required,
    note,
    fix,
    answerKey:
      fix === 'answer' ? (savedAnswerKey(answers, '', u.field) ?? questionKey(u.field)) : undefined,
  };
}

export function fillView(input: FillViewInput): FillView {
  const { report } = input;
  const hasAdapter = hasFormAdapter(input.ats);
  if (!report) {
    return {
      rows: [],
      filled: 0,
      review: 0,
      blank: 0,
      requiredBlank: 0,
      resumeAttached: false,
      selfIdNote: NO_SELF_ID,
      hasAdapter,
      fallbackOpen: !hasAdapter,
    };
  }

  const selfIds = report.self_identification;
  const rows: FillRow[] = [
    ...report.filled.map((f, i) => filledRow(`filled-${i}`, f, input)),
    ...report.unfilled.map((u, i) => blankRow(`blank-${i}`, u, input.answers)),
    ...report.skipped_eeo.map(
      (field, i): FillRow => ({
        id: `eeo-${i}`,
        label: field,
        state: 'blank',
        required: false,
        note: 'Self-identification: no answer in profile.yaml and no decline option, so left for you',
        fix: 'profile',
      }),
    ),
    ...selfIds.map(
      (s, i): FillRow => ({
        id: `self-id-${i}`,
        label: s.field,
        value: s.value,
        state: 'filled',
        source: 'self-id',
      }),
    ),
  ];

  const count = (state: FillRow['state']) => rows.filter((r) => r.state === state).length;
  const filled = count('filled');
  const review = count('review');
  const blank = count('blank');
  const skipped = report.skipped_eeo.length;
  const selfIdNote =
    selfIds.length === 0 && skipped > 0
      ? `Nothing was selected. ${skipped} self-identification ${skipped === 1 ? 'question is' : 'questions are'} under Left blank.`
      : NO_SELF_ID;

  return {
    rows,
    filled,
    review,
    blank,
    requiredBlank: rows.filter((r) => r.state === 'blank' && r.required).length,
    resumeAttached: report.resumeAttached,
    selfIdNote,
    hasAdapter,
    fallbackOpen: !hasAdapter || rows.length === 0 || blank > filled + review,
  };
}
