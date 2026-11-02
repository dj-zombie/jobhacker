import { ApplicationsList } from '../../components/ApplicationsList.js';

export const dynamic = 'force-dynamic';

/** Submitted: every application at or past submitted, each with its status (J7). */
export default function SubmittedPage() {
  return <ApplicationsList list="submitted" />;
}
