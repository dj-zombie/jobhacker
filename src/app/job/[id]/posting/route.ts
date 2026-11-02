import { NextResponse } from 'next/server';
import { getJobDetail } from '../../../lib/queries.js';

export const dynamic = 'force-dynamic';

/**
 * O, or Open posting: send the browser to the job's posting on its board. The triage rows don't
 * carry URLs, so the key opens this route in a new tab and it redirects.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const jobId = Number((await params).id);
  const url = Number.isInteger(jobId) ? getJobDetail(jobId)?.job.url : undefined;
  if (url && /^https?:\/\//i.test(url)) return NextResponse.redirect(url);
  return NextResponse.redirect(new URL(`/job/${jobId}`, request.url));
}
