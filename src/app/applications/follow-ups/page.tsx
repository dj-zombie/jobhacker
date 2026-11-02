import { ApplicationsList } from '../../components/ApplicationsList.js';

export const dynamic = 'force-dynamic';

/** Follow-ups: submitted applications whose follow-up date is today or earlier (J7). */
export default function FollowUpsPage() {
  return <ApplicationsList list="follow-ups" />;
}
