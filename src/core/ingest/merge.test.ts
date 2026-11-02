import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sha256 } from '../util/hash.js';
import {
  buildProfileDraft,
  checkProfileFiles,
  checkProfileSources,
  mergeProfileData,
} from './merge.js';
import { type IngestedProfileData, type SourceLocator, emptyIngestedProfileData } from './types.js';

let dir = '';
let resumeFile = '';
let positionsFile = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jobhacker-merge-'));
  resumeFile = join(dir, 'resume.pdf');
  positionsFile = join(dir, 'Positions.csv');
  writeFileSync(resumeFile, 'resume source', 'utf8');
  writeFileSync(positionsFile, 'linkedin source', 'utf8');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function locator(source: 'resume' | 'linkedin', file: string, at: string): SourceLocator {
  return { source, file, locator: at };
}

function fixtureData(): { resume: IngestedProfileData; linkedin: IngestedProfileData } {
  const resume = emptyIngestedProfileData();
  const linkedin = emptyIngestedProfileData();
  resume.inputs.push({ file: resumeFile, sha256: sha256('resume source') });
  linkedin.inputs.push({ file: positionsFile, sha256: sha256('linkedin source') });

  const resumeSource = locator('resume', resumeFile, 'page:1:line:1');
  const linkedInSource = locator('linkedin', positionsFile, 'Positions.csv:row:2:Title');
  resume.contact = {
    name: { value: 'Kris Tester', source: resumeSource },
    email: { value: 'kris@example.com', source: resumeSource },
    phone: { value: '+1 480-555-0100', source: resumeSource },
    location: { value: 'Scottsdale, AZ', source: resumeSource },
  };
  linkedin.contact = {
    name: { value: 'Kris Tester', source: linkedInSource },
    email: { value: 'kris@example.com', source: linkedInSource },
    location: { value: 'Scottsdale, AZ', source: linkedInSource },
  };
  resume.summary = { value: 'Senior engineer.', source: resumeSource };
  resume.skills.push({ text: 'TypeScript', source: resumeSource });
  linkedin.skills.push({ text: 'React', source: linkedInSource });
  resume.experience.push({
    company: { value: 'Acme', source: resumeSource },
    title: { value: 'Senior Engineer', source: resumeSource },
    start: { value: '2020-01', source: resumeSource },
    end: { value: '2024-01', source: resumeSource },
    location: { value: 'Remote', source: resumeSource },
    bullets: [{ text: 'Built a React design system.', source: resumeSource }],
  });
  linkedin.experience.push({
    company: { value: 'Acme', source: linkedInSource },
    title: { value: 'Staff Engineer', source: linkedInSource },
    start: { value: '2021-01', source: linkedInSource },
    end: { value: '2024-01', source: linkedInSource },
    location: { value: 'Remote', source: linkedInSource },
    bullets: [{ text: 'Reduced UI defects 30%.', source: linkedInSource }],
  });
  return { resume, linkedin };
}

