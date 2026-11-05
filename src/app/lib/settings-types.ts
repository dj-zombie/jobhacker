import type { SectionInputs } from '../../core/config/profile-sections.js';
import type { CostBasis } from '../../core/config/staleness.js';

export type { SettingsSaveResult } from '../../core/config/settings.js';

/** The four Settings routes (J18). */
export const SETTINGS_ROUTES = ['profile', 'answers', 'self-id', 'preferences'] as const;
export type SettingsRoute = (typeof SETTINGS_ROUTES)[number];

/** The sections the Profile route edits. Self-identification has its own route. */
export type ProfileSettings = Pick<
  SectionInputs,
  'contact' | 'links' | 'summary' | 'skills' | 'experience' | 'education'
>;

/** What a scoring-key edit would cost now, shown before Kris saves one. */
export interface RescoreBasisView {
  /** Jobs scored under the current key: the ones a key change makes stale. */
  current: number;
  basis: CostBasis | null;
  /** `budget.max_new_scores_per_run`: Top matches re-scores this many at a time. */
  perRun: number;
}

/** One route's data. Each route gets only its own sections, so self-ID reaches only its page. */
export type SettingsData =
  | { ok: true; route: 'profile'; profile: ProfileSettings; rescore: RescoreBasisView }
  | { ok: true; route: 'answers'; answers: SectionInputs['standard_answers'] }
  | { ok: true; route: 'self-id'; selfId: SectionInputs['self_identification'] }
  | { ok: true; route: 'preferences'; preferences: string; rescore: RescoreBasisView }
  | { ok: false; route: SettingsRoute; file: string; issues: string[] };

export type SettingsDataFor<R extends SettingsRoute> =
  | Extract<SettingsData, { ok: true; route: R }>
  | Extract<SettingsData, { ok: false }>;
