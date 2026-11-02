import { notFound, redirect } from 'next/navigation';
import { getApplicationIdForJob } from '../../lib/queries.js';

export const dynamic = 'force-dynamic';

/**
 * The workspace moved to `/applications/[id]` in J7, keyed by application. An old link by job
 * goes to that job's application, or to the job when nothing is prepared yet.
 */
export default async function OldApplicationPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  const id = Number(jobId);
  if (!Number.isInteger(id)) notFound();
  const applicationId = getApplicationIdForJob(id);
  redirect(applicationId === undefined ? `/job/${id}` : `/applications/${applicationId}`);
}
