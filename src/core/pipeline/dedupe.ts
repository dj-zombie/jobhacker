import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { jobs } from '../db/schema.js';

/**
 * Point every later job with the same `dedupe_key` at the first-seen row.
 * The canonical row (earliest `first_seen_at`, then lowest id) has
 * `duplicate_of` cleared. Returns how many jobs are flagged as duplicates.
 */
const QUALITY_RANK = { high: 3, medium: 2, low: 1 } as const;

/**
 * One canonical row per `dedupe_key`. Highest `source_quality` wins, so an
 * ATS copy supersedes an aggregator or HN copy of the same job. Equal quality
 * keeps the earliest row (then the lowest id), which is what board-only
 * dedupe already did.
 */
export function assignDuplicates(db: Db): { flagged: number } {
  const rows = db
    .select({
      id: jobs.id,
      dedupeKey: jobs.dedupeKey,
      duplicateOf: jobs.duplicateOf,
      sourceQuality: jobs.sourceQuality,
      firstSeenAt: jobs.firstSeenAt,
    })
    .from(jobs)
    .all();

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = groups.get(row.dedupeKey);
    if (list) list.push(row);
    else groups.set(row.dedupeKey, [row]);
  }

  let flagged = 0;
  for (const list of groups.values()) {
    list.sort((a, b) => {
      const quality = rank(b.sourceQuality) - rank(a.sourceQuality);
      if (quality !== 0) return quality;
      if (a.firstSeenAt !== b.firstSeenAt) return a.firstSeenAt < b.firstSeenAt ? -1 : 1;
      return a.id - b.id;
    });
    const canonical = list[0];
    if (!canonical) continue;
    if (canonical.duplicateOf !== null) {
      db.update(jobs).set({ duplicateOf: null }).where(eq(jobs.id, canonical.id)).run();
    }
    for (const row of list.slice(1)) {
      flagged += 1;
      if (row.duplicateOf !== canonical.id) {
        db.update(jobs).set({ duplicateOf: canonical.id }).where(eq(jobs.id, row.id)).run();
      }
    }
  }

  return { flagged };
}

function rank(quality: string): number {
  if (quality === 'high' || quality === 'medium' || quality === 'low') return QUALITY_RANK[quality];
  return 0;
}
