import { ProfileSettingsForm } from '../../components/SettingsForms.js';
import { getSettings } from '../../lib/queries.js';
import { SettingsConfigError } from '../config-error.js';

export const dynamic = 'force-dynamic';

/** Settings → Profile: contact, links, summary, skills, experience and education. */
export default function ProfileSettingsPage() {
  const data = getSettings('profile');
  if (!data.ok) return <SettingsConfigError file={data.file} issues={data.issues} />;
  return <ProfileSettingsForm profile={data.profile} rescore={data.rescore} />;
}
