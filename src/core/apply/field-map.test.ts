import { describe, expect, it } from 'vitest';
import type { Profile } from '../config/schemas.js';
import {
  isEeoField,
  isStandardKey,
  isUsable,
  mapField,
  matchAnswerKey,
  matchOption,
  matchToggleOption,
  questionKey,
  splitName,
} from './field-map.js';
import type { RawFormField } from './types.js';

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    contact: {
      name: 'Kris Tester',
      email: 'kris@example.com',
      phone: '+1 555 555 5555',
      location: 'Scottsdale, AZ',
    },
    links: {
      linkedin: 'https://linkedin.com/in/kris',
      github: 'https://github.com/kris',
    },
    summary: 'Senior engineer.',
    skills: { frontend: ['React'] },
    experience: [],
    projects: [],
    education: [],
    standard_answers: {},
    ...overrides,
  };
}

function field(overrides: Partial<RawFormField> = {}): RawFormField {
  return {
    selector: '#x',
    tag: 'input',
    type: 'text',
    name: null,
    id: 'x',
    label: '',
    required: false,
    options: [],
    isFile: false,
    isComboBox: false,
    inEeoSection: false,
    ...overrides,
  };
}

describe('isEeoField', () => {
  it.each([
    ['Gender', true],
    ['Race / Ethnicity', true],
    ['Are you Hispanic or Latino?', true],
    ['Veteran Status', true],
    ['Disability Status', true],
    ['What are your preferred pronouns?', true],
    ['First Name', false],
    ['Email', false],
    ['Current company', false],
  ])('%s → %s', (label, expected) => {
    expect(isEeoField(label)).toBe(expected);
  });
});

describe('splitName', () => {
  it('splits first and the rest', () => {
    expect(splitName('Kris Tester')).toEqual({ first: 'Kris', last: 'Tester' });
    expect(splitName('Ada B. Lovelace')).toEqual({ first: 'Ada', last: 'B. Lovelace' });
    expect(splitName('Madonna')).toEqual({ first: 'Madonna', last: '' });
    expect(splitName('   ')).toEqual({ first: '', last: '' });
  });
});

describe('isUsable', () => {
  it.each([
    ['Yes', true],
    ['', false],
    ['   ', false],
    ['[NEEDS INPUT]', false],
    ['[NEEDS INPUT: salary]', false],
    [undefined, false],
    [null, false],
  ])('%s → %s', (value, expected) => {
    expect(isUsable(value)).toBe(expected);
  });
});

