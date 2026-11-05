import { describe, expect, it } from 'vitest';
import { costBasisLabel, splitIssues, usd } from './settings-format.js';

describe('splitIssues', () => {
  it('puts an issue under the field it names, and the rest on the section', () => {
    expect(
      splitIssues('experience', [
        'experience.0.start: must be a year or year-month',
        "experience.1.bullets.2.text: can't be blank",
        'experience: duplicate bullet id "company-a-1" (bullet ids must be unique)',
        '(root): profile.yaml changed on disk since this page loaded.',
      ]),
    ).toEqual({
      fields: {
        'experience.0.start': 'must be a year or year-month',
        'experience.1.bullets.2.text': "can't be blank",
      },
      section: [
        'experience: duplicate bullet id "company-a-1" (bullet ids must be unique)',
        '(root): profile.yaml changed on disk since this page loaded.',
      ],
    });
  });

  it('keeps an issue with no path, and a skills item path, on the section', () => {
    expect(
      splitIssues('skills', ['skills.0.group: give this group a name', 'skills.languages.1: x']),
    ).toEqual({
      fields: { 'skills.0.group': 'give this group a name' },
      section: ['skills.languages.1: x'],
    });
    expect(
      splitIssues('preferences', ['file is empty. Describe the roles you want in prose.']),
    ).toEqual({
      fields: {},
      section: ['file is empty. Describe the roles you want in prose.'],
    });
  });
});

describe('cost wording', () => {
  it('formats a cost and its basis', () => {
    expect(usd(16.62)).toBe('$16.62');
    expect(usd(0.004)).toBe('under $0.01');
    expect(usd(0)).toBe('$0.00');
    expect(
      costBasisLabel({ month: '2026-11', thisMonth: true, calls: 1108, perScoreUsd: 0.015 }),
    ).toBe("November's mean of $0.015 a score, over 1,108 scoring calls");
    expect(costBasisLabel({ month: '2026-09', thisMonth: false, calls: 1, perScoreUsd: 0.2 })).toBe(
      "September 2026's mean of $0.20 a score, over 1 scoring call. No job has been scored this month yet",
    );
    expect(costBasisLabel(null)).toBeNull();
  });
});
