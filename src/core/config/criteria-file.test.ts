import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveRanking, saveWeights } from './criteria-file.js';
import { ConfigError } from './errors.js';
import { loadConfigFile } from './load.js';
import { type Bands, type Weights, criteriaSchema } from './schemas.js';

const NEW: Weights = {
  role_fit: 5,
  tech_fit: 1,
  domain_interest: 3,
  seniority_fit: 2,
  logistics_fit: 6,
  comp_fit: 0,
};

describe('saveWeights', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jobhacker-weights-'));
    cpSync(join('config', 'criteria.example.yaml'), join(dir, 'criteria.yaml'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('updates the six weights and leaves everything else, comments included, alone', () => {
    const before = readFileSync(join(dir, 'criteria.yaml'), 'utf8');
    const original = loadConfigFile('criteria', criteriaSchema, dir);
    saveWeights(dir, NEW);
    const after = readFileSync(join(dir, 'criteria.yaml'), 'utf8');
    const reloaded = loadConfigFile('criteria', criteriaSchema, dir);

    expect(reloaded.weights).toEqual(NEW);
    expect({ ...reloaded, weights: original.weights }).toEqual(original);
    const comments = (text: string) => text.split('\n').filter((l) => l.trim().startsWith('#'));
    expect(comments(after)).toEqual(comments(before));
    expect(after).toContain('# how much each dimension counts');
  });

  it('changes only the six weight lines', () => {
    const before = readFileSync(join(dir, 'criteria.yaml'), 'utf8').split('\n');
    saveWeights(dir, NEW);
    const after = readFileSync(join(dir, 'criteria.yaml'), 'utf8').split('\n');
    expect(after).toHaveLength(before.length);
    const changed = after.filter((line, i) => line !== before[i]);
    expect(changed.length).toBeLessThanOrEqual(6);
    for (const line of changed) expect(line).toMatch(/^\s+\w+_fit|^\s+domain_interest/);
  });

  it('falls back to a document edit for a flow-style weights map', () => {
    writeFileSync(
      join(dir, 'criteria.yaml'),
      [
        '# top comment',
        'gates: { max_age_days: 0, company_blocklist: [] }',
        'weights: { role_fit: 3, tech_fit: 2, domain_interest: 2, seniority_fit: 2, logistics_fit: 4, comp_fit: 1 }',
        'bands: { strong: 75, maybe: 55 }',
        'budget: { prescore_floor: 0, max_new_scores_per_run: 150 }',
        'llm: { scoring_model: m, writing_model: m }',
      ].join('\n'),
    );
    saveWeights(dir, NEW);
    expect(loadConfigFile('criteria', criteriaSchema, dir).weights).toEqual(NEW);
    expect(readFileSync(join(dir, 'criteria.yaml'), 'utf8')).toContain('# top comment');
  });

  it('rejects a weight outside 0–10 and writes nothing', () => {
    const before = readFileSync(join(dir, 'criteria.yaml'), 'utf8');
    expect(() => saveWeights(dir, { ...NEW, role_fit: 11 })).toThrow(ConfigError);
    expect(readFileSync(join(dir, 'criteria.yaml'), 'utf8')).toBe(before);
  });
});

const BANDS: Bands = { strong: 80, maybe: 50 };

describe('saveRanking', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jobhacker-ranking-'));
    cpSync(join('config', 'criteria.example.yaml'), join(dir, 'criteria.yaml'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('changes only weight and band lines, and keeps every comment', () => {
    const before = readFileSync(join(dir, 'criteria.yaml'), 'utf8');
    const original = loadConfigFile('criteria', criteriaSchema, dir);
    saveRanking(dir, { weights: NEW, bands: BANDS });
    const after = readFileSync(join(dir, 'criteria.yaml'), 'utf8');
    const reloaded = loadConfigFile('criteria', criteriaSchema, dir);

    expect(reloaded.weights).toEqual(NEW);
    expect(reloaded.bands).toEqual(BANDS);
    expect({ ...reloaded, weights: original.weights, bands: original.bands }).toEqual(original);
    const comments = (text: string) => text.split('\n').filter((l) => l.trim().startsWith('#'));
    expect(comments(after)).toEqual(comments(before));

    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    expect(afterLines).toHaveLength(beforeLines.length);
    const changed = afterLines.filter((line, i) => line !== beforeLines[i]);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.length).toBeLessThanOrEqual(8);
    for (const line of changed) {
      expect(line).toMatch(
        /^\s+(role_fit|tech_fit|domain_interest|seniority_fit|logistics_fit|comp_fit|strong|maybe):/,
      );
    }
  });

  it('rejects a band that leaves no weak scores, and writes nothing', () => {
    const before = readFileSync(join(dir, 'criteria.yaml'), 'utf8');
    expect(() => saveRanking(dir, { weights: NEW, bands: { strong: 40, maybe: 50 } })).toThrow(
      ConfigError,
    );
    expect(readFileSync(join(dir, 'criteria.yaml'), 'utf8')).toBe(before);
  });

  it("keeps a flow-style file's comment by writing the document", () => {
    writeFileSync(
      join(dir, 'criteria.yaml'),
      [
        '# top comment',
        'gates: { max_age_days: 0, company_blocklist: [] }',
        'weights: { role_fit: 3, tech_fit: 2, domain_interest: 2, seniority_fit: 2, logistics_fit: 4, comp_fit: 1 }',
        'bands: { strong: 75, maybe: 55 }',
        'budget: { prescore_floor: 0, max_new_scores_per_run: 150 }',
        'llm: { scoring_model: m, writing_model: m }',
      ].join('\n'),
    );
    const saved = saveRanking(dir, { weights: NEW, bands: BANDS });
    expect(saved).toEqual({ weights: NEW, bands: BANDS });
    expect(readFileSync(join(dir, 'criteria.yaml'), 'utf8')).toContain('# top comment');
  });
});
