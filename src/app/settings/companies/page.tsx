import { CompaniesSettingsForm } from '../../components/SettingsForms.js';
import { getSettings } from '../../lib/queries.js';
import { SettingsConfigError } from '../config-error.js';

export const dynamic = 'force-dynamic';

/** Settings → Companies: the names that lift a job's rank (J27). */
export default function CompaniesSettingsPage() {
  const data = getSettings('companies');
  if (!data.ok) return <SettingsConfigError file={data.file} issues={data.issues} />;
  return <CompaniesSettingsForm text={data.text} report={data.report} />;
}
