import { redirect } from 'next/navigation';
import { TriagePage } from '../components/TriagePage.js';
import { legacyViewHref } from '../lib/triage-url.js';

// Always read the live DB (never cache the server read).
export const dynamic = 'force-dynamic';

interface SearchParams {
  view?: string;
  tab?: string;
  where?: string;
  seen?: string;
  segment?: string;
}

/**
 * Top matches (J23, D168). It used to live at `/`; the legacy `?view=` values the J4 queue and the
 * J6 weights panel used still redirect here or to the other triage views.
 */
export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const href = legacyViewHref(sp.view ?? sp.tab, { where: sp.where, seen: sp.seen });
  if (href) redirect(href);
  return <TriagePage view="top" />;
}
