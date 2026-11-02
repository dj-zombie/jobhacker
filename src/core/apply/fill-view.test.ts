import { describe, expect, it } from 'vitest';
import type { Profile } from '../config/schemas.js';
import { answerFingerprint } from '../pipeline/tracker.js';
import {
  DRAFT_ON_FORM,
  NO_SELF_ID,
  approvalTarget,
  blankReason,
  copyPasteRows,
  fillView,
  hasFormAdapter,
  parseStoredReport,
} from './fill-view.js';
import type { FillReport } from './types.js';

const PROFILE: Profile = {
  contact: {
    name: 'Kris Tester',
    email: 'kris@example.com',
    phone: '+1 555 555 5555',
    location: 'Scottsdale, AZ',
  },
  links: { linkedin: 'https://linkedin.com/in/kris', github: 'https://github.com/kris' },
  summary: 'Senior engineer.',
  skills: { frontend: ['React'] },
  experience: [],
  projects: [],
  education: [],
  standard_answers: {},
};

const TIMEZONE = 'Are you based in a US or equivalent timezone?';
const ESSAY = 'Tell us more';

/** Shaped like a real Ashby fill: 9 filled (2 drafted), 2 blank on purpose. */
function report(overrides: Partial<FillReport> = {}): FillReport {
  return {
    ats: 'ashby',
    url: 'https://jobs.ashbyhq.com/acme/1/application',
    filled: [
      { field: 'Name', via: 'profile', source: 'contact.name' },
      { field: 'Email', via: 'profile', source: 'contact.email' },
      { field: 'Resume', via: 'resume', source: 'resume' },
      { field: 'Cover letter', via: 'cover', source: 'cover_note' },
      { field: 'GitHub', via: 'profile', source: 'links.github' },
      { field: 'LinkedIn', via: 'profile', source: 'links.linkedin' },
      { field: 'What country are you based in?', via: 'profile', source: 'contact.country' },
      { field: TIMEZONE, via: 'draft', source: TIMEZONE },
      { field: ESSAY, via: 'draft', source: ESSAY },
    ],
    unfilled: [
      {
        field: 'X',
        required: false,
        reason: 'blank on purpose — you recorded no answer for this question',
      },
      {
        field: 'Has someone referred you?',
        required: false,
        reason: 'blank on purpose — you recorded no answer for this question',
      },
    ],
    skipped_eeo: [],
    self_identification: [],
    resumeAttached: true,
    ...overrides,
  };
}

const ANSWERS = {
  work_authorization_us: 'Yes',
  [TIMEZONE]: 'Yes',
  [ESSAY]: 'I led the rebuild of a checkout flow end to end.',
  X: '',
  'Has someone referred you?': '',
};

function view(overrides: Partial<Parameters<typeof fillView>[0]> = {}) {
  return fillView({
    ats: 'ashby',
    report: report(),
    answers: ANSWERS,
    coverNote: 'Dear team, I would like to apply.',
    profile: PROFILE,
    approvals: new Map(),
    ...overrides,
  });
}

describe('fillView', () => {
  it('counts filled, drafted and blank fields the way the fill event does', () => {
    const v = view();
    expect([v.filled, v.review, v.blank, v.requiredBlank]).toEqual([7, 2, 2, 0]);
    expect(v.resumeAttached).toBe(true);
    expect(v.fallbackOpen).toBe(false);
    expect(v.selfIdNote).toBe(NO_SELF_ID);
  });

  it('shows each filled value from the source the fill used, with its source', () => {
    const rows = new Map(view().rows.map((r) => [r.label, r]));
    expect(rows.get('Name')).toMatchObject({ value: 'Kris Tester', source: 'profile' });
    expect(rows.get('Email')).toMatchObject({ value: 'kris@example.com', source: 'profile' });
    expect(rows.get('Resume')).toMatchObject({ value: 'Kris_Tester_Resume.pdf', source: 'resume' });
    expect(rows.get('Cover letter')).toMatchObject({
      value: 'Your cover note, 7 words',
      source: 'cover-note',
    });
    expect(rows.get('What country are you based in?')).toMatchObject({
      value: 'United States',
      source: 'profile',
    });
    expect(rows.get(ESSAY)).toMatchObject({
      state: 'review',
      source: 'drafted',
      value: ANSWERS[ESSAY],
      answerKey: ESSAY,
      approvalKey: ESSAY,
    });
  });

  it('moves a drafted answer to filled once approved, and back when its text changes', () => {
    const approvals = new Map([[ESSAY, answerFingerprint(ANSWERS[ESSAY])]]);
    const approved = view({ approvals });
    expect(approved.rows.find((r) => r.label === ESSAY)?.state).toBe('filled');
    expect([approved.filled, approved.review]).toEqual([8, 1]);

    const edited = view({ approvals, answers: { ...ANSWERS, [ESSAY]: 'Something else.' } });
    expect(edited.rows.find((r) => r.label === ESSAY)?.state).toBe('review');
  });

  it('approvalTarget hashes exactly the text the row shows', () => {
    const target = approvalTarget({ report: report(), answers: ANSWERS, profile: PROFILE }, ESSAY);
    expect(target).toEqual({ question: ESSAY, value: ANSWERS[ESSAY] });
    expect(approvalTarget({ report: report(), answers: ANSWERS, profile: PROFILE }, 'Name')).toBe(
      undefined,
    );
  });

  it('says so instead of guessing when a draft has no saved text', () => {
    const v = view({
      report: report({ filled: [{ field: 'Why us?', via: 'draft', source: 'field-map' }] }),
    });
    expect(v.rows[0]).toMatchObject({
      state: 'review',
      value: DRAFT_ON_FORM,
      answerKey: 'Why us?',
    });
  });

  it('shows self-identification exactly as selected, and lists skipped ones as blank', () => {
    const v = view({
      report: report({
        self_identification: [{ field: 'Gender', value: 'Decline to self-identify' }],
        skipped_eeo: ['Veteran Status'],
      }),
    });
    expect(v.rows.find((r) => r.label === 'Gender')).toMatchObject({
      state: 'filled',
      source: 'self-id',
      value: 'Decline to self-identify',
    });
    const veteran = v.rows.find((r) => r.label === 'Veteran Status');
    expect(veteran).toMatchObject({ state: 'blank', fix: 'profile' });
    expect(veteran?.source).toBeUndefined();
  });

  it('notes when nothing was selected for self-identification', () => {
    const v = view({ report: report({ skipped_eeo: ['Gender', 'Race'] }) });
    expect(v.selfIdNote).toBe(
      'Nothing was selected. 2 self-identification questions are under Left blank.',
    );
  });

  it('parses a report stored before self-identification was recorded', () => {
    const old: Record<string, unknown> = { ...report() };
    Reflect.deleteProperty(old, 'self_identification');
    const parsed = parseStoredReport(JSON.parse(JSON.stringify(old)));
    expect(parsed?.self_identification).toEqual([]);
    expect(view({ report: parsed }).rows).toHaveLength(11);
  });

  it('reads an unparseable stored report as not filled', () => {
    expect(parseStoredReport(null)).toBeNull();
    expect(parseStoredReport({ ats: 'ashby' })).toBeNull();
  });

  it('opens the copy-paste fallback when there is no filler, no fields, or mostly blanks', () => {
    expect(view({ ats: 'workday' }).fallbackOpen).toBe(true);
    expect(view({ report: report({ filled: [], unfilled: [] }) }).fallbackOpen).toBe(true);
    const mostlyBlank = report({
      filled: [{ field: 'Email', via: 'profile', source: 'contact.email' }],
      unfilled: [
        { field: 'A', required: true },
        { field: 'B', required: false },
      ],
    });
    const v = view({ report: mostlyBlank });
    expect(v.fallbackOpen).toBe(true);
    expect(v.requiredBlank).toBe(1);
    expect(view({ report: null, ats: 'greenhouse' }).fallbackOpen).toBe(false);
    expect(view({ report: null, ats: 'jsearch' }).fallbackOpen).toBe(true);
  });
});

