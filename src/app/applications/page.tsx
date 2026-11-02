import { redirect } from 'next/navigation';
import { ApplicationsList } from '../components/ApplicationsList.js';

export const dynamic = 'force-dynamic';

/** The lists before J7 were `?view=` views of this route; old links land on their new routes. */
const OLD_VIEWS: Record<string, string> = {
  submitted: '/applications/submitted',
  due: '/applications/follow-ups',
};

/** In progress: every application still being prepared (J7). */
export default async function InProgressPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; due?: string }>;
}) {
  const sp = await searchParams;
  const moved = sp.due === '1' ? OLD_VIEWS.due : sp.view ? OLD_VIEWS[sp.view] : undefined;
  if (moved) redirect(moved);
  return <ApplicationsList list="in-progress" />;
}
