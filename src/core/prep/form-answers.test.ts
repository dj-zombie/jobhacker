import { describe, expect, it } from 'vitest';
import type { OpenQuestion } from '../apply/types.js';
import type { Profile } from '../config/schemas.js';
import { FakeLlm } from '../llm/fake.js';
import {
  draftFormAnswers,
  guidedQuestionKind,
  renderProfileForAnswers,
  storedAnswer,
} from './form-answers.js';

const PROFILE: Profile = {
  contact: { name: 'Kris Tester', email: 'k@example.com', phone: '555', location: 'Phoenix, AZ' },
  links: { github: 'https://github.com/kris' },
  summary: 'Frontend engineer with 20+ years building web apps.',
  skills: { frontend: ['React', 'TypeScript'] },
  experience: [
    {
      id: 'acme',
      company: 'Acme',
      title: 'Staff Engineer',
      start: '2020',
      end: 'Present',
      bullets: [
        { id: 'acme-1', text: 'Rebuilt the React design system used by 12 product teams.' },
      ],
    },
  ],
  projects: [],
  education: [],
  standard_answers: { work_authorization_us: 'Yes', require_sponsorship: 'No' },
};

const QUESTIONS: OpenQuestion[] = [
  {
    label: 'Are you located in the US?',
    hint: '',
    required: true,
    kind: 'choice',
    options: ['Yes', 'No'],
  },
  {
    label: 'Tell us about a project you led',
    hint: '',
    required: true,
    kind: 'textarea',
    options: [],
  },
  {
    label: 'Are you comfortable with a take-home?',
    hint: '',
    required: true,
    kind: 'choice',
    options: ['Yes', 'No'],
  },
  { label: 'X (Twitter) handle', hint: '', required: false, kind: 'text', options: [] },
];

const deps = (llm: FakeLlm) => ({
  llm,
  model: 'claude-sonnet-5-5',
  profile: PROFILE,
  preferences: 'Remote first.',
  jobText: 'Company: Initech\nTitle: Frontend Engineer\nWe use React and GraphQL.',
  coverNote: '',
});

const good = {
  answers: [
    { id: 0, answer: 'Yes', needs_input: null, source_ids: [] },
    {
      id: 1,
      answer: 'At Acme I rebuilt the React design system used by 12 product teams.',
      needs_input: null,
      source_ids: ['acme-1'],
    },
    { id: 2, answer: null, needs_input: 'whether you will do a take-home', source_ids: [] },
    { id: 3, answer: null, needs_input: null, source_ids: [] },
  ],
};