describe('mapField', () => {
  const ctx = (answers: Record<string, string> = {}, p = profile()) => ({ profile: p, answers });

  it('never maps an EEO field, even with a mappable label', () => {
    expect(mapField(field({ label: 'Gender' }), ctx())).toEqual({ kind: 'eeo' });
    // A field inside the EEO section is skipped regardless of its label.
    expect(mapField(field({ label: 'Email', inEeoSection: true }), ctx())).toEqual({ kind: 'eeo' });
  });

  it('maps resume and cover-letter file inputs, but not other file inputs', () => {
    const withNote = { ...ctx(), coverNote: 'Dear team, …' };
    expect(mapField(field({ isFile: true, label: 'Resume/CV' }), ctx())).toEqual({
      kind: 'file',
      source: 'resume',
    });
    expect(mapField(field({ isFile: true, label: 'Cover letter upload' }), withNote)).toEqual({
      kind: 'file',
      source: 'cover_letter',
    });
    expect(mapField(field({ isFile: true, label: 'Transcript' }), withNote)).toEqual({
      kind: 'unmapped',
    });
  });

  it('says why a cover letter is not attached: no note, or a gap still in it', () => {
    expect(mapField(field({ isFile: true, label: 'Cover letter' }), ctx())).toMatchObject({
      kind: 'needs_input',
      reason: 'no cover note yet; write one on the application page, then fill again',
    });
    const gap = { ...ctx(), coverNote: 'I admire [NEEDS INPUT: why Linear] and …' };
    expect(mapField(field({ isFile: true, label: 'Cover letter' }), gap)).toMatchObject({
      kind: 'needs_input',
      reason: expect.stringContaining('[NEEDS INPUT: why Linear]'),
    });
  });

  it('attaches a cover letter despite a gapped note when Kris provided one (input/cover-letter.pdf)', () => {
    const gap = {
      ...ctx(),
      coverNote: 'I admire [NEEDS INPUT: why Linear] and …',
      coverLetterAvailable: true,
    };
    expect(mapField(field({ isFile: true, label: 'Cover letter' }), gap)).toEqual({
      kind: 'file',
      source: 'cover_letter',
    });
    // A text box still needs the note itself; a provided PDF cannot fill it.
    expect(
      mapField(field({ tag: 'textarea', type: 'textarea', label: 'Cover letter' }), gap),
    ).toMatchObject({ kind: 'needs_input' });
  });

  it('leaves the apply-with-resume uploader empty and still maps the résumé field', () => {
    expect(
      mapField(field({ isFile: true, label: '', hint: 'apply-with-resume-container' }), ctx()),
    ).toEqual({ kind: 'unmapped' });
    expect(
      mapField(field({ isFile: true, label: '', hint: 'resume-upload Resume' }), ctx()),
    ).toEqual({ kind: 'file', source: 'resume' });
  });

  it('maps a Greenhouse resume whose visible label is only "Attach"', () => {
    // job-boards.greenhouse.io: the <label for> says "Attach"; the id is "resume".
    expect(mapField(field({ isFile: true, label: 'Attach', id: 'resume' }), ctx())).toEqual({
      kind: 'file',
      source: 'resume',
    });
    expect(
      mapField(field({ isFile: true, label: 'Attach', id: 'cover_letter' }), {
        ...ctx(),
        coverNote: 'Dear team, …',
      }),
    ).toEqual({ kind: 'file', source: 'cover_letter' });
  });

  it('maps a location field to the profile city, not a "based in" question', () => {
    expect(mapField(field({ label: 'Location (City)*' }), ctx())).toMatchObject({
      source: 'contact.location',
      value: 'Scottsdale, AZ',
    });
    expect(mapField(field({ label: 'Current location' }), ctx())).toMatchObject({
      source: 'contact.location',
    });
    // Real Greenhouse combobox label. The city must not win over the prepared answer.
    const relocated = mapField(
      field({
        label: 'Are you currently based in or willing to relocate to the Bay Area or Los Angeles?',
      }),
      ctx({ willing_to_relocate: 'No' }),
    );
    expect(relocated).not.toMatchObject({ source: 'contact.location' });
  });

  it('maps known profile fields by label', () => {
    expect(mapField(field({ label: 'First Name *' }), ctx())).toMatchObject({
      kind: 'value',
      via: 'profile',
      value: 'Kris',
    });
    expect(mapField(field({ label: 'Last Name' }), ctx())).toMatchObject({ value: 'Tester' });
    expect(mapField(field({ label: 'Full name' }), ctx())).toMatchObject({ value: 'Kris Tester' });
    expect(mapField(field({ label: 'Email' }), ctx())).toMatchObject({ value: 'kris@example.com' });
    expect(mapField(field({ label: 'LinkedIn URL' }), ctx())).toMatchObject({
      value: 'https://linkedin.com/in/kris',
    });
  });

  it('reports a profile field whose value is missing as needing input, not as open', () => {
    // No portfolio link in the profile: not a question for the drafting step.
    expect(mapField(field({ label: 'Portfolio' }), ctx())).toEqual({
      kind: 'needs_input',
      source: 'links.portfolio',
      reason: 'not in your profile (links.portfolio)',
    });
  });

  it('derives the country of residence, never citizenship or authorization', () => {
    expect(mapField(field({ label: 'What country are you based in?' }), ctx())).toMatchObject({
      source: 'contact.country',
      value: 'United States',
    });
    expect(mapField(field({ label: 'Country*' }), ctx())).toMatchObject({ value: 'United States' });
    expect(mapField(field({ label: 'Country of citizenship' }), ctx())).toEqual({
      kind: 'unmapped',
    });
    expect(
      mapField(field({ label: 'Which country are you authorized to work in?' }), ctx()),
    ).toEqual({ kind: 'unmapped' });
  });

  it('maps current company/title and education from the profile', () => {
    const p = profile({
      experience: [
        {
          id: 'a',
          company: 'Acme',
          title: 'Staff Engineer',
          start: '2024',
          end: 'Present',
          bullets: [],
        },
        { id: 'b', company: 'Initech', title: 'Engineer', start: '2020', end: '2024', bullets: [] },
      ],
      education: [{ id: 'e', school: 'State College', credential: 'Computer Science Coursework' }],
    });
    expect(mapField(field({ label: 'Current company' }), ctx({}, p))).toMatchObject({
      value: 'Acme',
    });
    expect(mapField(field({ label: 'Current title' }), ctx({}, p))).toMatchObject({
      value: 'Staff Engineer',
    });
    expect(mapField(field({ label: 'School' }), ctx({}, p))).toMatchObject({
      value: 'State College',
    });
    expect(mapField(field({ label: 'Discipline' }), ctx({}, p))).toMatchObject({
      value: 'Computer Science',
    });
    // Nothing current in the profile → needs input, not a guess.
    expect(mapField(field({ label: 'Current company' }), ctx())).toMatchObject({
      kind: 'needs_input',
    });
  });

  it('gives a GitHub username when the question asks for one', () => {
    expect(
      mapField(field({ label: 'GitHub', hint: 'Please provide your GitHub username' }), ctx()),
    ).toMatchObject({ value: 'kris' });
    expect(mapField(field({ label: 'GitHub' }), ctx())).toMatchObject({
      value: 'https://github.com/kris',
    });
  });

  it('puts the cover note in a cover-letter text box', () => {
    const c = { profile: profile(), answers: {}, coverNote: 'Dear team, …' };
    expect(
      mapField(field({ tag: 'textarea', type: 'textarea', label: 'Cover letter' }), c),
    ).toEqual({ kind: 'value', via: 'cover', source: 'cover_note', value: 'Dear team, …' });
    expect(
      mapField(field({ tag: 'textarea', type: 'textarea', label: 'Cover letter' }), {
        ...c,
        coverNote: '[NEEDS INPUT: why this role]',
      }),
    ).toMatchObject({
      kind: 'needs_input',
      reason: expect.stringContaining('[NEEDS INPUT: why this role]'),
    });
  });

  it('uses an answer saved for exactly this question, and never fuzzily for another', () => {
    const answers = {
      'Why do you want to work at Acme?': 'Because of the editor work.',
      'Are you currently located in the US?': '',
    };
    expect(mapField(field({ label: 'Why do you want to work at Acme?*' }), ctx(answers))).toEqual({
      kind: 'value',
      via: 'draft',
      source: 'Why do you want to work at Acme?',
      value: 'Because of the editor work.',
    });
    // A blank saved answer was already asked: needs input, not re-asked.
    expect(
      mapField(field({ label: 'Are you currently located in the US?' }), ctx(answers)),
    ).toMatchObject({ kind: 'needs_input' });
    // A similar question does not borrow it.
    expect(mapField(field({ label: 'Why do you want to work here?' }), ctx(answers))).toEqual({
      kind: 'unmapped',
    });
  });

  it('maps a radio by its group question, and never an EEO group', () => {
    const answers = { 'Which work arrangement do you prefer?': 'Remote' };
    expect(
      mapField(
        field({ type: 'radio', label: 'Hybrid', group: 'Which work arrangement do you prefer?' }),
        ctx(answers),
      ),
    ).toMatchObject({ kind: 'value', value: 'Remote' });
    expect(mapField(field({ type: 'radio', label: 'Female', group: 'Gender' }), ctx())).toEqual({
      kind: 'eeo',
    });
  });

  it('questionKey tidies the trailing required star and whitespace', () => {
    expect(questionKey('  Why  Discord?* ')).toBe('Why Discord?');
    expect(isStandardKey('work_authorization_us')).toBe(true);
    expect(isStandardKey('Why Discord?')).toBe(false);
  });

  it('matches a custom question to a prepared answer', () => {
    const answers = { work_authorization_us: 'Yes' };
    expect(
      mapField(field({ label: 'Are you authorized to work in the United States?' }), ctx(answers)),
    ).toMatchObject({
      kind: 'value',
      via: 'answer',
      source: 'work_authorization_us',
      value: 'Yes',
    });
  });

  it('does not fill an answer that is a NEEDS INPUT placeholder', () => {
    const answers = { salary_expectation: '[NEEDS INPUT]' };
    expect(mapField(field({ label: 'What are your salary expectations?' }), ctx(answers))).toEqual({
      kind: 'needs_input',
      source: 'salary_expectation',
      reason: '[NEEDS INPUT]',
    });
  });

  it('leaves an unrecognized question unmapped', () => {
    expect(mapField(field({ label: 'Describe your proudest project' }), ctx())).toEqual({
      kind: 'unmapped',
    });
  });
});

