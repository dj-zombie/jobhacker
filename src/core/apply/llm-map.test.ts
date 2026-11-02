import { describe, expect, it } from 'vitest';
import type { Profile } from '../config/schemas.js';
import { FakeLlm } from '../llm/fake.js';
import { acceptMappings, mapFormFields, mappingBasis, questionsForMapping } from './llm-map.js';
import { configuredSelfIdValue, pickSelfIdOption } from './self-id.js';
import type { RawFormField } from './types.js';

const PROFILE: Profile = {
  contact: { name: 'Kris Tester', email: 'k@example.com', phone: '555', location: 'Phoenix, AZ' },
  links: {},
  summary: 'Frontend engineer with 20 years building web apps.',
  skills: { frontend: ['React'] },
  experience: [],
  projects: [],
  education: [],
  standard_answers: { work_authorization_us: 'Yes' },
};

function field(overrides: Partial<RawFormField> = {}): RawFormField {
  return {
    selector: '#q',
    tag: 'input',
    type: 'text',
    name: null,
    id: 'q',
    label: 'Question',
    required: false,
    options: [],
    isFile: false,
    isComboBox: false,
    inEeoSection: false,
    ...overrides,
  };
}

describe('questionsForMapping', () => {
  it('drops EEO, file, and checkbox fields and groups radios', () => {
    const questions = questionsForMapping([
      field({ selector: '#gender', label: 'Gender' }),
      field({ selector: '#resume', label: 'Resume', isFile: true, type: 'file' }),
      field({ selector: '#agree', label: 'I agree', type: 'checkbox' }),
      field({
        selector: '#yes',
        label: 'Yes',
        type: 'radio',
        name: 'auth',
        group: 'Work authorization',
      }),
      field({
        selector: '#no',
        label: 'No',
        type: 'radio',
        name: 'auth',
        group: 'Work authorization',
      }),
      field({ selector: '#why', tag: 'textarea', type: 'textarea', label: 'Why this role?' }),
    ]);
    expect(questions.map((q) => q.label)).toEqual(['Work authorization', 'Why this role?']);
    expect(questions[0]?.options).toEqual(['Yes', 'No']);
    expect(questions[0]?.selector).toBe('#yes');
  });
});

describe('acceptMappings', () => {
  const questions = questionsForMapping([
    field({
      selector: '#auth',
      tag: 'select',
      type: 'select',
      label: 'Are you authorized to work in the US?',
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
    }),
    field({ selector: '#years', label: 'Years of experience' }),
    field({ selector: '#why', tag: 'textarea', type: 'textarea', label: 'Why us?' }),
  ]);
  const basis = mappingBasis(PROFILE, {}, '');

  it('keeps an option and a grounded number, and outlines prose', () => {
    const { mappings, kept, dropped } = acceptMappings(
      questions,
      {
        mappings: [
          { id: 0, value: 'Yes', confidence: 'high', source: 'work_authorization_us' },
          { id: 1, value: '20', confidence: 'high', source: 'profile' },
          { id: 2, value: 'I build web apps.', confidence: 'high', source: 'profile' },
          { id: 9, value: 'Nope', confidence: 'high', source: 'profile' },
        ],
      },
      basis,
    );
    expect(mappings.get('#auth')).toMatchObject({ kind: 'value', via: 'answer', value: 'Yes' });
    expect(mappings.get('#years')).toMatchObject({ kind: 'value', via: 'profile', value: '20' });
    expect(mappings.get('#why')).toMatchObject({ kind: 'value', via: 'draft' });
    expect(kept).toBe(3);
    expect(dropped).toBe(1);
  });

  it('drops a link that is not already in the profile', () => {
    const site = questionsForMapping([field({ selector: '#fb', label: 'Facebook' })]);
    const invented = acceptMappings(
      site,
      {
        mappings: [
          {
            id: 0,
            value: 'https://facebook.com/made-up',
            confidence: 'high',
            source: 'profile',
          },
        ],
      },
      basis,
    );
    expect(invented.mappings.size).toBe(0);
    expect(invented.dropped).toBe(1);
    const listed = acceptMappings(
      site,
      {
        mappings: [
          {
            id: 0,
            value: 'https://linkedin.com/in/kris',
            confidence: 'high',
            source: 'profile',
          },
        ],
      },
      'https://linkedin.com/in/kris',
    );
    expect(listed.mappings.get('#fb')).toMatchObject({
      kind: 'value',
      value: 'https://linkedin.com/in/kris',
    });
  });

  it('drops a choice that is not an option and a number that is not in the profile', () => {
    const { mappings, dropped } = acceptMappings(
      questions,
      {
        mappings: [
          { id: 0, value: 'Sometimes', confidence: 'high', source: 'profile' },
          { id: 1, value: '15', confidence: 'low', source: 'profile' },
        ],
      },
      basis,
    );
    expect(mappings.size).toBe(0);
    expect(dropped).toBe(2);
  });
});