describe('draftFormAnswers', () => {
  it('returns grounded drafts in question order, with one call', async () => {
    const llm = new FakeLlm({ responses: { 'form-answers': good } });
    const res = await draftFormAnswers(deps(llm), QUESTIONS);

    expect(llm.callCount).toBe(1);
    expect(res.retried).toBe(false);
    expect(res.rejected).toBe(0);
    expect(res.answers.map(storedAnswer)).toEqual([
      'Yes',
      'At Acme I rebuilt the React design system used by 12 product teams.',
      '[NEEDS INPUT: whether you will do a take-home]',
      '',
    ]);
    expect(res.answers[1]?.sourceIds).toEqual(['acme-1']);
    expect(res.usage.calls).toBe(1);
  });

  it('sends the profile and questions but never the email or phone', async () => {
    const llm = new FakeLlm({ responses: { 'form-answers': good } });
    await draftFormAnswers(deps(llm), QUESTIONS);
    const user = llm.requests[0]?.user ?? '';
    expect(user).toContain('[acme-1] Rebuilt the React design system');
    expect(user).toContain('options: "Yes" | "No"');
    expect(user).toContain('Remote first.');
    expect(user).not.toContain('k@example.com');
    expect(user).not.toContain('555');
    expect(user).not.toContain("Kris's drafts and notes");
  });

  it('retries only the rejected drafts, then turns a repeat failure into NEEDS INPUT', async () => {
    const bad = {
      answers: [
        { id: 0, answer: 'Absolutely', needs_input: null, source_ids: [] },
        {
          id: 1,
          answer: 'I led a Vue migration that cut load time 40%.',
          needs_input: null,
          source_ids: ['acme-1'],
        },
        { id: 2, answer: null, needs_input: 'take-home preference', source_ids: [] },
        { id: 3, answer: null, needs_input: null, source_ids: [] },
      ],
    };
    // Second call fixes the choice but repeats the invented essay.
    const second = {
      answers: [
        { id: 0, answer: 'Yes', needs_input: null, source_ids: [] },
        { id: 1, answer: bad.answers[1]?.answer ?? '', needs_input: null, source_ids: ['acme-1'] },
      ],
    };
    let calls = 0;
    const llm = new FakeLlm({
      responder: () => {
        calls++;
        return calls === 1 ? bad : second;
      },
    });
    const res = await draftFormAnswers(deps(llm), QUESTIONS);

    expect(llm.callCount).toBe(2);
    expect(res.retried).toBe(true);
    expect(llm.requests[1]?.user).toContain('were rejected');
    expect(llm.requests[1]?.user).toContain('number "40" is not in the profile');
    expect(llm.requests[1]?.user).toContain('"Vue" is not in the profile or the posting');
    // Only the two rejected questions are re-asked.
    expect(llm.requests[1]?.user).not.toContain('X (Twitter) handle');
    expect(res.answers[0]?.answer).toBe('Yes');
    expect(res.answers[1]?.answer).toBeNull();
    expect(
      storedAnswer(res.answers[1] ?? { label: '', answer: null, needsInput: null, sourceIds: [] }),
    ).toMatch(/^\[NEEDS INPUT: the drafted answer was not grounded/);
    expect(res.rejected).toBe(1);
    // An untouched NEEDS INPUT answer from the first call survives the retry.
    expect(res.answers[2]?.needsInput).toBe('take-home preference');
  });

  it('rejects an essay with no or unknown source ids', async () => {
    const llm = new FakeLlm({
      responses: {
        'form-answers': {
          answers: [
            { id: 0, answer: 'Yes', needs_input: null, source_ids: [] },
            {
              id: 1,
              answer: 'I rebuilt the React design system.',
              needs_input: null,
              source_ids: ['nope'],
            },
            { id: 2, answer: null, needs_input: 'x', source_ids: [] },
            { id: 3, answer: null, needs_input: null, source_ids: [] },
          ],
        },
      },
    });
    const res = await draftFormAnswers(deps(llm), QUESTIONS);
    expect(llm.callCount).toBe(2);
    expect(res.answers[1]?.answer).toBeNull();
    expect(res.answers[1]?.needsInput).toMatch(/unknown source id "nope"/);
  });

  it('makes no call when there are no questions', async () => {
    const llm = new FakeLlm({ responses: {} });
    const res = await draftFormAnswers(deps(llm), []);
    expect(llm.callCount).toBe(0);
    expect(res.answers).toEqual([]);
  });

  it('rewrites his own draft: his words ground it, and an essay need not cite a bullet', async () => {
    const essay = QUESTIONS[1] as OpenQuestion;
    const llm = new FakeLlm({
      responses: {
        'form-answers': {
          answers: [
            {
              id: 0,
              answer:
                'The CLAP paper stood out because it lets a sampler find sounds from a sentence. That is the idea behind Tonegrid.',
              needs_input: null,
              source_ids: [],
            },
          ],
        },
      },
    });
    const res = await draftFormAnswers(
      deps(llm),
      [essay],
      new Map([
        [
          0,
          {
            draft: 'i liked the CLAP paper, find sounds by describing them, its what Tonegrid does',
            note: 'Two sentences. Sound excited.',
          },
        ],
      ]),
    );
    expect(llm.callCount).toBe(1);
    expect(res.rejected).toBe(0);
    expect(res.answers[0]?.answer).toContain('Tonegrid');
    const user = llm.requests[0]?.user ?? '';
    expect(user).toContain("Kris's draft:\ni liked the CLAP paper");
    expect(user).toContain("Kris's note: Two sentences. Sound excited.");
    expect(user).toContain("## Kris's drafts and notes");
  });

  it('still rejects a fact that is in neither his draft, his note, nor the profile', async () => {
    const essay = QUESTIONS[1] as OpenQuestion;
    const invented = {
      answers: [
        {
          id: 0,
          answer: 'I liked the CLAP paper and used it in a Vue app that cut load time 40%.',
          needs_input: null,
          source_ids: [],
        },
      ],
    };
    const llm = new FakeLlm({ responses: { 'form-answers': invented } });
    const res = await draftFormAnswers(
      deps(llm),
      [essay],
      new Map([[0, { draft: 'I liked the CLAP paper.' }]]),
    );
    expect(llm.callCount).toBe(2);
    expect(res.answers[0]?.answer).toBeNull();
    expect(res.answers[0]?.needsInput).toMatch(/"Vue" is not in the profile/);
    expect(res.answers[0]?.needsInput).toMatch(/number "40" is not in the profile/);
  });

  it('accepts a proper noun that the note names and the profile does not', async () => {
    const essay = QUESTIONS[1] as OpenQuestion;
    const llm = new FakeLlm({
      responses: {
        'form-answers': {
          answers: [
            {
              id: 0,
              answer:
                'At Acme I rebuilt the React design system used by 12 product teams, using Elizalde as the reference.',
              needs_input: null,
              source_ids: ['acme-1'],
            },
          ],
        },
      },
    });
    const res = await draftFormAnswers(
      deps(llm),
      [essay],
      new Map([[0, { note: 'Mention Elizalde. I am excited about the idea.' }]]),
    );
    expect(res.rejected).toBe(0);
    expect(res.answers[0]?.answer).toContain('Elizalde');
    expect(llm.requests[0]?.user).toContain("Kris's note: Mention Elizalde.");
  });

  it('uses the page he linked, keeps its numbers out, and does not invent one when the link cannot be read', async () => {
    const essay = QUESTIONS[1] as OpenQuestion;
    const page = {
      terms: 'Elizalde, Benjamin\nCLAP connects language and audio. We evaluated 16 tasks.',
      numbers: '2206.04769',
    };
    const note = 'Use https://arxiv.org/abs/2206.04769. I am excited about it.';
    const llm = new FakeLlm({
      responses: {
        'form-answers': {
          answers: [
            {
              id: 0,
              answer: "Elizalde, Benjamin's CLAP paper connects language and audio.",
              needs_input: null,
              source_ids: [],
            },
          ],
        },
      },
    });
    const linked = await draftFormAnswers(
      { ...deps(llm), readLink: async () => page },
      [essay],
      new Map([[0, { note }]]),
    );
    expect(linked.answers[0]?.answer).toContain('Elizalde');
    expect(llm.callCount).toBe(1);
    expect(llm.requests[0]?.user).toContain('Source page he linked:');

    const withMetric = new FakeLlm({
      responses: {
        'form-answers': {
          answers: [
            {
              id: 0,
              answer: 'Elizalde showed CLAP on 16 tasks.',
              needs_input: null,
              source_ids: [],
            },
          ],
        },
      },
    });
    const metric = await draftFormAnswers(
      { ...deps(withMetric), readLink: async () => page },
      [essay],
      new Map([[0, { note }]]),
    );
    expect(metric.answers[0]?.answer).toBeNull();
    expect(metric.answers[0]?.needsInput).toMatch(/number "16" is not in the profile/);

    const unread = new FakeLlm({ responses: { 'form-answers': { answers: [] } } });
    const missing = await draftFormAnswers(
      { ...deps(unread), readLink: async () => null },
      [essay],
      new Map([[0, { note: 'https://example.com/paper and I am excited about it.' }]]),
    );
    expect(unread.callCount).toBe(0);
    expect(missing.answers[0]?.needsInput).toBe('could not read https://example.com/paper');

    const local = new FakeLlm({ responses: {} });
    const blocked = await draftFormAnswers(
      deps(local),
      [essay],
      new Map([[0, { note: 'https://127.0.0.1/secret' }]]),
    );
    expect(local.callCount).toBe(0);
    expect(blocked.answers[0]?.needsInput).toBe('that link is not a public page');
  });
});

describe('guidedQuestionKind', () => {
  it('treats a long or essay-shaped question as a textarea', () => {
    expect(guidedQuestionKind('Share your favorite paper. In two sentences, say why.')).toBe(
      'textarea',
    );
    expect(guidedQuestionKind('Why this role?')).toBe('textarea');
    expect(guidedQuestionKind('GitHub username')).toBe('text');
  });

  it('keeps a short answer short, including yes or no on a long question', () => {
    const warp = 'If hired by Warp, will you be based in the U.S. or Canada?';
    expect(guidedQuestionKind(warp, 'Yes')).toBe('text');
    expect(guidedQuestionKind(warp, 'No')).toBe('text');
    expect(guidedQuestionKind('Why this role?', 'Yes')).toBe('text');
    expect(
      guidedQuestionKind(
        'What is your notice period if you accepted an offer tomorrow morning?',
        'Two weeks',
      ),
    ).toBe('text');
  });

  it('treats a question that opens as yes or no as one line', () => {
    expect(guidedQuestionKind('If hired by Warp, will you be based in the U.S. or Canada?')).toBe(
      'text',
    );
    expect(guidedQuestionKind('Are you authorized to work in the United States?')).toBe('text');
    expect(
      guidedQuestionKind('Why this role?', 'I want to work on the sampler because it fits'),
    ).toBe('textarea');
  });
});

describe('renderProfileForAnswers', () => {
  it('lists experience with bullet ids and says when education is missing', () => {
    const text = renderProfileForAnswers(PROFILE);
    expect(text).toContain('Staff Engineer — Acme (2020–Present)');
    expect(text).toContain('[acme-1]');
    expect(text).toContain('Education:\n(none listed)');
    expect(text).not.toContain('k@example.com');
  });
});
