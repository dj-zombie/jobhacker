import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ingestResume, parseResumeText } from './resume.js';

const RESUME = `Kris Tester
kris@example.com
+1 480-555-0100
Scottsdale, AZ
https://linkedin.com/in/kris
https://github.com/kris

SUMMARY
Senior frontend-focused full-stack engineer.

SKILLS
TypeScript, React, Node.js, C++

EXPERIENCE
Acme | Senior Engineer | 2020-01 | 2024-01 | Remote
- Built a React design system used by 20 teams.
- Reduced UI defects 30%.

PROJECTS
Synth | https://example.com/synth
- Built a C++ audio engine.

EDUCATION
ASU | BS Computer Science | 2000 | 2004
`;

describe('resume ingestion', () => {
  it('parses a synthetic resume without paraphrasing claims', () => {
    const data = parseResumeText('/private/input/resume.pdf', RESUME);
    expect(data.contact).toMatchObject({
      name: { value: 'Kris Tester' },
      email: { value: 'kris@example.com' },
      phone: { value: '+1 480-555-0100' },
      location: { value: 'Scottsdale, AZ' },
    });
    expect(data.summary?.value).toBe('Senior frontend-focused full-stack engineer.');
    expect(data.skills.map((skill) => skill.text)).toEqual([
      'TypeScript',
      'React',
      'Node.js',
      'C++',
    ]);
    expect(data.experience[0]).toMatchObject({
      company: { value: 'Acme' },
      title: { value: 'Senior Engineer' },
      start: { value: '2020-01' },
      end: { value: '2024-01' },
      location: { value: 'Remote' },
    });
    expect(data.experience[0]?.bullets.map((bullet) => bullet.text)).toEqual([
      'Built a React design system used by 20 teams.',
      'Reduced UI defects 30%.',
    ]);
    expect(data.experience[0]?.bullets[0]?.source).toEqual({
      source: 'resume',
      file: '/private/input/resume.pdf',
      locator: 'line:13',
    });
    expect(data.projects[0]?.bullets[0]?.text).toBe('Built a C++ audio engine.');
    expect(data.education[0]?.school?.value).toBe('ASU');
  });

  it('parses common multi-line company/title/date layouts', () => {
    const data = parseResumeText(
      '/private/input/resume.docx',
      `Kris Tester
EXPERIENCE
Acme
Senior Engineer | Jan 2020 – Present
- Built the design system.
Globex
Staff Engineer
Feb 2018 – Dec 2019
• Built the audio engine.`,
    );
    expect(data.experience).toHaveLength(2);
    expect(data.experience[0]).toMatchObject({
      company: { value: 'Acme' },
      title: { value: 'Senior Engineer' },
      start: { value: 'Jan 2020' },
      end: { value: 'Present' },
    });
    expect(data.experience[1]).toMatchObject({
      company: { value: 'Globex' },
      title: { value: 'Staff Engineer' },
      start: { value: 'Feb 2018' },
      end: { value: 'Dec 2019' },
    });
    expect(data.experience[1]?.bullets[0]?.text).toBe('Built the audio engine.');
  });

  it('parses the real DOCX-style tabbed company/date/title sequence', () => {
    const data = parseResumeText(
      '/private/input/resume.docx',
      `Kris Tester\tScottsdale, AZ
SENIOR FRONTEND ENGINEER\t480.555.0100
kris@example.com
— PROFILE
Senior frontend engineer.
— SKILLS & TOOLING
LANGUAGES  TypeScript  ·  JavaScript  ·  C++
— EXPERIENCE
Acme LLC · Phoenix, AZ\t2020 — PRESENT
Senior Engineer
Owned frontend architecture.
Migrated from a monolith to microservices.
Built a React design system.
Globex\t2018 — 2020
Staff Engineer
Built the audio engine.
— EDUCATION
Desert Mesa College\tComputer Science Coursework
— BEYOND THE KEYBOARD
Electronic music production`,
    );

    expect(data.contact.name?.value).toBe('Kris Tester');
    expect(data.contact.location?.value).toBe('Scottsdale, AZ');
    expect(data.summary?.value).toBe('Senior frontend engineer.');
    expect(data.experience).toHaveLength(2);
    expect(data.experience[0]).toMatchObject({
      company: { value: 'Acme LLC' },
      title: { value: 'Senior Engineer' },
      start: { value: '2020' },
      end: { value: 'PRESENT' },
      location: { value: 'Phoenix, AZ' },
    });
    expect(data.experience[0]?.bullets.map((bullet) => bullet.text)).toEqual([
      'Owned frontend architecture.',
      'Migrated from a monolith to microservices.',
      'Built a React design system.',
    ]);
    expect(data.experience[1]?.bullets.map((bullet) => bullet.text)).toEqual([
      'Built the audio engine.',
    ]);
    expect(data.education).toEqual([
      expect.objectContaining({
        school: expect.objectContaining({ value: 'Desert Mesa College' }),
        credential: expect.objectContaining({ value: 'Computer Science Coursework' }),
      }),
    ]);
  });

  it('parses letter-spaced PDF headings, bare profile links, and trailing bullet separators', () => {
    const data = parseResumeText(
      '/private/input/resume.pdf',
      `Kris TesterS E N I O R F R O N T E N D E N G I N E E R
Scottsdale, AZ
480.555.0100
kris@example.com
linkedin.com/in/kris
github.com/kris
P R O F I L E
Senior frontend engineer.
S K I L L S & T O O L I N G
LANGUAGES TypeScript JavaScript C++
E X P E R I E N C E
Acme LLC · Phoenix, AZ 2020 — PRESENT
Senior Engineer
Owned frontend architecture.
•
Built a React design system.
•
E D U C A T I O N
ASU Computer Science Coursework
Desert Mesa College Computer Science Coursework
B E Y O N D T H E K E Y B O A R D
Electronic music production`,
    );

    expect(data.links).toMatchObject({
      linkedin: { value: 'https://linkedin.com/in/kris' },
      github: { value: 'https://github.com/kris' },
    });
    expect(data.contact.name?.value).toBe('Kris Tester');
    expect(data.summary?.value).toBe('Senior frontend engineer.');
    expect(data.skills.length).toBeGreaterThan(0);
    expect(data.experience).toHaveLength(1);
    expect(data.experience[0]).toMatchObject({
      company: { value: 'Acme LLC' },
      title: { value: 'Senior Engineer' },
      start: { value: '2020' },
      end: { value: 'PRESENT' },
      location: { value: 'Phoenix, AZ' },
    });
    expect(data.experience[0]?.bullets.map((bullet) => bullet.text)).toEqual([
      'Owned frontend architecture.',
      'Built a React design system.',
    ]);
    expect(data.education).toEqual([
      expect.objectContaining({
        school: expect.objectContaining({ value: 'ASU' }),
        credential: expect.objectContaining({ value: 'Computer Science Coursework' }),
      }),
      expect.objectContaining({
        school: expect.objectContaining({ value: 'Desert Mesa College' }),
        credential: expect.objectContaining({ value: 'Computer Science Coursework' }),
      }),
    ]);
    expect(data.warnings).toContain(
      'resume other section: 1 line(s) were not mapped to profile fields',
    );
  });

  it('reports a missing resume cleanly', async () => {
    await expect(ingestResume('/definitely/missing/resume.pdf')).rejects.toThrow(
      'resume file not found',
    );
  });

  it('extracts text from a real synthetic PDF through pdf-parse', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jobhacker-resume-pdf-'));
    const file = join(dir, 'resume.pdf');
    writeFileSync(
      file,
      minimalPdf(['Kris Tester', 'kris@example.com', 'SUMMARY', 'Senior engineer.']),
    );
    try {
      const data = await ingestResume(file);
      expect(data.contact.name?.value).toBe('Kris Tester');
      expect(data.contact.email?.value).toBe('kris@example.com');
      expect(data.summary?.value).toContain('Senior engineer.');
      expect(data.inputs[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('extracts text from a DOCX through mammoth', async () => {
    const require = createRequire(import.meta.url);
    const mammothEntry = require.resolve('mammoth');
    const fixture = resolve(dirname(mammothEntry), '../test/test-data/single-paragraph.docx');
    const data = await ingestResume(fixture);
    expect(data.inputs[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(data.contact.name?.value).toBeTruthy();
  });

  it('rejects unsupported resume types before parsing', async () => {
    await expect(ingestResume(import.meta.filename)).rejects.toThrow('unsupported resume type');
  });
});

function minimalPdf(textLines: string[]): Buffer {
  const textCommands = textLines.flatMap((line, index) => [
    ...(index > 0 ? ['0 -18 Td'] : []),
    `(${line.replace(/[()\\]/g, '\\$&')}) Tj`,
  ]);
  const stream = ['BT', '/F1 12 Tf', '72 720 Td', ...textCommands, 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}
