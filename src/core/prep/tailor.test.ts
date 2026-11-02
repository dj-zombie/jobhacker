import { describe, expect, it } from 'vitest';
import type { Profile } from '../config/schemas.js';
import { FakeLlm } from '../llm/fake.js';
import { tailorBullets } from './tailor.js';

const MODEL = 'claude-sonnet-5-5';
const ACME_1 = 'Built the design system in React, cutting UI bugs by 30%.';

function profile(): Profile {
  return {
    contact: { name: 'Tester', email: 't@example.com', phone: '1', location: 'AZ' },
    links: {},
    summary: 'Senior engineer.',
    skills: { frontend: ['React'], languages: ['TypeScript'] },
    experience: [
      {
        id: 'acme',
        company: 'Acme',
        title: 'Senior Engineer',
        start: '2024-01',
        end: 'present',
        bullets: [{ id: 'acme-1', text: ACME_1 }],
      },
    ],
    projects: [],
    education: [],
    standard_answers: {},
  };
}

function deps(llm: FakeLlm) {
  return { llm, model: MODEL, profile: profile(), jobText: 'Frontend role at Globex.' };
}

describe('tailorBullets', () => {
  it('returns grounded bullets without a retry when the model stays grounded', async () => {
    const llm = new FakeLlm({
      responder: () => ({
        bullets: [{ source_id: 'acme-1', text: 'Shipped a React design system.' }],
      }),
    });
    const res = await tailorBullets(deps(llm));
    expect(llm.callCount).toBe(1);
    expect(res.retried).toBe(false);
    expect(res.fellBack).toBe(0);
    expect(res.bullets).toEqual([
      {
        sourceId: 'acme-1',
        text: 'Shipped a React design system.',
        grounded: true,
        violations: [],
      },
    ]);
  });

  it('retries once and then falls back to the original bullet when grounding keeps failing', async () => {
    // An invented number ("45%") never grounds against the source ("30%").
    const llm = new FakeLlm({
      responder: () => ({ bullets: [{ source_id: 'acme-1', text: 'Cut UI bugs by 45%.' }] }),
    });
    const res = await tailorBullets(deps(llm));
    expect(llm.callCount).toBe(2); // one retry
    expect(res.retried).toBe(true);
    expect(res.fellBack).toBe(1);
    expect(res.bullets[0]?.grounded).toBe(false);
    expect(res.bullets[0]?.text).toBe(ACME_1); // fell back to the source text
    expect(res.bullets[0]?.violations[0]).toContain('45');
  });

  it('recovers when the single retry returns grounded output', async () => {
    let call = 0;
    const llm = new FakeLlm({
      responder: () => {
        call += 1;
        return call === 1
          ? { bullets: [{ source_id: 'acme-1', text: 'Cut UI bugs by 45%.' }] }
          : { bullets: [{ source_id: 'acme-1', text: 'Cut UI bugs by 30%.' }] };
      },
    });
    const res = await tailorBullets(deps(llm));
    expect(llm.callCount).toBe(2);
    expect(res.retried).toBe(true);
    expect(res.fellBack).toBe(0);
    expect(res.bullets[0]).toEqual({
      sourceId: 'acme-1',
      text: 'Cut UI bugs by 30%.',
      grounded: true,
      violations: [],
    });
  });

  it('drops an unknown source_id and falls back to the source bullets when nothing is usable', async () => {
    const llm = new FakeLlm({
      responder: () => ({ bullets: [{ source_id: 'ghost', text: 'Invented work.' }] }),
    });
    const res = await tailorBullets(deps(llm));
    expect(res.bullets).toEqual([
      { sourceId: 'acme-1', text: ACME_1, grounded: false, violations: [] },
    ]);
  });
});
