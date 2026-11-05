import { EmptyState, PageHeader } from '@/components/jobhacker';
import { TriangleAlert } from 'lucide-react';
import { MobileNavButton } from '../../components/app-shell.js';
import type { TriageView as View } from '../../core/pipeline/triage-view.js';
import { getTriagePage, getUiConfig } from '../lib/queries.js';
import { TriageView } from './TriageView.js';

const TITLE: Record<View, string> = {
  top: 'Top matches',
  new: 'New today',
  shortlist: 'Shortlist',
  unscored: 'Unscored',
};

/**
 * A triage route (J5): every row of the view, read once on the server and handed to the client
 * `TriageView`, which filters by Where and Seen, ranks and handles the keyboard.
 */
export function TriagePage({ view }: { view: View }) {
  const config = getUiConfig();
  if (!config.ok) {
    return (
      <>
        <PageHeader
          kicker="Triage"
          title={TITLE[view]}
          art="/art/deck-skull.webp"
          leading={<MobileNavButton />}
        />
        <EmptyState
          icon={TriangleAlert}
          title="The config has an error"
          body={
            <pre className="mt-2 max-w-xl whitespace-pre-wrap rounded-md border border-danger/30 bg-danger-wash p-3 text-left font-mono text-xs text-danger">
              {config.error}
            </pre>
          }
        />
      </>
    );
  }
  return <TriageView view={view} data={getTriagePage(config, view)} />;
}
