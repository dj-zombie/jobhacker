import { SelfIdSettingsForm } from '../../components/SettingsForms.js';
import { getSettings } from '../../lib/queries.js';
import { SettingsConfigError } from '../config-error.js';

export const dynamic = 'force-dynamic';

/** Settings → Self-ID. The only page whose HTML carries the self-identification answers. */
export default function SelfIdSettingsPage() {
  const data = getSettings('self-id');
  if (!data.ok) return <SettingsConfigError file={data.file} issues={data.issues} />;
  return <SelfIdSettingsForm selfId={data.selfId} />;
}