describe('mergeProfileData', () => {
  it('keeps conflicting source variants visible and generates stable sourced bullet ids', () => {
    const { resume, linkedin } = fixtureData();
    const first = mergeProfileData(resume, linkedin);
    const second = mergeProfileData(resume, linkedin);

    expect(first.profile.experience).toHaveLength(1);
    expect(first.profile.experience[0]?.title).toContain(
      'resume says "Senior Engineer"; LinkedIn says "Staff Engineer"',
    );
    expect(first.profile.experience[0]?.start).toContain(
      'resume says "2020-01"; LinkedIn says "2021-01"',
    );
    expect(first.profile.experience[0]?.bullets.map((bullet) => bullet.text)).toEqual([
      'Built a React design system.',
      'Reduced UI defects 30%.',
    ]);
    expect(
      first.profile.experience[0]?.bullets.every((bullet) => bullet.sources?.length === 1),
    ).toBe(true);
    expect(first.profile.experience[0]?.bullets.map((bullet) => bullet.id)).toEqual(
      second.profile.experience[0]?.bullets.map((bullet) => bullet.id),
    );
    const resolvedLinkedIn = structuredClone(linkedin);
    resolvedLinkedIn.experience[0]!.title!.value = 'Senior Engineer';
    resolvedLinkedIn.experience[0]!.start!.value = '2020-01';
    const resolved = mergeProfileData(resume, resolvedLinkedIn);
    expect(resolved.profile.experience[0]?.id).toBe(first.profile.experience[0]?.id);
    expect(resolved.profile.experience[0]?.bullets.map((bullet) => bullet.id)).toEqual(
      first.profile.experience[0]?.bullets.map((bullet) => bullet.id),
    );
    expect(first.report.inputs).toHaveLength(2);
    expect(first.report.bullets).toHaveLength(2);

    const check = checkProfileSources(first.profile, first.report);
    expect(check.unsourcedBulletIds).toEqual([]);
    expect(check.paraphrasedBulletIds).toEqual([]);
    expect(check.unresolvedConflicts).toHaveLength(2);
    expect(check.ready).toBe(false);
  });

  it('rejects an attempted unsourced or paraphrased bullet', () => {
    const { resume, linkedin } = fixtureData();
    const merged = mergeProfileData(resume, linkedin);
    const profile = structuredClone(merged.profile);
    const experience = profile.experience[0];
    if (!experience) throw new Error('fixture missing experience');
    experience.title = 'Senior Engineer';
    experience.start = '2020-01';
    experience.bullets[0] = {
      ...experience.bullets[0]!,
      text: 'Invented a React design system for 99 teams.',
    };
    experience.bullets.push({
      id: 'unsourced',
      text: 'Added an unsourced claim.',
    });

    const check = checkProfileSources(profile, merged.report);
    expect(check.paraphrasedBulletIds).toEqual([experience.bullets[0]?.id]);
    expect(check.unsourcedBulletIds).toEqual(['unsourced']);
    expect(check.ready).toBe(false);
  });

  it('detects a missing or changed raw source file', () => {
    const { resume, linkedin } = fixtureData();
    const merged = mergeProfileData(resume, linkedin);
    writeFileSync(resumeFile, 'changed', 'utf8');
    rmSync(positionsFile);

    const check = checkProfileSources(merged.profile, merged.report);
    expect(check.inputErrors).toEqual([
      `${positionsFile}: source file missing`,
      `${resumeFile}: source file changed`,
    ]);
  });

  it('reports a missing optional LinkedIn member without blocking an otherwise-ready profile', () => {
    const { resume, linkedin } = fixtureData();
    linkedin.experience[0]!.title!.value = resume.experience[0]!.title!.value;
    linkedin.experience[0]!.start!.value = resume.experience[0]!.start!.value;
    const merged = mergeProfileData(resume, linkedin);
    merged.report.warnings.push('Projects.csv: file missing');
    const check = checkProfileSources(merged.profile, merged.report);
    expect(check.archiveWarnings).toEqual(['Projects.csv: file missing']);
    expect(check.ready).toBe(true);
  });

  it('normalizes equivalent phone, legal-suffix company, and date-precision variants', () => {
    const { resume, linkedin } = fixtureData();
    resume.contact.phone!.value = '480.555.0134';
    linkedin.contact.phone = {
      value: '+1 480-555-0134',
      source: locator('linkedin', positionsFile, 'PhoneNumbers.csv:row:2:Phone Number'),
    };
    resume.experience[0]!.company!.value = 'Northwind Resorts';
    linkedin.experience[0]!.company!.value = 'Northwind Resorts, Inc.';
    resume.experience[0]!.title!.value = 'Senior Engineer';
    linkedin.experience[0]!.title!.value = 'Senior Engineer';
    resume.experience[0]!.start!.value = '2025';
    linkedin.experience[0]!.start!.value = 'Nov 2025';

    const merged = mergeProfileData(resume, linkedin);
    expect(merged.profile.contact.phone).toBe('480.555.0134');
    expect(merged.profile.experience[0]?.company).toBe('Northwind Resorts');
    expect(merged.profile.experience[0]?.start).toBe('Nov 2025');
    expect(merged.profile.experience[0]?.company).not.toContain('NEEDS INPUT');
    expect(merged.profile.experience[0]?.start).not.toContain('NEEDS INPUT');
  });

  it('assigns ambiguous PDF claims only when one LinkedIn position has an exact match', () => {
    const { resume, linkedin } = fixtureData();
    const resumeSource = locator('resume', resumeFile, 'page:2:line:10');
    const marker = '[NEEDS INPUT: resolve conflict — assign resume claims from page 2]';
    resume.experience = [
      {
        company: { value: marker, source: resumeSource },
        title: { value: marker, source: resumeSource },
        start: { value: marker, source: resumeSource },
        end: { value: marker, source: resumeSource },
        bullets: [
          { text: 'Built the Acme design system.', source: resumeSource },
          { text: 'Built the Globex audio engine.', source: resumeSource },
        ],
      },
    ];
    const linkedInSource = locator('linkedin', positionsFile, 'Positions.csv:row:2:Description');
    linkedin.experience = [
      {
        company: { value: 'Acme', source: linkedInSource },
        title: { value: 'Senior Engineer', source: linkedInSource },
        start: { value: '2020', source: linkedInSource },
        end: { value: '2022', source: linkedInSource },
        bullets: [{ text: 'Built the Acme design system.', source: linkedInSource }],
      },
      {
        company: { value: 'Globex', source: linkedInSource },
        title: { value: 'Staff Engineer', source: linkedInSource },
        start: { value: '2022', source: linkedInSource },
        end: { value: '2024', source: linkedInSource },
        bullets: [{ text: 'Built the Globex audio engine.', source: linkedInSource }],
      },
    ];

    const merged = mergeProfileData(resume, linkedin);
    expect(merged.profile.experience).toHaveLength(2);
    expect(
      merged.profile.experience.some((experience) =>
        experience.company.includes('[NEEDS INPUT: resolve conflict'),
      ),
    ).toBe(false);
    expect(merged.profile.experience[0]?.bullets[0]?.sources).toHaveLength(2);
    expect(merged.profile.experience[1]?.bullets[0]?.sources).toHaveLength(2);
  });
});

