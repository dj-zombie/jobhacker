import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Db, createMigratedTestDb } from '../db/client.js';
import { scoresRepo } from '../db/repo/scores.js';
import { jobs } from '../db/schema.js';
import { computeFunnel } from '../pipeline/funnel.js';
import { startScoreRun } from '../pipeline/score-run.js';
import { startScoutRun } from '../pipeline/scout.js';
import { scoreOutput, seedJobs } from '../testing/fixtures.js';
import { type Clock, fixedClock } from '../util/clock.js';
import { loadAllConfig } from './load.js';
import { toSectionInputs } from './profile-sections.js';
import {
  type SettingsDeps,
  liveRunRefusal,
  savePreferencesSettings,
  saveProfileSettings,
} from './settings.js';
import { scoringKeyOf } from './staleness.js';

const CONFIG = join(import.meta.dirname, '../../../config');
const NOW = '2026-11-04T12:00:00.000Z';

let dir: string;
let sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'] | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jh-settings-'));
  copyFileSync(join(CONFIG, 'profile.example.yaml'), join(dir, 'profile.yaml'));
  copyFileSync(join(CONFIG, 'criteria.example.yaml'), join(dir, 'criteria.yaml'));
  copyFileSync(join(CONFIG, 'preferences.example.md'), join(dir, 'preferences.md'));
  copyFileSync(join(CONFIG, 'companies.example.yaml'), join(dir, 'companies.yaml'));
});

afterEach(() => {
  sqlite?.close();
  sqlite = undefined;
  rmSync(dir, { recursive: true, force: true });
});

const sha = (name: string) =>
  createHash('sha256')
    .update(readFileSync(join(dir, name)))
    .digest('hex');
const backups = () => {
  try {
    return readdirSync(join(dir, 'backups'));
  } catch {
    return [];
  }
};

/** Four jobs scored under the copied config's key, one unscored. */
function setup(): { deps: SettingsDeps; db: Db; clock: Clock } {
  const made = createMigratedTestDb();
  sqlite = made.sqlite;
  const db = made.db;
  const clock = fixedClock(NOW);
  const config = loadAllConfig(dir);
  const key = scoringKeyOf(config);
  const ids = seedJobs(
    db,
    clock,
    ['A', 'B', 'C', 'D', 'E'].map((title) => ({ title })),
  );
  ids.forEach((id, i) => {
    db.update(jobs)
      .set({
        status: i < 4 ? 'scored' : 'unscored',
        gateResult: { passed: true, gate: null, detail: null },
      })
      .where(eq(jobs.id, id))
      .run();
    if (i === 4) return;
    scoresRepo(db, clock).insert({
      jobId: id,
      contentHash: `hash-Acme-${i}`,
      ...key,
      dimensions: scoreOutput({}, 4).dimensions,
      summary: 'A test job.',
      score: 80,
      verdict: 'strong',
      redFlags: [],
    });
  });
  return { deps: { db, clock, dir, backupDir: join(dir, 'backups') }, db, clock };
}

const currentCount = (db: Db, clock: Clock) => {
  const config = loadAllConfig(dir);
  return computeFunnel(db, clock, config.criteria, scoringKeyOf(config)).scored.current;
};

describe('saveProfileSettings', () => {
  it('asks first when the edit changes the scoring key, and writes nothing until confirmed', () => {
    const { deps, db, clock } = setup();
    const before = sha('profile.yaml');
    const stale = currentCount(db, clock);
    expect(stale).toBe(4);

    const asked = saveProfileSettings(deps, 'summary', 'Staff engineer.', false);
    expect(asked).toMatchObject({ status: 'confirm', needsConfirm: true, staleIfSaved: stale });
    expect(sha('profile.yaml')).toBe(before);
    expect(backups()).toEqual([]);

    const saved = saveProfileSettings(deps, 'summary', 'Staff engineer.', true);
    expect(saved).toEqual({ status: 'saved', changed: true, value: 'Staff engineer.' });
    expect(sha('profile.yaml')).not.toBe(before);
    expect(backups()).toHaveLength(1);
    expect(currentCount(db, clock)).toBe(0);
  });

  it('saves an edit that keeps the key without asking', () => {
    const { deps, db, clock } = setup();
    const links = toSectionInputs(loadAllConfig(dir).profile).links;
    const saved = saveProfileSettings(
      deps,
      'links',
      { ...links, github: 'https://github.com/kris-tester-2' },
      false,
    );
    expect(saved).toMatchObject({ status: 'saved', changed: true });
    expect(currentCount(db, clock)).toBe(4);
  });

  it('writes nothing for a save with no changes', () => {
    const { deps } = setup();
    const before = sha('profile.yaml');
    const summary = toSectionInputs(loadAllConfig(dir).profile).summary;
    expect(saveProfileSettings(deps, 'summary', summary, false)).toMatchObject({
      status: 'saved',
      changed: false,
    });
    expect(sha('profile.yaml')).toBe(before);
    expect(backups()).toEqual([]);
  });

  it('refuses while a scout is running, and leaves the file unchanged', () => {
    const { deps, db, clock } = setup();
    startScoutRun(db, clock);
    const before = sha('profile.yaml');
    const refused = saveProfileSettings(deps, 'summary', 'Staff engineer.', true);
    expect(refused).toMatchObject({ status: 'refused', issues: [] });
    expect(refused.status === 'refused' && refused.error).toMatch(/^A scout is running/);
    expect(sha('profile.yaml')).toBe(before);
    expect(backups()).toEqual([]);
  });

  it('refuses while a score run is live', () => {
    const { deps, db, clock } = setup();
    startScoreRun(db, clock, { first: [] });
    expect(liveRunRefusal(db, clock)).toMatch(/^A score run is going/);
    expect(saveProfileSettings(deps, 'links', {}, false)).toMatchObject({ status: 'refused' });
  });

  it('returns validation issues by dotted path, with no file path', () => {
    const { deps } = setup();
    const contact = toSectionInputs(loadAllConfig(dir).profile).contact;
    const refused = saveProfileSettings(deps, 'contact', { ...contact, email: 'nope' }, false);
    expect(refused).toEqual({
      status: 'refused',
      error: 'Nothing was saved.',
      issues: ['contact.email: must be an email address or a visible [NEEDS INPUT: …] marker'],
    });
    expect(JSON.stringify(refused)).not.toContain(dir);
  });
});

describe('savePreferencesSettings', () => {
  it('asks first for a reworded file, not for a whitespace-only change', () => {
    const { deps } = setup();
    const text = readFileSync(join(dir, 'preferences.md'), 'utf8');
    const before = sha('preferences.md');
    expect(savePreferencesSettings(deps, `${text}\nAlso games.\n`, false)).toMatchObject({
      status: 'confirm',
      staleIfSaved: 4,
    });
    expect(sha('preferences.md')).toBe(before);
    expect(savePreferencesSettings(deps, `${text}\n\n`, false)).toMatchObject({
      status: 'saved',
      changed: true,
    });
  });

  it('refuses a blank file', () => {
    const { deps } = setup();
    expect(savePreferencesSettings(deps, '  \n', true)).toMatchObject({
      status: 'refused',
      issues: ['file is empty. Describe the roles you want in prose.'],
    });
  });

  it('refuses while a scout is running', () => {
    const { deps, db, clock } = setup();
    startScoutRun(db, clock);
    const before = sha('preferences.md');
    expect(savePreferencesSettings(deps, 'Games.', true)).toMatchObject({ status: 'refused' });
    expect(sha('preferences.md')).toBe(before);
  });
});
