import { PreferencesSettingsForm } from '../../components/SettingsForms.js';
import { getSettings } from '../../lib/queries.js';
import { SettingsConfigError } from '../config-error.js';

export const dynamic = 'force-dynamic';

/** Settings → Preferences: `preferences.md`, the roles Kris wants in his own words. */
export default function PreferencesSettingsPage() {
  const data = getSettings('preferences');
  if (!data.ok) return <SettingsConfigError file={data.file} issues={data.issues} />;
  return <PreferencesSettingsForm preferences={data.preferences} rescore={data.rescore} />;
}
