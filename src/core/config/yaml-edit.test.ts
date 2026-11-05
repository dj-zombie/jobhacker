import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { editYamlText } from './yaml-edit.js';

/** Lines that differ, as `-old` and `+new`, in order. Assumes the edit kept the line count. */
function changedLines(before: string, after: string): string[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    const nextA = a.indexOf(b[j] ?? '\u0000', i);
    const nextB = b.indexOf(a[i] ?? '\u0000', j);
    if (nextB !== -1 && (nextA === -1 || nextB - j <= nextA - i)) {
      while (j < nextB) out.push(`+${b[j++]}`);
    } else if (nextA !== -1) {
      while (i < nextA) out.push(`-${a[i++]}`);
    } else {
      if (i < a.length) out.push(`-${a[i++]}`);
      if (j < b.length) out.push(`+${b[j++]}`);
    }
  }
  return out;
}

const LONG = 'x'.repeat(150);
const FILE = `# top comment
contact:
  name: Kris Tester
  email: kris@example.com   # aligned comment
links:
  github: https://github.com/kris-tester
summary: >
  Folded summary line.
skills:
  languages: [TypeScript, Go]
experience:
  - id: fabrikam
    company: Fabrikam
    title: Engineer
    start: "2021-03"
    end: present
    bullets:
      - id: fabrikam-1
        text: ${LONG}
      - id: fabrikam-2
        text: Second bullet
education: []
standard_answers:
  work_authorization_us: "Yes"   # quoted
  how_did_you_hear: Company careers page
`;

interface Fixture {
  contact: Record<string, string>;
  links: Record<string, string>;
  summary: string;
  skills: Record<string, string[]>;
  experience: { id: string; bullets: { id: string; text: string }[] }[];
  education: unknown[];
  standard_answers: Record<string, string>;
  self_identification?: Record<string, string>;
}

function edit(change: (v: Fixture) => void): { out: string; diff: string[] } {
  const value = parse(FILE) as Fixture;
  change(value);
  const out = editYamlText(FILE, value);
  if (out === null) throw new Error('edit returned null');
  expect(parse(out)).toEqual(value);
  return { out, diff: changedLines(FILE, out) };
}

describe('editYamlText', () => {
  it('changes one scalar on its own line and keeps the comment after it', () => {
    const { diff } = edit((v) => {
      v.contact.email = 'tester@example.com';
    });
    expect(diff).toEqual([
      '-  email: kris@example.com   # aligned comment',
      '+  email: tester@example.com   # aligned comment',
    ]);
  });

  it('keeps double quotes on a quoted scalar', () => {
    const { diff } = edit((v) => {
      v.standard_answers.work_authorization_us = 'No';
    });
    expect(diff).toEqual([
      '-  work_authorization_us: "Yes"   # quoted',
      '+  work_authorization_us: "No"   # quoted',
    ]);
  });

  it('renames a key in place', () => {
    const { diff } = edit((v) => {
      const answers = v.standard_answers;
      v.standard_answers = {
        work_authorization_us: answers.work_authorization_us ?? '',
        heard_from: answers.how_did_you_hear ?? '',
      };
    });
    expect(diff).toEqual([
      '-  how_did_you_hear: Company careers page',
      '+  heard_from: Company careers page',
    ]);
  });

  it('appends a new key after the last one', () => {
    const { diff } = edit((v) => {
      v.standard_answers.salary_expectation = '[NEEDS INPUT]';
    });
    expect(diff).toEqual(['+  salary_expectation: "[NEEDS INPUT]"']);
  });

  it('removes a key with its line', () => {
    const { diff } = edit((v) => {
      v.standard_answers = { work_authorization_us: 'Yes' };
    });
    expect(diff).toEqual(['-  how_did_you_hear: Company careers page']);
  });

  it('appends a bullet without touching the long line above it', () => {
    const { diff } = edit((v) => {
      v.experience[0]?.bullets.push({ id: 'fabrikam-3', text: 'Third' });
    });
    expect(diff).toEqual(['+      - id: fabrikam-3', '+        text: Third']);
  });

  it('removes a bullet by id', () => {
    const { diff } = edit((v) => {
      const entry = v.experience[0];
      const second = entry?.bullets[1];
      if (entry && second) entry.bullets = [second];
    });
    expect(diff).toEqual(['-      - id: fabrikam-1', `-        text: ${LONG}`]);
  });

  it('rewrites a flow list on its one line', () => {
    const { diff } = edit((v) => {
      v.skills.languages = ['TypeScript', 'Go', 'C#'];
    });
    expect(diff).toEqual(['-  languages: [TypeScript, Go]', '+  languages: [TypeScript, Go, C#]']);
  });

  it('turns an empty flow list into a block list', () => {
    const { diff } = edit((v) => {
      v.education = [{ id: 'state', school: 'Example State University' }];
    });
    expect(diff).toEqual([
      '-education: []',
      '+education:',
      '+  - id: state',
      '+    school: Example State University',
    ]);
  });

  it('keeps a folded block scalar folded', () => {
    const { diff } = edit((v) => {
      v.summary = 'A new folded summary.\n';
    });
    expect(diff).toEqual(['-  Folded summary line.', '+  A new folded summary.']);
  });

  it('writes a value with a line break as a literal block', () => {
    const { out } = edit((v) => {
      v.standard_answers.how_did_you_hear = 'First line\nSecond line';
    });
    expect(out).toContain('  how_did_you_hear: |-\n    First line\n    Second line\n');
  });

  it('quotes a value that would read back as something else', () => {
    const { diff } = edit((v) => {
      v.standard_answers.how_did_you_hear = 'true';
    });
    expect(diff).toEqual([
      '-  how_did_you_hear: Company careers page',
      '+  how_did_you_hear: "true"',
    ]);
  });

  it('adds a top-level key at the end of the file', () => {
    const { diff } = edit((v) => {
      v.self_identification = { gender: 'decline' };
    });
    expect(diff).toEqual(['+self_identification:', '+  gender: decline']);
  });

  it('changes nothing when the value is the same', () => {
    expect(editYamlText(FILE, parse(FILE))).toBe(FILE);
  });

  it('returns null for text that is not YAML', () => {
    expect(editYamlText('a: [unclosed', { a: [] })).toBeNull();
  });
});
