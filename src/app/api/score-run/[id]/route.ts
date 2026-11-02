import { NextResponse } from 'next/server';
import { getScoreRun } from '../../../lib/queries.js';

export const dynamic = 'force-dynamic';

/** A score batch's progress (done of total, new matches), polled while it runs (D95). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const runId = Number((await params).id);
  const run = Number.isInteger(runId) ? getScoreRun(runId) : null;
  return run ? NextResponse.json(run) : NextResponse.json(null, { status: 404 });
}
