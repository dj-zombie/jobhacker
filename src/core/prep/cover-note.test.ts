import { describe, expect, it } from 'vitest';
import type { Profile } from '../config/schemas.js';
import { FakeLlm } from '../llm/fake.js';
import { writeCoverNote } from './cover-note.js';

const MODEL = 'claude-sonnet-5-5';

function profile(): Profile {
  return {
    contact: { name: 'Kris', email: 't@example.com', phone: '1', location: 'Scottsdale, AZ' },
    links: {},
    summary: 'Senior engineer with 20 years of experience shipping React apps.',
    skills: { frontend: ['React'] },
    experience: [
      {
        id: 'acme',
        company: 'Acme',
        title: 'Lead Frontend Engineer',
        start: '2023-01',
        end: 'present',
        bullets: [{ id: 'acme-1', text: 'Cut dashboard load time by 42% for 2 million users.' }],
      },
    ],
    projects: [],
    education: [],
    standard_answers: {},
  };
}

function deps(llm: FakeLlm) {
  return {
    llm,
    model: MODEL,
    profile: profile(),
    company: 'Globex',
    jobText: 'Frontend role at Globex building design tools.',
    preferences: 'I want product engineering at tools companies.',
  };
}

describe('writeCoverNote', () => {
  it('keeps a grounded, finished letter', async () => {
    const text = 'Dear Globex team, I bring 20 years of React experience.';
    const llm = new FakeLlm({ responder: () => ({ text }) });
    const res = await writeCoverNote(deps(llm));
    expect(llm.callCount).toBe(1);
    expect(res.grounded).toBe(true);
    expect(res.text).toBe(text);
  });

  it('sends the full profile bullets and preferences to the model', async () => {
    const llm = new FakeLlm({ responder: () => ({ text: 'Dear Globex team, …' }) });
    await writeCoverNote(deps(llm));
    const user = llm.requests[0]?.user ?? '';
    expect(user).toContain('Cut dashboard load time by 42%');
    expect(user).toContain('product engineering at tools companies');
  });

  it('a NEEDS INPUT marker is a violation: retry, then a complete fallback with no marker', async () => {
    const llm = new FakeLlm({
      responder: () => ({ text: 'I bring 20 years. [NEEDS INPUT: why Globex]' }),
    });
    const res = await writeCoverNote(deps(llm));
    expect(llm.callCount).toBe(2);
    expect(res.retried).toBe(true);
    expect(res.grounded).toBe(false);
    expect(res.text).not.toContain('[NEEDS INPUT');
    expect(res.text).toContain('Globex');
    expect(res.text).toContain('Kris');
    // The fallback cites his own bullet verbatim rather than inventing one.
    expect(res.text).toContain('Cut dashboard load time by 42%');
  });

  it('retries once and falls back to a complete letter when a number is invented', async () => {
    // "35" is not anywhere in the profile → not grounded.
    const llm = new FakeLlm({ responder: () => ({ text: 'I have 35 years of experience.' }) });
    const res = await writeCoverNote(deps(llm));
    expect(llm.callCount).toBe(2);
    expect(res.retried).toBe(true);
    expect(res.grounded).toBe(false);
    expect(res.text).not.toContain('[NEEDS INPUT');
    expect(res.text).toContain('Globex');
  });

  it('recovers when the retry returns a grounded, finished letter', async () => {
    let call = 0;
    const llm = new FakeLlm({
      responder: () => {
        call += 1;
        return call === 1
          ? { text: 'I have 35 years. [NEEDS INPUT: why]' }
          : { text: 'I have 20 years of React and cut load time by 42%.' };
      },
    });
    const res = await writeCoverNote(deps(llm));
    expect(llm.callCount).toBe(2);
    expect(res.grounded).toBe(true);
    expect(res.text).toBe('I have 20 years of React and cut load time by 42%.');
  });
});
