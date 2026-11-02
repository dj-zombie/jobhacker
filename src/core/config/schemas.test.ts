import { describe, expect, it } from 'vitest';
import { companiesSchema, profileSchema, weightsSchema } from './schemas.js';

const baseProfile = {
  contact: { name: 'Kris', email: 'k@example.com', phone: '+1', location: 'Scottsdale, AZ' },
  summary: 'A senior engineer.',
  skills: { languages: ['TypeScript'] },
  experience: [
    {
      id: 'a',
      company: 'Acme',
      title: 'Engineer',
      start: '2020',
      end: 'present',
      bullets: [{ id: 'a-1', text: 'Did a thing' }],
    },
  ],
};

describe('profileSchema', () => {
  it('accepts a minimal valid profile', () => {
    expect(profileSchema.safeParse(baseProfile).success).toBe(true);
  });

  it('rejects duplicate bullet ids across experience and projects', () => {
    const bad = {
      ...baseProfile,
      projects: [{ id: 'p', name: 'P', bullets: [{ id: 'a-1', text: 'dup' }] }],
    };
    const result = profileSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('duplicate bullet id'))).toBe(true);
    }
  });

  it('rejects an invalid contact email', () => {
    const bad = { ...baseProfile, contact: { ...baseProfile.contact, email: 'nope' } };
    expect(profileSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts a visible missing-email marker in a draft profile', () => {
    const draft = {
      ...baseProfile,
      contact: { ...baseProfile.contact, email: '[NEEDS INPUT: contact.email]' },
    };
    expect(profileSchema.safeParse(draft).success).toBe(true);
  });

  it('accepts strict machine-checkable bullet provenance', () => {
    const sourced = {
      ...baseProfile,
      experience: [
        {
          ...baseProfile.experience[0]!,
          bullets: [
            {
              ...baseProfile.experience[0]!.bullets[0],
              sources: [
                {
                  source: 'resume',
                  file: 'input/resume.pdf',
                  locator: 'page:1:line:4',
                },
              ],
            },
          ],
        },
      ],
    };
    expect(profileSchema.safeParse(sourced).success).toBe(true);
  });
});

describe('companiesSchema', () => {
  it('rejects duplicate ats+token boards', () => {
    const result = companiesSchema.safeParse({
      companies: [
        { name: 'A', ats: 'greenhouse', token: 'x' },
        { name: 'B', ats: 'greenhouse', token: 'x' },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('duplicate board'))).toBe(true);
    }
  });

  it('rejects an unknown ats value', () => {
    const result = companiesSchema.safeParse({
      companies: [{ name: 'A', ats: 'taleo', token: 'x' }],
    });
    expect(result.success).toBe(false);
  });

  it('defaults active to true and tags to []', () => {
    const result = companiesSchema.safeParse({
      companies: [{ name: 'A', ats: 'lever', token: 'x' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.companies[0]?.active).toBe(true);
      expect(result.data.companies[0]?.tags).toEqual([]);
    }
  });
});

describe('weightsSchema', () => {
  const weights = {
    role_fit: 3,
    tech_fit: 2,
    domain_interest: 2,
    seniority_fit: 2,
    logistics_fit: 4,
    comp_fit: 1,
  };

  it('accepts integer weights with at least one positive value', () => {
    expect(weightsSchema.safeParse(weights).success).toBe(true);
  });

  it('rejects fractional and all-zero weights', () => {
    expect(weightsSchema.safeParse({ ...weights, role_fit: 1.5 }).success).toBe(false);
    expect(
      weightsSchema.safeParse(Object.fromEntries(Object.keys(weights).map((key) => [key, 0])))
        .success,
    ).toBe(false);
  });
});