describe('buildProfileDraft', () => {
  it('writes a sourced draft and report without overwriting profile.yaml', async () => {
    const inputDir = join(dir, 'input');
    const linkedinDir = join(inputDir, 'linkedin');
    const configDir = join(dir, 'config');
    mkdirSync(linkedinDir, { recursive: true });
    mkdirSync(configDir, { recursive: true });
    const resume = join(inputDir, 'resume.pdf');
    writeFileSync(
      resume,
      minimalPdf([
        'Kris Tester',
        'kris@example.com',
        '+1 480-555-0100',
        'Scottsdale, AZ',
        'SUMMARY',
        'Senior engineer.',
        'SKILLS',
        'TypeScript, React',
        'EXPERIENCE',
        'Acme | Senior Engineer | 2020-01 | 2024-01 | Remote',
        '- Built a React design system.',
      ]),
    );
    writeFileSync(
      join(linkedinDir, 'Profile.csv'),
      'First Name,Last Name,Email Address,Geo Location\nKris,Tester,kris@example.com,"Scottsdale, AZ"\n',
    );
    writeFileSync(
      join(linkedinDir, 'Positions.csv'),
      'Company Name,Title,Started On,Finished On,Location,Description\nAcme,Senior Engineer,2020-01,2024-01,Remote,Built a React design system.\n',
    );
    writeFileSync(join(linkedinDir, 'Skills.csv'), 'Name\nTypeScript\nReact\n');
    writeFileSync(join(linkedinDir, 'Projects.csv'), 'Title,Description,Url\n');
    writeFileSync(join(linkedinDir, 'Education.csv'), 'School Name,Degree Name\n');
    writeFileSync(join(linkedinDir, 'Recommendations_Received.csv'), 'First Name,Last Name,Text\n');
    writeFileSync(join(configDir, 'profile.yaml'), 'do-not-overwrite\n');

    const result = await buildProfileDraft({ inputDir, configDir });

    expect(readFileSync(join(configDir, 'profile.yaml'), 'utf8')).toBe('do-not-overwrite\n');
    expect(existsSync(result.profileFile)).toBe(true);
    expect(existsSync(result.sourceReportFile)).toBe(true);
    expect(result.profile.experience[0]?.bullets[0]?.sources).toHaveLength(2);
    expect(checkProfileFiles(result.profileFile, result.sourceReportFile)).toMatchObject({
      bulletCount: 1,
      unsourcedBulletIds: [],
      paraphrasedBulletIds: [],
      unresolvedConflicts: [],
      ready: true,
    });
    await expect(buildProfileDraft({ inputDir, configDir })).rejects.toThrow(
      'draft already exists',
    );
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
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}
