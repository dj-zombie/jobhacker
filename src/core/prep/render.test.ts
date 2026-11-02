import { describe, expect, it } from 'vitest';
import type { Profile } from '../config/schemas.js';
import { escapeHtml, renderResumeHtml } from './render.js';
import type { TailoredResultBullet } from './tailor.js';

function profile(): Profile {
  return {
    contact: {
      name: 'Kris <Dev>',
      email: 'kris@example.com',
      phone: '+1 555 555 5555',
      location: 'Scottsdale, AZ',
    },
    links: { github: 'https://github.com/kris' },
    summary: 'Senior frontend engineer.',
    skills: { frontend: ['React', 'Next.js'] },
    experience: [
      {
        id: 'acme',
        company: 'Acme',
        title: 'Senior Engineer',
        start: '2024-01',
        end: 'present',
        bullets: [
          { id: 'acme-1', text: 'Built the design system.' },
          { id: 'acme-2', text: 'Unused source bullet.' },
        ],
      },
      {
        id: 'old',
        company: 'OldCo',
        title: 'Engineer',
        start: '2020-01',
        end: '2024-01',
        bullets: [{ id: 'old-1', text: 'Never selected.' }],
      },
    ],
    projects: [],
    education: [],
    standard_answers: {},
  };
}

function bullet(sourceId: string, text: string): TailoredResultBullet {
  return { sourceId, text, grounded: true, violations: [] };
}

describe('renderResumeHtml', () => {
  it('renders the selected bullets under their experience and omits unused entries', () => {
    const html = renderResumeHtml({
      profile: profile(),
      bullets: [bullet('acme-1', 'Shipped the design system.')],
    });
    expect(html).toContain('Senior Engineer — Acme');
    expect(html).toContain('Shipped the design system.');
    // Unused source bullet text and the entirely-unselected OldCo entry are absent.
    expect(html).not.toContain('Unused source bullet.');
    expect(html).not.toContain('OldCo');
    // Skills are present.
    expect(html).toContain('React, Next.js');
  });

  it('escapes HTML in profile and bullet text', () => {
    const html = renderResumeHtml({
      profile: profile(),
      bullets: [bullet('acme-1', 'Fixed <script>alert(1)</script> bug.')],
    });
    expect(html).toContain('Kris &lt;Dev&gt;');
    expect(html).toContain('<title>Kris &lt;Dev&gt; — Resume</title>');
    expect(html).toContain('Fixed &lt;script&gt;alert(1)&lt;/script&gt; bug.');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<title>Kris <Dev>');
  });

  it('is a complete HTML document', () => {
    const html = renderResumeHtml({ profile: profile(), bullets: [bullet('acme-1', 'x')] });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('</html>');
  });
});

describe('escapeHtml', () => {
  it('escapes the five dangerous characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});
