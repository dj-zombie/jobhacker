import type { Db } from '../db/client.js';
import { liveScoringRun } from '../pipeline/score-run.js';
import type { Clock } from '../util/clock.js';
import { ConfigError } from './errors.js';
import { loadConfigFile, loadPreferences } from './load.js';
import { savePreferences } from './preferences-file.js';
import { commitProfileEdit, planProfileSection } from './profile-file.js';
import { type ProfileSection, type SectionInputs, toSectionInputs } from './profile-sections.js';
import { type Criteria, criteriaSchema, profileSchema } from './schemas.js';
import { type CostBasis, rescoreImpact } from './staleness.js';

/**
 * The Settings save flow (J18), shared by the server actions: refuse while a scout or score run
 * is live, plan the edit, ask first when it changes the score cache key, then back up and write.
 * Results carry no file path and no value Kris didn't send. Nothing here logs.
 */

export interface SettingsDeps {
  db: Db;
  clock: Clock;
  /** The config folder. */
  dir: string;
  /** Defaults to `DEFAULT_CONFIG_BACKUP_DIR`. */
  backupDir?: string;
}

export type SettingsSaveResult<T> =
  | { status: 'saved'; changed: boolean; value: T }
  | {
      status: 'confirm';
      needsConfirm: true;
      staleIfSaved: number;
      estimatedUsd: number | null;
      basis: CostBasis | null;
      perRun: number;
    }
  | { status: 'refused'; error: string; issues: string[] };

const NOT_SAVED = 'Nothing was saved.';

/** Why a save can't happen now, or null. A live run scores under the current key (D136's rule). */
export function liveRunRefusal(db: Db, clock: Clock): string | null {
  const live = liveScoringRun(db, clock);
  if (!live) return null;
  return live.kind === 'scout'
    ? `A scout is running, and it scores jobs against your settings as they are now. Save after it finishes. ${NOT_SAVED}`
    : `A score run is going, against your settings as they are now. Save after it finishes. ${NOT_SAVED}`;
}

export function saveProfileSettings<S extends ProfileSection>(
  deps: SettingsDeps,
  section: S,
  value: unknown,
  confirmRescore: boolean,
): SettingsSaveResult<SectionInputs[S]> {
  return guarded(deps, () => {
    const criteria = loadCriteria(deps.dir);
    const preferences = loadPreferences(deps.dir);
    const edit = planProfileSection(deps.dir, section, value);
    const saved = () => toSectionInputs(edit.next)[section];
    if (!edit.changed) return { status: 'saved', changed: false, value: saved() };
    const impact = rescoreImpact(
      deps.db,
      { criteria, profile: edit.current, preferences },
      { criteria, profile: edit.next, preferences },
      deps.clock,
    );
    if (impact.changesScores && !confirmRescore) return confirm(impact, criteria);
    commitProfileEdit(edit, { clock: deps.clock, backupDir: deps.backupDir });
    return { status: 'saved', changed: true, value: saved() };
  });
}

export function savePreferencesSettings(
  deps: SettingsDeps,
  text: unknown,
  confirmRescore: boolean,
): SettingsSaveResult<string> {
  return guarded(deps, () => {
    if (typeof text !== 'string') {
      return { status: 'refused', error: NOT_SAVED, issues: ['preferences: must be text'] };
    }
    const criteria = loadCriteria(deps.dir);
    const profile = loadConfigFile('profile', profileSchema, deps.dir);
    const current = loadPreferences(deps.dir);
    if (text === current) return { status: 'saved', changed: false, value: text };
    if (text.trim().length > 0) {
      const impact = rescoreImpact(
        deps.db,
        { criteria, profile, preferences: current },
        { criteria, profile, preferences: text },
        deps.clock,
      );
      if (impact.changesScores && !confirmRescore) return confirm(impact, criteria);
    }
    const saved = savePreferences(deps.dir, text, { clock: deps.clock, backupDir: deps.backupDir });
    return { status: 'saved', changed: saved.changed, value: saved.text };
  });
}

/**
 * Run a save inside an immediate transaction, so no scout or score run can open between the
 * check and the write. A `ConfigError` comes back as its issues, which name a dotted path and
 * never a file.
 */
function guarded<T>(deps: SettingsDeps, run: () => SettingsSaveResult<T>): SettingsSaveResult<T> {
  const tx = deps.db.$client.transaction((): SettingsSaveResult<T> => {
    const refusal = liveRunRefusal(deps.db, deps.clock);
    if (refusal) return { status: 'refused', error: refusal, issues: [] };
    return run();
  });
  try {
    return tx.immediate();
  } catch (err) {
    if (err instanceof ConfigError)
      return { status: 'refused', error: NOT_SAVED, issues: err.issues };
    throw err;
  }
}

function confirm<T>(
  impact: ReturnType<typeof rescoreImpact>,
  criteria: Criteria,
): SettingsSaveResult<T> {
  return {
    status: 'confirm',
    needsConfirm: true,
    staleIfSaved: impact.staleIfSaved,
    estimatedUsd: impact.estimatedUsd,
    basis: impact.basis,
    perRun: criteria.budget.max_new_scores_per_run,
  };
}

function loadCriteria(dir: string): Criteria {
  return loadConfigFile('criteria', criteriaSchema, dir);
}
