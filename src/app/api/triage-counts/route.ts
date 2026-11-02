import { NextResponse } from 'next/server';
import { bandsSchema } from '../../../core/config/schemas.js';
import { areaIds, whereDefault } from '../../../core/pipeline/areas.js';
import { decodeWeights } from '../../lib/format.js';
import { getTriageCounts, getUiConfig } from '../../lib/queries.js';
import { parseWhereParam } from '../../lib/triage-url.js';

export const dynamic = 'force-dynamic';

/**
 * The sidebar's triage counts within `?where=`, refetched after a Where change, a triage action,
 * or a live weight move (`?w=` and `?bands=`). A GET route, like the scout card, so it never
 * waits behind a server action that's still running. A bad weight or band is ignored, and the
 * saved criteria are used instead.
 */
export function GET(request: Request) {
  const config = getUiConfig();
  if (!config.ok) return NextResponse.json(null);
  const params = new URL(request.url).searchParams;
  const where = parseWhereParam(
    params.get('where'),
    areaIds(config.criteria),
    whereDefault(config.criteria),
  );
  const weights = decodeWeights(params.get('w') ?? undefined) ?? undefined;
  const bandsRaw = params.get('bands');
  const [strong, maybe] = (bandsRaw ?? '').split(',').map(Number);
  const bands = bandsSchema.safeParse({ strong, maybe });
  return NextResponse.json(
    getTriageCounts(config, where, {
      ...(weights ? { weights } : {}),
      ...(bands.success ? { bands: bands.data } : {}),
    }),
  );
}
