import { describe, expect, it } from 'vitest';
import type { Profile } from '../config/schemas.js';
import { prepareAnswers } from './answers.js';

function profile(): Profile {
  return {
    contact: { name: 'Kris', email: 't@example.com', phone: '1', location: 'AZ' },
    links: {},
    summary: 'Senior engineer.',
    skills: { frontend: ['React'] },
    experience: [],
    projects: [],
    education: [],
    standard_answers: {
      work_authorization_us: 'Yes',
      salary_expectation: '[NEEDS INPUT]',
    },
  };
}

describe('prepareAnswers', () => {
  it('returns verbatim answers with a human label and flags NEEDS INPUT placeholders', () => {
    const answers = prepareAnswers(profile());
    expect(answers).toEqual([
      {
        key: 'work_authorization_us',
        question: 'Work authorization us',
        answer: 'Yes',
        needsInput: false,
      },
      {
        key: 'salary_expectation',
        question: 'Salary expectation',
        answer: '[NEEDS INPUT]',
        needsInput: true,
      },
    ]);
  });

  it('returns an empty list when there are no standard answers', () => {
    const p = profile();
    p.standard_answers = {};
    expect(prepareAnswers(p)).toEqual([]);
  });
});
