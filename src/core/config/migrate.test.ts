import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { preferenceTerms, stem } from '../pipeline/prescore.js';
import { loadConfigFile } from './load.js';
import {
  draftPreferences,
  isLegacyCriteria,
  legacyCriteriaSchema,
  runConfigMigrate,
} from './migrate.js';
import { criteriaSchema } from './schemas.js';

const V1_YAML = `titles:
  include:
    - senior frontend
    - senior full stack
    - tools engineer
    - audio
  exclude:
    - intern
    - manager
locations:
  remote_countries: [US, CA]
  metros: [Phoenix, Tempe]
  allow_onsite: false
employment_types: [full_time, contract]
max_age_days: 21
compensation:
  currency: USD
  min_annual: 150000
  min_hourly: 0
company_blocklist: [Evil Corp]
interests:
  - games / game studios
  - developer tools
llm:
  scoring_model: claude-haiku-5-5
  writing_model: claude-sonnet-5-5
  max_new_scores_per_run: 120
  max_monthly_usd: 25
`;

const KEYWORDS = [
  'senior frontend',
  'senior full stack',
  'tools engineer',
  'audio',
  'intern',
  'manager',
  'US',
  'CA',
  'Phoenix',
  'Tempe',
  'full_time',
  'contract',
  '150000',
  'Evil Corp',
  'games / game studios',
  'developer tools',
];

describe('isLegacyCriteria', () => {
  it('recognizes the v1 keyword shape and not the v2 shape', () => {
    expect(isLegacyCriteria(parseYaml(V1_YAML))).toBe(true);
    expect(isLegacyCriteria({ gates: {}, weights: {} })).toBe(false);
    expect(isLegacyCriteria(null)).toBe(false);
  });
});

describe('draftPreferences', () => {
  const legacy = legacyCriteriaSchema.parse(parseYaml(V1_YAML));
  const draft = draftPreferences(legacy, '2026-10-23');

  it.each(KEYWORDS)('mentions the v1 keyword %s verbatim', (keyword) => {
    expect(draft).toContain(keyword);
  });

  it('puts excluded titles where the prescore reads them as unwanted', () => {
    const terms = preferenceTerms(draft);
    expect(terms.negative.has(stem('manager'))).toBe(true);
    expect(terms.negative.has(stem('intern'))).toBe(true);
    expect(terms.positive.has(stem('frontend'))).toBe(true);
    expect(terms.positive.has(stem('audio'))).toBe(true);
  });

  it('leaves a NEEDS INPUT marker instead of inventing a pay floor', () => {
    const noFloor = legacyCriteriaSchema.parse(
      parseYaml(V1_YAML.replace('min_annual: 150000', 'min_annual: 0')),
    );
    expect(draftPreferences(noFloor, '2026-10-23')).toContain('[NEEDS INPUT:');
  });

  it('is deterministic', () => {
    expect(draftPreferences(legacy, '2026-10-23')).toBe(draft);
  });
});

describe('runConfigMigrate', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jobhacker-migrate-'));
    writeFileSync(join(dir, 'criteria.yaml'), V1_YAML);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a valid v2 criteria.yaml, keeps the v1 text, and drafts preferences.md', () => {
    const result = runConfigMigrate(dir, { date: '2026-10-23' });
    expect(result.status).toBe('migrated');
    expect(result.wrotePreferences).toBe(true);
    expect(readFileSync(join(dir, 'criteria.v1.yaml'), 'utf8')).toBe(V1_YAML);

    const criteria = loadConfigFile('criteria', criteriaSchema, dir);
    expect(criteria.gates).toEqual({ max_age_days: 0, company_blocklist: ['Evil Corp'] });
    // The v1 file's `max_monthly_usd` is dropped: there is no monthly cap.
    expect(criteria.budget).toEqual({ prescore_floor: 0, max_new_scores_per_run: 120 });
    expect(criteria.llm.scoring_model).toBe('claude-haiku-5-5');

    const prefs = readFileSync(join(dir, 'preferences.md'), 'utf8');
    for (const keyword of KEYWORDS) expect(prefs).toContain(keyword);
    expect(prefs).toContain('old keyword-gate config used max_age_days 21');
  });

  it('is a no-op on a file that is already v2', () => {
    runConfigMigrate(dir, { date: '2026-10-23' });
    const second = runConfigMigrate(dir, { date: '2026-10-24' });
    expect(second.status).toBe('already-v2');
    expect(readFileSync(join(dir, 'criteria.v1.yaml'), 'utf8')).toBe(V1_YAML);
  });

  it('never overwrites an existing preferences.md without force', () => {
    writeFileSync(join(dir, 'preferences.md'), '# mine\nHand-written.\n');
    const result = runConfigMigrate(dir, { date: '2026-10-23' });
    expect(result.wrotePreferences).toBe(false);
    expect(readFileSync(join(dir, 'preferences.md'), 'utf8')).toBe('# mine\nHand-written.\n');
  });

  it('overwrites preferences.md with force', () => {
    writeFileSync(join(dir, 'preferences.md'), '# mine\n');
    const result = runConfigMigrate(dir, { date: '2026-10-23', force: true });
    expect(result.wrotePreferences).toBe(true);
    expect(readFileSync(join(dir, 'preferences.md'), 'utf8')).toContain('senior frontend');
  });
});
