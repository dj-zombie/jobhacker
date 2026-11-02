import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Criteria } from '../config/schemas.js';
import type { Db } from '../db/client.js';
import { jobs } from '../db/schema.js';
import type { Clock } from '../util/clock.js';
import { type ApplyAreasResult, applyAreas } from './areas.js';
import { type GateStats, applyGates } from './gate.js';
import { applyPrescores } from './prescore.js';

export interface ReconcilePlacementResult {
  gates: GateStats;
  prescored: number;
  areas: ApplyAreasResult;
}

/**
 * Reconcile the cheap, deterministic placement state used by every
 * placement-sensitive CLI/UI read. This is the single write-before-read path
 * for gate, prescore and place (`job_areas`) state; it never calls the LLM.
 */
const placementCache = new Map<string, { stamp: string; result: ReconcilePlacementResult }>();

/**
 * File databases only. In-memory test databases always recompute, and a new
 * connection to the same file reuses the result when nothing relevant changed.
 * The homepage used to re-read every description several times per click.
 */
export function reconcilePlacement(
  db: Db,
  criteria: Criteria,
  preferences: string,
  clock: Clock,
): ReconcilePlacementResult {
  const file = databaseFile(db);
  const stamp = file ? placementStamp(db, criteria, preferences) : null;
  if (file && stamp) {
    const hit = placementCache.get(file);
    if (hit?.stamp === stamp) return hit.result;
  }
  const result = {
    gates: applyGates(db, criteria.gates, clock.nowMs()),
    prescored: applyPrescores(db, preferences),
    areas: applyAreas(db, criteria),
  };
  if (file) placementCache.set(file, { stamp: placementStamp(db, criteria, preferences), result });
  return result;
}

function databaseFile(db: Db): string | null {
  const name = (db.$client as { name?: string }).name;
  if (!name || name === ':memory:') return null;
  return name;
}

function placementStamp(db: Db, criteria: Criteria, preferences: string): string {
  const row = db
    .select({
      n: sql<number>`count(*)`,
      seen: sql<string>`coalesce(max(${jobs.lastSeenAt}), '')`,
      missingPrescore: sql<number>`sum(case when ${jobs.prescore} is null and ${jobs.closedAt} is null and ${jobs.duplicateOf} is null then 1 else 0 end)`,
    })
    .from(jobs)
    .get();
  const prefs = createHash('sha256').update(preferences).digest('hex').slice(0, 16);
  const gates = createHash('sha256')
    .update(JSON.stringify([criteria.gates, criteria.places ?? null, criteria.remote ?? null]))
    .digest('hex')
    .slice(0, 16);
  return `${prefs}:${gates}:${row?.n ?? 0}:${row?.seen ?? ''}:${row?.missingPrescore ?? 0}`;
}
