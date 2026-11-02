import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, loadAllConfig, loadConfigFile } from './load.js';
import { criteriaSchema } from './schemas.js';

/** Build a temp config dir seeded with the committed example files. */
function seedConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jobhacker-cfg-'));
  for (const name of ['criteria', 'profile', 'companies']) {
    cpSync(join('config', `${name}.example.yaml`), join(dir, `${name}.yaml`));
  }
  cpSync(join('config', 'preferences.example.md'), join(dir, 'preferences.md'));
  return dir;
}

const V2_CRITERIA = [
  'gates: { max_age_days: 0, company_blocklist: [] }',
  'weights: { role_fit: 3, tech_fit: 2, domain_interest: 2, seniority_fit: 2, logistics_fit: 4, comp_fit: 1 }',
  'bands: { strong: 75, maybe: 55 }',
  'budget: { prescore_floor: 0, max_new_scores_per_run: 150 }',
  'llm: { scoring_model: m, writing_model: m }',
];

describe('loadAllConfig', () => {
  let dir: string;

  beforeEach(() => {
    dir = seedConfigDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads the example files as a valid config', () => {
    const config = loadAllConfig(dir);
    expect(config.criteria.weights.logistics_fit).toBeGreaterThan(0);
    expect(config.criteria.bands.strong).toBeGreaterThanOrEqual(config.criteria.bands.maybe);
    expect(config.preferences).toContain('#');
    expect(config.profile.contact.email).toContain('@');
    expect(config.companies.companies.length).toBeGreaterThan(0);
  });

  it('reports a missing file with its name and a copy hint', () => {
    rmSync(join(dir, 'criteria.yaml'));
    try {
      loadAllConfig(dir);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const message = (err as ConfigError).message;
      expect(message).toContain('criteria.yaml');
      expect(message).toContain('file not found');
    }
  });

  it('reports a missing preferences.md with a migrate hint', () => {
    rmSync(join(dir, 'preferences.md'));
    expect(() => loadAllConfig(dir)).toThrowError(/preferences\.md[\s\S]*config:migrate/);
  });

  it('rejects a blank preferences.md', () => {
    writeFileSync(join(dir, 'preferences.md'), '   \n\n');
    expect(() => loadAllConfig(dir)).toThrowError(/preferences\.md[\s\S]*empty/);
  });

  it('reports a YAML syntax error against the right file', () => {
    writeFileSync(join(dir, 'companies.yaml'), 'companies: [this: is: broken');
    expect(() => loadAllConfig(dir)).toThrowError(/companies\.yaml/);
  });
});

describe('loadConfigFile validation errors', () => {
  let dir: string;

  beforeEach(() => {
    dir = seedConfigDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('accepts a minimal v2 criteria file', () => {
    writeFileSync(join(dir, 'criteria.yaml'), V2_CRITERIA.join('\n'));
    const criteria = loadConfigFile('criteria', criteriaSchema, dir);
    expect(criteria.budget.prescore_floor).toBe(0);
  });

  it('rejects a non-zero prescore floor', () => {
    writeFileSync(
      join(dir, 'criteria.yaml'),
      V2_CRITERIA.join('\n').replace('prescore_floor: 0', 'prescore_floor: 0.1'),
    );
    expect(() => loadConfigFile('criteria', criteriaSchema, dir)).toThrowError(/prescore_floor/);
  });

  it('points a v1 keyword file at config:migrate instead of listing schema errors', () => {
    writeFileSync(
      join(dir, 'criteria.yaml'),
      ['titles:', '  include: [senior frontend]', 'max_age_days: 21'].join('\n'),
    );
    expect(() => loadConfigFile('criteria', criteriaSchema, dir)).toThrowError(/config:migrate/);
  });

  it('includes the dotted path and message for a wrong type', () => {
    writeFileSync(
      join(dir, 'criteria.yaml'),
      V2_CRITERIA.join('\n').replace('max_age_days: 0', 'max_age_days: not-a-number'),
    );
    try {
      loadConfigFile('criteria', criteriaSchema, dir);
      expect.unreachable('should have thrown');
    } catch (err) {
      const e = err as ConfigError;
      expect(e).toBeInstanceOf(ConfigError);
      expect(e.issues.some((i) => i.startsWith('gates.max_age_days:'))).toBe(true);
    }
  });

  it('rejects bands where strong is below maybe', () => {
    writeFileSync(
      join(dir, 'criteria.yaml'),
      V2_CRITERIA.join('\n').replace('strong: 75', 'strong: 40'),
    );
    expect(() => loadConfigFile('criteria', criteriaSchema, dir)).toThrowError(/bands\.strong/);
  });

  it('rejects a weight outside 0–10', () => {
    writeFileSync(
      join(dir, 'criteria.yaml'),
      V2_CRITERIA.join('\n').replace('comp_fit: 1', 'comp_fit: 11'),
    );
    expect(() => loadConfigFile('criteria', criteriaSchema, dir)).toThrowError(/weights\.comp_fit/);
  });

  it('rejects unknown keys (strict schema)', () => {
    writeFileSync(join(dir, 'criteria.yaml'), [...V2_CRITERIA, 'surprise: true'].join('\n'));
    expect(() => loadConfigFile('criteria', criteriaSchema, dir)).toThrowError(
      /Unrecognized key|surprise/i,
    );
  });
});