describe('matchAnswerKey', () => {
  const keys = [
    'work_authorization_us',
    'require_sponsorship',
    'willing_to_relocate',
    'salary_expectation',
    'how_did_you_hear',
  ];

  it.each([
    ['Will you now or in the future require sponsorship?', 'require_sponsorship'],
    ['Are you willing to relocate?', 'willing_to_relocate'],
    ['How did you hear about us?', 'how_did_you_hear'],
    ['What are your salary expectations?', 'salary_expectation'],
    ['Are you authorized to work in the United States?', 'work_authorization_us'],
  ])('%s → %s', (label, expected) => {
    expect(matchAnswerKey(label, keys)).toBe(expected);
  });

  it('returns undefined for an unrelated label', () => {
    expect(matchAnswerKey('Describe your proudest project', keys)).toBeUndefined();
  });

  it('does not treat a long essay that merely says "how did you" as how-did-you-hear', () => {
    const essay =
      'Tell me about a product you’ve worked on that served technical users. How did you identify their needs and measure success?';
    expect(matchAnswerKey(essay, keys)).toBeUndefined();
  });
});

describe('matchToggleOption', () => {
  const yesNo = [{ label: 'Yes' }, { label: 'No' }];
  const noYes = [{ label: 'No' }, { label: 'Yes' }];

  it('matches the exact label first', () => {
    expect(matchToggleOption(yesNo, 'no')?.label).toBe('No');
  });

  it('matches a longer answer by its leading Yes or No word', () => {
    expect(matchToggleOption(yesNo, 'Yes, to Denver, CO')?.label).toBe('Yes');
    expect(matchToggleOption(noYes, 'Yes, but not before May')?.label).toBe('Yes');
    expect(matchToggleOption(yesNo, 'No. I need sponsorship later')?.label).toBe('No');
  });

  it('does not read Yes or No out of other words', () => {
    expect(matchToggleOption(noYes, 'Not at this time')).toBeUndefined();
    expect(matchToggleOption(yesNo, 'Immediately')).toBeUndefined();
  });
});

