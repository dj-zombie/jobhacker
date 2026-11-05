import { EmptyState, PageHeader } from '@/components/jobhacker';
import { Briefcase, TriangleAlert } from 'lucide-react';
import { notFound } from 'next/navigation';
import { MobileNavButton } from '../../../components/app-shell.js';
import { JobDeepLink } from '../../components/JobDeepLink.js';
import { eventEntries } from '../../lib/activity.js';
import {
  brandfetchClientId,
  getJobEvents,
  getTriageDetail,
  getUiConfig,
  placesOf,
} from '../../lib/queries.js';

export const dynamic = 'force-dynamic';

/** A deep link to one job (J5): the triage views' detail at full width. */
export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);
  if (!Number.isInteger(jobId)) notFound();

  const config = getUiConfig();
  if (!config.ok) {
    return (
      <>
        <PageHeader
          icon={Briefcase}
          kicker="Triage"
          title="Job"
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

  const detail = getTriageDetail(config, jobId);
  if (!detail) notFound();
  // Titles are made here so event types and payloads never reach the page (UI-KIT § Checks 5).
  const events = eventEntries(getJobEvents(jobId));

  return (
    <JobDeepLink
      detail={detail}
      places={placesOf(config.criteria)}
      ranking={{ weights: config.criteria.weights, bands: config.criteria.bands }}
      nowMs={Date.now()}
      events={events}
      logoClientId={brandfetchClientId()}
    />
  );
}
