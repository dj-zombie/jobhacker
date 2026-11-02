import { NextResponse } from 'next/server';
import { getScoutCard, getUiConfig } from '../../lib/queries.js';

export const dynamic = 'force-dynamic';

/**
 * The sidebar's scout card, polled while a scout runs. A GET route rather than a server action,
 * because Next.js runs a page's server actions one at a time and Run scout holds one open.
 */
export function GET() {
  return NextResponse.json(getScoutCard(getUiConfig()));
}