describe('matchOption', () => {
  const opts = [
    { value: '', label: 'Please select' },
    { value: 'Yes', label: 'Yes' },
    { value: 'No', label: 'No' },
  ];

  it('matches by label/value, case-insensitively', () => {
    expect(matchOption(opts, 'Yes')).toBe('Yes');
    expect(matchOption(opts, 'no')).toBe('No');
  });

  it('never returns the empty placeholder and gives up on no match', () => {
    expect(matchOption(opts, 'Maybe')).toBeUndefined();
    expect(matchOption(opts, '')).toBeUndefined();
  });
});

describe('hiring-team note', () => {
  it('gets the profile summary as a draft even when the cover note has a gap', () => {
    const mapping = mapField(
      field({
        tag: 'textarea',
        type: 'textarea',
        label: 'Let the company know about your interest working there',
      }),
      { profile: profile(), answers: {}, coverNote: 'Dear team [NEEDS INPUT: why them]' },
    );
    expect(mapping).toEqual({
      kind: 'value',
      via: 'draft',
      source: 'profile.summary',
      value: 'Senior engineer.',
    });
  });
});

describe('working status with a company', () => {
  it('answers never-employed when no profile role is at that company', () => {
    const mapping = mapField(field({ label: "What's your working status with Canva?" }), {
      profile: profile(),
      answers: {},
    });
    expect(mapping).toMatchObject({ kind: 'value', value: 'Never employed or contracted' });
  });

  it('does not claim never-employed when a role is at that company', () => {
    const withRole = profile({
      experience: [
        {
          id: 'e1',
          company: 'Canva',
          title: 'Engineer',
          start: 'Jan 2020',
          end: 'Feb 2021',
          bullets: [],
        },
      ],
    });
    const mapping = mapField(field({ label: "What's your working status with Canva?" }), {
      profile: withRole,
      answers: {},
    });
    expect(mapping).not.toMatchObject({ value: 'Never employed or contracted' });
  });
});
