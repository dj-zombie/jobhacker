import { redirect } from 'next/navigation';
import { TriagePage } from './components/TriagePage.js';

// Always read the live DB (never cache the server read).
export const dynamic = 'force-dynamic';

/** Where the J4 queue's `?view=` values live now. Review and ranked were the old weights panel (J6). */
const MOVED: Record<string, string> = {
  matches: '/',
  new: '/new',
  shortlist: '/shortlist',
  unscored: '/unscored',
  review: '/',
  ranked: '/',
};

interface SearchParams {
  view?: string;
  tab?: string;
  where?: string;
  seen?: string;
  segment?: string;
}

export default async function TopMatchesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const legacy = sp.view ?? sp.tab;
  const moved = legacy ? MOVED[legacy] : undefined;
  if (moved) {
    const keep = new URLSearchParams();
    for (const key of ['where', 'seen'] as const) {
      const value = sp[key];
      if (value) keep.set(key, value);
    }
    const q = keep.toString().replaceAll('%2C', ',');
    redirect(`${moved}${q ? `?${q}` : ''}`);
  }
  return <TriagePage view="top" />;
}
