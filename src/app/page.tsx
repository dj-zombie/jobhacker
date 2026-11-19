import { redirect } from 'next/navigation';
import { DashboardPage } from './components/DashboardPage.js';
import { legacyViewHref } from './lib/triage-url.js';

// Always read the live DB (never cache the server read).
export const dynamic = 'force-dynamic';

interface SearchParams {
  view?: string;
  tab?: string;
  where?: string;
  seen?: string;
}

/**
 * `/` is the recon-console dashboard (J23, D168). An old `/?view=…` link — from before Top matches
 * moved to `/matches` — still lands on the right view.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const href = legacyViewHref(sp.view ?? sp.tab, { where: sp.where, seen: sp.seen });
  if (href) redirect(href);
  return <DashboardPage />;
}
