import { NextResponse } from 'next/server';
import { bandsSchema } from '../../../core/config/schemas.js';
import { decodeWeights } from '../../lib/format.js';
import { getPaletteJobs, getUiConfig } from '../../lib/queries.js';

export const dynamic = 'force-dynamic';

/**
 * The top 40 jobs for ⌘K. `w` and `bands` are the tune panel's live ranking; a bad value is
 * ignored and the saved criteria are used. Where is not applied.
 */
export function GET(request: Request) {
  const config = getUiConfig();
  if (!config.ok) return NextResponse.json([]);
  const params = new URL(request.url).searchParams;
  const weights = decodeWeights(params.get('w') ?? undefined) ?? undefined;
  const [strong, maybe] = (params.get('bands') ?? '').split(',').map(Number);
  const bands = bandsSchema.safeParse({ strong, maybe });
  return NextResponse.json(
    getPaletteJobs(config, {
      ...(weights ? { weights } : {}),
      ...(bands.success ? { bands: bands.data } : {}),
    }),
  );
}
