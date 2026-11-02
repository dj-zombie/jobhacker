import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ingestLinkedIn, parseCsv } from './linkedin.js';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jobhacker-linkedin-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, text: string): void {
  writeFileSync(join(dir, name), text, 'utf8');
}

describe('parseCsv', () => {
  it('handles quoted commas, escaped quotes and newlines', () => {
    const parsed = parseCsv('Name,Description\nKris,"Built one, then ""two""\nAcross lines"\n');
    expect(parsed.warnings).toEqual([]);
    expect(parsed.rows[0]?.cells.name?.value).toBe('Kris');
    expect(parsed.rows[0]?.cells.description?.value).toBe('Built one, then "two"\nAcross lines');
  });
});

describe('ingestLinkedIn', () => {
  it('parses a synthetic archive with renamed columns and warns for a missing member', () => {
    write(
      'Profile.csv',
      [
        'First Name,Last Name,Email Address,Geo Location,Summary,Public Profile URL,Websites',
        'Kris,Tester,kris@example.com,"Scottsdale, AZ","Senior engineer",https://linkedin.com/in/kris,https://github.com/kris',
      ].join('\n'),
    );
    write(
      'Positions.csv',
      [
        'Employer,Position Title,Date Started,Date Finished,Geo Location,Position Description',
        'Acme,Senior Engineer,2020-01,2024-01,Remote,"Built a React design system, used by 20 teams.\nReduced UI defects 30%."',
      ].join('\n'),
    );
    write('Skills.csv', 'Skill Name\nTypeScript\nReact\n');
    write(
      'Projects.csv',
      'Project Name,Project Description,Project URL\nSynth,"Built a C++ audio engine.",https://example.com/synth\n',
    );
    write('Education.csv', 'Institution,Credential,Date Started,Date Finished\nASU,BS,2000,2004\n');
    // Recommendations_Received.csv deliberately missing: LinkedIn exports vary.

    const data = ingestLinkedIn(dir);

    expect(data.contact).toMatchObject({
      name: { value: 'Kris Tester' },
      email: { value: 'kris@example.com' },
      location: { value: 'Scottsdale, AZ' },
    });
    expect(data.links).toMatchObject({
      linkedin: { value: 'https://linkedin.com/in/kris' },
      github: { value: 'https://github.com/kris' },
    });
    expect(data.experience).toHaveLength(1);
    expect(data.experience[0]).toMatchObject({
      company: { value: 'Acme' },
      title: { value: 'Senior Engineer' },
      start: { value: '2020-01' },
      end: { value: '2024-01' },
    });
    expect(data.experience[0]?.bullets.map((bullet) => bullet.text)).toEqual([
      'Built a React design system, used by 20 teams.',
      'Reduced UI defects 30%.',
    ]);
    expect(data.experience[0]?.bullets[0]?.source.locator).toContain(
      'Positions.csv:row:2:Position Description',
    );
    expect(data.skills.map((skill) => skill.text)).toEqual(['TypeScript', 'React']);
    expect(data.projects[0]?.bullets[0]?.text).toBe('Built a C++ audio engine.');
    expect(data.education[0]?.school?.value).toBe('ASU');
    expect(data.inputs).toHaveLength(5);
    expect(data.warnings).toContain('Recommendations_Received.csv: file missing');
  });

  it('keeps an incomplete position and reports missing fields instead of throwing', () => {
    write('Positions.csv', 'Description\nBuilt an internal tool.\n');
    const data = ingestLinkedIn(dir);
    expect(data.experience).toHaveLength(1);
    expect(data.experience[0]?.bullets[0]?.text).toBe('Built an internal tool.');
    expect(data.warnings).toContain('Positions.csv: row 2 is missing company');
    expect(data.warnings).toContain('Positions.csv: row 2 is missing title');
  });

  it('finds nested archive members and imports separate email/phone files', () => {
    const nested = join(dir, 'Complete_LinkedInDataExport');
    mkdirSync(nested);
    const profile = 'First Name,Last Name,Geo Location\nKris,Tester,"Scottsdale, AZ"\n';
    write('Profile.csv', profile);
    writeFileSync(join(nested, 'Profile.csv'), profile);
    writeFileSync(
      join(nested, 'Email Addresses.csv'),
      'Email Address,Confirmed\nkris@example.com,Yes\n',
    );
    writeFileSync(join(nested, 'PhoneNumbers.csv'), 'Phone Number,Extension\n+1 480-555-0100,\n');

    const data = ingestLinkedIn(dir);
    expect(data.contact.email?.value).toBe('kris@example.com');
    expect(data.contact.phone?.value).toBe('+1 480-555-0100');
    expect(data.inputs.map((input) => input.file)).toEqual([
      join(dir, 'Profile.csv'),
      join(nested, 'Email Addresses.csv'),
      join(nested, 'PhoneNumbers.csv'),
    ]);
    expect(data.warnings.some((warning) => warning.startsWith('Profile.csv: multiple'))).toBe(
      false,
    );
  });

  it('trims LinkedIn website-list brackets from extracted URLs', () => {
    write(
      'Profile.csv',
      'First Name,Last Name,Websites\nKris,Tester,"[PORTFOLIO:https://github.com/kris,PERSONAL:https://example.com]"\n',
    );
    const data = ingestLinkedIn(dir);
    expect(data.links.github?.value).toBe('https://github.com/kris');
    expect(data.links.portfolio?.value).toBe('https://example.com');
  });
});
