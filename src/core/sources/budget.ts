import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { sourceUsage } from '../db/schema.js';

/** `YYYY-MM` from an ISO timestamp. */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

/** Calls already recorded for this source in the calendar month of `nowIso`. */
export function callsThisMonth(db: Db, sourceName: string, nowIso: string): number {
  const prefix = monthOf(nowIso);
  const rows = db
    .select({ day: sourceUsage.day, calls: sourceUsage.calls })
    .from(sourceUsage)
    .where(eq(sourceUsage.sourceName, sourceName))
    .all();
  let total = 0;
  for (const row of rows) {
    if (row.day.startsWith(prefix)) total += row.calls;
  }
  return total;
}

/** Credits already recorded for this source in the calendar month of `nowIso`. */
export function creditsThisMonth(db: Db, sourceName: string, nowIso: string): number {
  const prefix = monthOf(nowIso);
  const rows = db
    .select({ day: sourceUsage.day, credits: sourceUsage.credits })
    .from(sourceUsage)
    .where(eq(sourceUsage.sourceName, sourceName))
    .all();
  let total = 0;
  for (const row of rows) {
    if (row.day.startsWith(prefix)) total += row.credits;
  }
  return total;
}

/**
 * Add the credits one call was charged to that day's row. Calls are counted
 * separately, by `chargeCall`. A non-positive charge writes nothing: a failed
 * request costs no credits.
 */
export function addCredits(db: Db, sourceName: string, nowIso: string, credits: number): void {
  if (!Number.isFinite(credits) || credits <= 0) return;
  const day = dayOf(nowIso);
  const existing = db
    .select()
    .from(sourceUsage)
    .where(eq(sourceUsage.sourceName, sourceName))
    .all()
    .find((row) => row.day === day);
  if (!existing) {
    db.insert(sourceUsage).values({ sourceName, day, calls: 0, estCostUsd: 0, credits }).run();
    return;
  }
  db.update(sourceUsage)
    .set({ credits: existing.credits + credits })
    .where(eq(sourceUsage.id, existing.id))
    .run();
}

/**
 * Count one call if the month is still under `budget`. Returns false when it
 * is not, and writes nothing in that case. A budget of 0 always refuses.
 */
export function chargeCall(
  db: Db,
  sourceName: string,
  nowIso: string,
  budget: number,
  costUsd: number,
): boolean {
  if (budget <= 0) return false;
  if (callsThisMonth(db, sourceName, nowIso) >= budget) return false;
  const day = dayOf(nowIso);
  const existing = db
    .select()
    .from(sourceUsage)
    .where(eq(sourceUsage.sourceName, sourceName))
    .all()
    .find((row) => row.day === day);
  if (!existing) {
    db.insert(sourceUsage).values({ sourceName, day, calls: 1, estCostUsd: costUsd }).run();
    return true;
  }
  db.update(sourceUsage)
    .set({ calls: existing.calls + 1, estCostUsd: existing.estCostUsd + costUsd })
    .where(eq(sourceUsage.id, existing.id))
    .run();
  return true;
}
