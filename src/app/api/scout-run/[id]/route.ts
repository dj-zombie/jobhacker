import { NextResponse } from 'next/server';
import { getScoutRun } from '../../../lib/queries.js';

export const dynamic = 'force-dynamic';

/** A scout's live progress, polled while it runs (J8, the same way a score batch is polled). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const runId = Number((await params).id);
  const run = Number.isInteger(runId) ? getScoutRun(runId) : null;
  return run ? NextResponse.json(run) : NextResponse.json(null, { status: 404 });
}
