import { EmptyState, PageHeader } from '@/components/jobhacker';
import { Radar, TriangleAlert } from 'lucide-react';
import { MobileNavButton } from '../../components/app-shell.js';
import { brandfetchClientId, getDashboard, getScoutCard, getUiConfig } from '../lib/queries.js';
import { Dashboard } from './Dashboard.js';

/**
 * The recon-console dashboard at `/` (J23). Read once on the server — `computeStats`, the funnel,
 * a score sample and the applications in flight — and handed to the client `Dashboard`, which
 * renders and wires the scout actions. The shell (layout) provides the sidebar around it.
 */
export function DashboardPage() {
  const config = getUiConfig();
  if (!config.ok) {
    return (
      <>
        <PageHeader
          icon={Radar}
          kicker="Recon"
          title="Command"
          art="/art/deck-hacker.webp"
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
  return (
    <Dashboard
      data={getDashboard(config)}
      scout={getScoutCard(config)}
      clientId={brandfetchClientId()}
    />
  );
}
