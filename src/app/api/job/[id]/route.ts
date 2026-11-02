import { NextResponse } from 'next/server';
import { getTriageDetail, getUiConfig } from '../../../lib/queries.js';

export const dynamic = 'force-dynamic';

/** The selected job's detail for the triage views' detail pane. Loaded for one job at a time. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const jobId = Number((await params).id);
  const config = getUiConfig();
  if (!config.ok || !Number.isInteger(jobId)) return NextResponse.json(null, { status: 404 });
  const detail = getTriageDetail(config, jobId);
  return detail ? NextResponse.json(detail) : NextResponse.json(null, { status: 404 });
}
