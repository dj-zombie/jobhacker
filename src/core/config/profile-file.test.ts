import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { fixedClock } from '../util/clock.js';
import { ConfigError } from './errors.js';
import { commitProfileEdit, planProfileSection, saveProfileSection } from './profile-file.js';
import { type SectionInputs, toSectionInputs } from './profile-sections.js';
import { profileSchema } from './schemas.js';

const EXAMPLE = join(import.meta.dirname, '../../../config/profile.example.yaml');

let dir: string;
let backupDir: string;
const clock = fixedClock('2026-11-04T08:05:12.000Z');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jh-profile-'));
  backupDir = join(dir, 'backups');
  copyFileSync(EXAMPLE, join(dir, 'profile.yaml'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const file = () => join(dir, 'profile.yaml');
const text = () => readFileSync(file(), 'utf8');
const sha = () => createHash('sha256').update(readFileSync(file())).digest('hex');
const backups = () => {
  try {
    return readdirSync(backupDir);
  } catch {
    return [];
  }
};
const stored = () => toSectionInputs(profileSchema.parse(parse(text())));
const save = <S extends keyof SectionInputs>(section: S, value: SectionInputs[S]) =>
  saveProfileSection(dir, section, value, { clock, backupDir });

/** Every `# …` comment in the file, in order. */
const comments = (t: string) => t.split('\n').flatMap((line) => line.match(/#.*$/)?.[0] ?? []);

/** Lines only in `a`, and lines only in `b`, compared as multisets. */
function lineDiff(a: string, b: string): { out: string[]; in: string[] } {
  const count = (t: string) => {
    const m = new Map<string, number>();
    for (const l of t.split('\n')) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const ca = count(a);
  const cb = count(b);
  const only = (x: Map<string, number>, y: Map<string, number>) =>
    [...x].flatMap(([l, n]) => Array(Math.max(0, n - (y.get(l) ?? 0))).fill(l) as string[]);
  return { out: only(ca, cb), in: only(cb, ca) };
}

function refusal(run: () => unknown): string[] {
  try {
    run();
  } catch (err) {
    if (err instanceof ConfigError) return err.issues;
    throw err;
  }
  throw new Error('expected a ConfigError');
}

describe('saveProfileSection', () => {
  it('changes one line for an edited links.github and keeps every comment', () => {
    const before = text();
    const result = save('links', { ...stored().links, github: 'https://github.com/kris-tester' });
    expect(result.changed).toBe(true);
    const diff = lineDiff(before, text());
    expect(diff).toEqual({
      out: ['  github: https://github.com/you'],
      in: ['  github: https://github.com/kris-tester'],
    });
    expect(comments(text())).toEqual(comments(before));
  });

  it('refuses an invalid email with contact.email and leaves the file unchanged', () => {
    const before = sha();
    const issues = refusal(() => save('contact', { ...stored().contact, email: 'not-an-email' }));
    expect(issues).toEqual([
      'contact.email: must be an email address or a visible [NEEDS INPUT: …] marker',
    ]);
    expect(sha()).toBe(before);
    expect(backups()).toEqual([]);
  });

  it('refuses a duplicate bullet id', () => {
    const before = sha();
    const experience = stored().experience;
    const entry = experience[0];
    if (!entry) throw new Error('fixture has an experience entry');
    entry.bullets = [...entry.bullets, { id: 'company-a-1', text: 'Another' }];
    const issues = refusal(() => save('experience', experience));
    expect(issues).toEqual([
      'experience: duplicate bullet id "company-a-1" (bullet ids must be unique)',
    ]);
    expect(sha()).toBe(before);
  });

  it('gives a new bullet the next free id', () => {
    const experience = stored().experience;
    experience[0]?.bullets.push({ text: 'Shipped the thing' });
    const result = save('experience', experience);
    const saved = result.saved as SectionInputs['experience'];
    expect(saved[0]?.bullets.map((b) => b.id)).toEqual([
      'company-a-1',
      'company-a-2',
      'company-a-3',
    ]);
    expect(text()).toContain('      - id: company-a-3\n        text: Shipped the thing\n');
  });

  it('skips past every id the profile already uses, projects included', () => {
    const experience = stored().experience;
    experience.push({
      id: 'project',
      company: 'Project',
      title: 'Lead',
      start: '2020-01',
      end: '2021-01',
      location: '',
      bullets: [{ text: 'New one' }],
    });
    const result = save('experience', experience);
    const saved = result.saved as SectionInputs['experience'];
    // `project-a-1` belongs to projects; a new entry `project` starts its own numbering.
    expect(saved[1]?.bullets[0]?.id).toBe('project-1');
  });

  it('gives a new entry an id from its company name', () => {
    const experience = stored().experience;
    experience.push({
      company: 'Company A',
      title: 'Engineer',
      start: '2019',
      end: '2020',
      location: '',
      bullets: [{ text: 'First' }],
    });
    const saved = save('experience', experience).saved as SectionInputs['experience'];
    expect(saved.map((e) => e.id)).toEqual(['company-a', 'company-a-2']);
    expect(saved[1]?.bullets[0]?.id).toBe('company-a-2-1');
    const written = (parse(text()) as { experience: { start: unknown }[] }).experience[1];
    expect(written?.start).toBe('2019');
  });

  it('writes a backup after a write and none after a no-op save', () => {
    save('summary', stored().summary);
    expect(backups()).toEqual([]);
    const before = text();
    const result = save('summary', 'A new summary, all true.\n');
    expect(backups()).toEqual(['profile-2026-11-04T080512Z.yaml']);
    expect(readFileSync(join(backupDir, 'profile-2026-11-04T080512Z.yaml'), 'utf8')).toBe(before);
    expect(result.backup).toBe(join(backupDir, 'profile-2026-11-04T080512Z.yaml'));
    save('summary', 'A second summary.\n');
    expect(backups()).toEqual([
      'profile-2026-11-04T080512Z-2.yaml',
      'profile-2026-11-04T080512Z.yaml',
    ]);
  });

  it('leaves the sha256 the same when nothing changed, for every section', () => {
    const before = sha();
    const current = stored();
    for (const section of Object.keys(current) as (keyof SectionInputs)[]) {
      const result = saveProfileSection(dir, section, current[section], { clock, backupDir });
      expect(result.changed, section).toBe(false);
    }
    expect(sha()).toBe(before);
    expect(backups()).toEqual([]);
  });

  it('keeps every bullet id, and its sources, when one bullet is reworded', () => {
    const experience = stored().experience;
    const bullet = experience[0]?.bullets[0];
    if (!bullet) throw new Error('fixture has a bullet');
    bullet.text = 'Built X using Y, which reduced Z by 10%';
    const result = save('experience', experience);
    expect(result.profile.experience[0]?.bullets.map((b) => b.id)).toEqual([
      'company-a-1',
      'company-a-2',
    ]);
    expect(result.profile.experience[0]?.bullets[0]?.sources).toEqual([
      { source: 'resume', file: 'input/resume.pdf', locator: 'page:1:line:12' },
    ]);
    expect(result.profile.projects[0]?.bullets[0]?.id).toBe('project-a-1');
  });

  it('renames, adds and removes standard answers, keeping the other lines and comments', () => {
    const before = text();
    const renamed = stored().standard_answers.map((a) =>
      a.key === 'how_did_you_hear' ? { ...a, key: 'heard_about_us' } : a,
    );
    save('standard_answers', renamed);
    expect(lineDiff(before, text())).toEqual({
      out: ['  how_did_you_hear: "Company careers page"'],
      in: ['  heard_about_us: "Company careers page"'],
    });

    const afterRename = text();
    const answers = stored().standard_answers.filter((a) => a.key !== 'earliest_start_date');
    answers.push({ key: 'notice_period', value: 'Two weeks' });
    save('standard_answers', answers);
    expect(lineDiff(afterRename, text())).toEqual({
      out: ['  earliest_start_date: "Two weeks from offer"'],
      in: ['  notice_period: Two weeks'],
    });
    expect(comments(text())).toEqual(comments(before));
  });

  it('refuses a blank or repeated answer name without echoing the value', () => {
    const answers = stored().standard_answers;
    answers.push({ key: ' ', value: 'secret-ish' }, { key: 'require_sponsorship', value: 'x' });
    const issues = refusal(() => save('standard_answers', answers));
    expect(issues).toEqual([
      'standard_answers.7.key: give this answer a name',
      'standard_answers.8.key: the same name as answer 2. Names must be unique',
    ]);
    expect(issues.join('\n')).not.toContain('secret-ish');
  });

  it('writes a self-ID value as typed and sets it back to decline', () => {
    const before = text();
    const self = stored().self_identification;
    save('self_identification', { ...self, veteran_status: 'SENTINEL value' });
    expect(text()).toContain('  veteran_status: SENTINEL value\n');
    save('self_identification', { ...self, veteran_status: 'decline' });
    expect(text()).toBe(before);
  });

  it('never puts a self-ID value in a refusal', () => {
    const self = stored().self_identification;
    const issues = refusal(() =>
      save('self_identification', {
        ...self,
        gender: '',
        overrides: [{ key: '', value: 'SENTINEL override' }],
      }),
    );
    expect(issues).toEqual(['self_identification.overrides.0.key: give this override a name']);
    const blank = refusal(() => save('self_identification', { ...self, gender: '' }));
    expect(blank).toEqual(["self_identification.gender: can't be blank"]);
  });

  it('refuses input in the wrong shape, with the section in the path', () => {
    const issues = refusal(() =>
      saveProfileSection(dir, 'links', { github: 3 }, { clock, backupDir }),
    );
    expect(issues[0]).toMatch(/^links\./);
  });

  it('refuses when the file changed after the edit was planned', () => {
    const edit = planProfileSection(dir, 'summary', 'Planned.\n');
    const byHand = `${text()}# edited by hand\n`;
    writeFileSync(file(), byHand);
    const issues = refusal(() => commitProfileEdit(edit, { clock, backupDir }));
    expect(issues[0]).toMatch(/changed on disk/);
    expect(text()).toBe(byHand);
    expect(backups()).toEqual([]);
  });
});
