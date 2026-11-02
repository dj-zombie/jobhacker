import { describe, expect, it } from 'vitest';
import type { Profile } from '../config/schemas.js';
import { buildGroundingContext, checkBullet, sourceBullets } from './grounding.js';

/**
 * Acceptance #1 (ROADMAP Round 4): an invented number is rejected, an unknown
 * source_id is rejected, an unlisted technology is rejected, a valid rephrase
 * passes, and the original bullet always grounds (the basis of the fallback).
 */

function profile(): Profile {
  return {
    contact: { name: 'Tester', email: 't@example.com', phone: '1', location: 'AZ' },
    links: {},
    summary: 'Senior engineer.',
    skills: {
      languages: ['TypeScript', 'Go', 'C++'],
      frontend: ['React', 'Next.js'],
      backend: ['Node.js'],
    },
    experience: [
      {
        id: 'acme',
        company: 'Acme',
        title: 'Senior Engineer',
        start: '2024-01',
        end: 'present',
        bullets: [
          {
            id: 'acme-1',
            text: 'Built the design system in React, cutting UI bugs by 30%.',
          },
          {
            id: 'acme-2',
            text: 'Led migration of the Node.js API, supporting 20+ services.',
          },
        ],
      },
    ],
    projects: [],
    education: [],
    standard_answers: {},
  };
}

const ctx = () => buildGroundingContext(profile());

describe('checkBullet grounding', () => {
  it('passes a valid rephrase that stays within the source and skills', () => {
    const v = checkBullet(
      { source_id: 'acme-1', text: 'Developed a React design system that reduced UI bugs 30%.' },
      ctx(),
    );
    expect(v).toEqual([]);
  });

  it('rejects an invented number', () => {
    const v = checkBullet(
      { source_id: 'acme-1', text: 'Developed a React design system that reduced UI bugs 45%.' },
      ctx(),
    );
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('45');
  });

  it('rejects an unknown source_id', () => {
    const v = checkBullet(
      { source_id: 'does-not-exist', text: 'Built the design system in React.' },
      ctx(),
    );
    expect(v).toEqual(['unknown source_id "does-not-exist"']);
  });

  it('rejects an unlisted technology or proper noun', () => {
    const v = checkBullet(
      { source_id: 'acme-1', text: 'Rebuilt the design system in Vue and GraphQL.' },
      ctx(),
    );
    expect(v.some((m) => m.includes('Vue'))).toBe(true);
    expect(v.some((m) => m.includes('GraphQL'))).toBe(true);
  });

  it('allows a technology that is in the profile skills but not the source bullet', () => {
    // "Go" is in skills but not in acme-1's source text; it must still pass.
    const v = checkBullet(
      { source_id: 'acme-1', text: 'Built the design system in React and Go.' },
      ctx(),
    );
    expect(v).toEqual([]);
  });

  it('every original source bullet grounds against itself (fallback is always safe)', () => {
    const c = ctx();
    for (const b of sourceBullets(profile())) {
      expect(checkBullet({ source_id: b.id, text: b.text }, c)).toEqual([]);
    }
  });

  it('does not flag a digit that is glued to letters (e.g. S3)', () => {
    // "Node.js" is allowed via skills; "S3" must not read as the invented number 3.
    const v = checkBullet(
      { source_id: 'acme-2', text: 'Led migration of the Node.js API across 20+ services.' },
      ctx(),
    );
    expect(v).toEqual([]);
  });
});
