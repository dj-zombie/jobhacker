import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setCompanyActive } from './companies-file.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const FILE = `# boards Kris watches
companies:
  - name: Immunefi
    ats: greenhouse
    token: immunefi
    active: true
    tags: []
  # still hiring
  - name: Coinhako
    ats: ashby
    token: coinhako
    active: true # public board
    tags: [fintech]
`;

describe('setCompanyActive', () => {
  it('flips one active line and leaves the rest of the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jobhacker-companies-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'companies.yaml'), FILE);
    const result = setCompanyActive(dir, 'ashby', 'coinhako', false);
    expect(result).toEqual({ name: 'Coinhako', changed: true });
    const next = readFileSync(join(dir, 'companies.yaml'), 'utf8');
    expect(next).toBe(FILE.replace('active: true # public board', 'active: false # public board'));
    expect(next).toContain('active: true');
    expect(next).toContain('# still hiring');
    expect(setCompanyActive(dir, 'ashby', 'coinhako', false)).toEqual({
      name: 'Coinhako',
      changed: false,
    });
    expect(readFileSync(join(dir, 'companies.yaml'), 'utf8')).toBe(next);
  });

  it('refuses a board that is not in the file and writes nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jobhacker-companies-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'companies.yaml'), FILE);
    expect(() => setCompanyActive(dir, 'lever', 'nope', false)).toThrow(/no board/);
    expect(readFileSync(join(dir, 'companies.yaml'), 'utf8')).toBe(FILE);
  });
});