describe('blankReason', () => {
  it.each([
    ['blank on purpose — you recorded no answer for this question', 'answer', 'Blank on purpose'],
    ['nothing in your profile answers this; left for you', 'answer', 'No answer in your profile'],
    ['[NEEDS INPUT: Rust experience is not in the profile.]', 'answer', 'Needs your input: Rust'],
    [
      'your cover note still has a gap, [NEEDS INPUT: x]; fill it in on the application page, then fill again',
      'cover',
      'Your cover note still has a gap',
    ],
    ['not in your profile (contact.phone)', 'profile', 'Not in your profile'],
    ['profile start date "2005" has no month; not guessing one', 'profile', 'start date “2005”'],
    ['checkbox left for you', 'form', 'A checkbox for you to tick'],
    ['no dropdown option matches "Desert Mesa College"', 'form', 'No option on the form matches'],
    ['site validation: Enter a date', 'form', 'The site rejected it: Enter a date'],
  ] as const)('%s', (reason, fix, note) => {
    const out = blankReason(reason);
    expect(out.fix).toBe(fix);
    expect(out.note).toContain(note);
  });

  it('never shows an internal profile key', () => {
    expect(blankReason('not in your profile (contact.phone)').note).not.toContain('contact.');
  });

  it('defaults an unexplained blank to an answer', () => {
    expect(blankReason(undefined)).toEqual({ fix: 'answer' });
  });
});

describe('hasFormAdapter', () => {
  it('knows which ATSs have a filler', () => {
    expect(['greenhouse', 'lever', 'ashby', 'smartrecruiters'].map(hasFormAdapter)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(hasFormAdapter('jsearch')).toBe(false);
  });
});

describe('copyPasteRows', () => {
  const COVER = 'I have spent ten years building internal tools for product teams.\n\nKris';
  const WHY =
    'Your team ships tools that artists use every day, and I have spent my career building exactly that kind of tool.';
  const answer = (key: string, value: string, standard = false) => ({
    key,
    label: key,
    value,
    standard,
  });

  it('keeps the cover note and written answers, in full', () => {
    const rows = copyPasteRows(COVER, [answer('Why do you want to work here?', WHY)]);
    expect(rows).toEqual([
      { key: 'cover-note', label: 'Cover note', value: COVER },
      { key: 'Why do you want to work here?', label: 'Why do you want to work here?', value: WHY },
    ]);
  });

  it('leaves out what gets picked on the form rather than pasted', () => {
    const rows = copyPasteRows(COVER, [
      answer('work_authorization_us', 'Yes', true),
      answer('salary_expectation', '$180,000 - $220,000 USD', true),
      answer('how_did_you_hear', 'Company careers page', true),
      answer(TIMEZONE, 'Yes'),
      answer('Degree', ''),
      answer('Referred by', 'Nobody'),
    ]);
    expect(rows.map((r) => r.key)).toEqual(['cover-note']);
  });

  it('leaves out a long standard answer too: the filler maps those', () => {
    const rows = copyPasteRows(null, [answer('willing_to_relocate', WHY, true)]);
    expect(rows).toEqual([]);
  });

  it('skips a cover note or answer that still has a gap', () => {
    expect(
      copyPasteRows('[NEEDS INPUT: why us]', [answer(ESSAY, `${WHY} [NEEDS INPUT: x]`)]),
    ).toEqual([]);
  });
});