describe('mapFormFields', () => {
  it('retries a bad shape once and then keeps the grounded rows', async () => {
    const llm = new FakeLlm({
      responder: (_request, attempt) => {
        if (attempt === 1) return { mappings: 'nope' };
        return {
          mappings: [{ id: 0, value: 'Yes', confidence: 'low', source: 'work_authorization_us' }],
        };
      },
    });
    const result = await mapFormFields(
      {
        llm,
        model: 'test',
        profile: PROFILE,
        preferences: '',
        answers: {},
        jobText: 'Senior Frontend Engineer at Example',
      },
      [
        field({
          selector: '#auth',
          tag: 'select',
          type: 'select',
          label: 'Work authorization',
          options: [
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
          ],
        }),
      ],
    );
    expect(llm.attempts).toBe(2);
    expect(result.kept).toBe(1);
    expect(result.mappings.get('#auth')).toMatchObject({ via: 'draft', value: 'Yes' });
  });
});

describe('self-identification exclusion (invariant 7, D66)', () => {
  it('the serialized LLM prompt never contains a self-identification field', async () => {
    const llm = new FakeLlm({ responder: () => ({ mappings: [] }) });
    await mapFormFields(
      {
        llm,
        model: 'test',
        profile: PROFILE,
        preferences: '',
        answers: {},
        jobText: 'Engineer at Example',
      },
      [
        field({ selector: '#gender', label: 'Gender' }),
        field({ selector: '#race', label: 'Race / Ethnicity' }),
        field({
          selector: '#eeo-email',
          label: 'Email inside EEO section',
          inEeoSection: true,
        }),
        field({ selector: '#why', tag: 'textarea', type: 'textarea', label: 'Why us?' }),
      ],
    );
    expect(llm.requests).toHaveLength(1);
    const serialized = JSON.stringify(llm.requests[0]);
    expect(serialized).not.toMatch(/Gender|Race \/ Ethnicity|EEO section/);
    expect(serialized).toMatch(/Why us\?/);
  });

  it('every value the self-id filler writes is configured or a decline option', () => {
    // The inverse-property guard replacing "EEO is never written": see
    // self-id.test.ts (decline selects only a decline option; a configured
    // answer selects only its own option).
    expect(configuredSelfIdValue(PROFILE, 'Gender')).toBe('decline');
    expect(pickSelfIdOption(['Male', 'Decline to self identify'], 'decline')).toBe(
      'Decline to self identify',
    );
  });
});

describe('vague authorization guard', () => {
  it('never sends an unnamed-country working-rights question to the model', () => {
    const questions = questionsForMapping([
      field({
        selector: '#rights',
        label: "Do you have working rights in the country you're applying to?",
      }),
      field({ selector: '#auth', label: 'Are you authorized to work in the United States?' }),
    ]);
    expect(questions.map((q) => q.selector)).toEqual(['#auth']);
  });

  it('does not map entry-editor fields', () => {
    const questions = questionsForMapping([
      field({ selector: '#title', label: 'Title', inEntryEditor: true }),
    ]);
    expect(questions).toEqual([]);
  });
});
