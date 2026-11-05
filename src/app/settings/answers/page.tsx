import { AnswersSettingsForm } from '../../components/SettingsForms.js';
import { getSettings } from '../../lib/queries.js';
import { SettingsConfigError } from '../config-error.js';

export const dynamic = 'force-dynamic';

/** Settings → Answers: the standard answers forms use as written. */
export default function AnswersSettingsPage() {
  const data = getSettings('answers');
  if (!data.ok) return <SettingsConfigError file={data.file} issues={data.issues} />;
  return <AnswersSettingsForm answers={data.answers} />;
}
