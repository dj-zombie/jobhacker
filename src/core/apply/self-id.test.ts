import { describe, expect, it } from 'vitest';
import type { Profile } from '../config/schemas.js';
import {
  configuredSelfIdValue,
  isDeclineOption,
  pickSelfIdOption,
  selfIdCategory,
} from './self-id.js';

function profile(selfId?: Profile['self_identification']): Profile {
  return {
    contact: { name: 'Kris Tester', email: 'k@example.com', phone: '555', location: 'Phoenix, AZ' },
    links: {},
    summary: 'Engineer.',
    skills: {},
    experience: [],
    projects: [],
    education: [],
    standard_answers: {},
    ...(selfId ? { self_identification: selfId } : {}),
  };
}

describe('selfIdCategory', () => {
  it.each([
    ['Gender', 'gender'],
    ['What are your pronouns?', null],
    ['Race / Ethnicity', 'race_ethnicity'],
    ['Are you Hispanic or Latino?', 'race_ethnicity'],
    ['Veteran Status', 'veteran_status'],
    ['Disability Status', 'disability_status'],
    ['Current company', null],
  ] as const)('%s → %s', (label, expected) => {
    expect(selfIdCategory(label)).toBe(expected);
  });
});

describe('configuredSelfIdValue', () => {
  it('defaults to decline when no block is configured', () => {
    expect(configuredSelfIdValue(profile(), 'Gender')).toBe('decline');
    expect(configuredSelfIdValue(profile(), 'Veteran Status')).toBe('decline');
  });

  it('pronouns come only from overrides.pronouns, never from the gender value', () => {
    const p = profile({
      gender: 'Man',
      race_ethnicity: 'decline',
      veteran_status: 'decline',
      disability_status: 'decline',
      overrides: { pronouns: 'He/Him' },
    });
    expect(configuredSelfIdValue(p, 'What are your preferred Pronouns?')).toBe('He/Him');
    expect(configuredSelfIdValue(profile(), 'What are your preferred Pronouns?')).toBe('decline');
  });

  it('returns the configured value verbatim, with overrides winning', () => {
    const p = profile({
      gender: 'decline',
      race_ethnicity: 'decline',
      veteran_status: 'decline',
      disability_status: 'decline',
      overrides: { disability_status: 'No, I do not have a disability' },
    });
    expect(configuredSelfIdValue(p, 'Disability Status')).toBe('No, I do not have a disability');
    expect(configuredSelfIdValue(p, 'Gender')).toBe('decline');
  });
});

describe('pickSelfIdOption', () => {
  it('decline selects only a real decline option', () => {
    expect(pickSelfIdOption(['Male', 'Female', 'Decline to self identify'], 'decline')).toBe(
      'Decline to self identify',
    );
    expect(pickSelfIdOption(['Male', 'Female'], 'decline')).toBeUndefined();
    expect(isDeclineOption("I don't wish to answer")).toBe(true);
    expect(isDeclineOption('Prefer not to say')).toBe(true);
  });

  it('decline never selects a substantive answer', () => {
    // "No, I do not have a disability" is a disclosure, not a decline.
    expect(
      pickSelfIdOption(['Yes, I have a disability', 'No, I do not have a disability'], 'decline'),
    ).toBeUndefined();
    expect(pickSelfIdOption(['I am a veteran', 'I am not a veteran'], 'decline')).toBeUndefined();
  });

  it('Man matches a Male option and Woman a Female option (same answer, other wording)', () => {
    expect(pickSelfIdOption(['Male', 'Female', 'Non-binary'], 'Man')).toBe('Male');
    expect(pickSelfIdOption(['Man', 'Woman'], 'Female')).toBe('Woman');
  });

  it('a configured answer matches its option exactly, then by overlap', () => {
    expect(pickSelfIdOption(['Man', 'Woman', 'Non-binary'], 'Woman')).toBe('Woman');
    expect(
      pickSelfIdOption(['I am not a protected veteran', 'Other'], 'not a protected veteran'),
    ).toBe('I am not a protected veteran');
    expect(pickSelfIdOption(['Man', 'Woman'], 'Martian')).toBeUndefined();
  });
});
