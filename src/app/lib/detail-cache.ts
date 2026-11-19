/**
 * The triage detail's client cache: which jobs to load before they're selected, and how the cache
 * stays bounded. Pure, so the view's effects stay thin.
 */

/**
 * The jobs to load around the selected one, nearest first, alternating ahead and behind. Jobs
 * already loaded are skipped, so after J the one behind is usually loaded already.
 */
export function prefetchIds(
  ids: readonly string[],
  index: number,
  has: (id: string) => boolean,
  ahead: number,
  behind: number,
): string[] {
  if (index < 0 || index >= ids.length) return [];
  const out: string[] = [];
  for (let d = 1; d <= Math.max(ahead, behind); d++) {
    const next = d <= ahead ? ids[index + d] : undefined;
    if (next !== undefined && !has(next)) out.push(next);
    const prev = d <= behind ? ids[index - d] : undefined;
    if (prev !== undefined && !has(prev)) out.push(prev);
  }
  return out;
}

/**
 * A copy of `cache` with `entries` added as the newest, then the oldest dropped until it holds
 * `max`. The `keep` entry, the selected job's, is never dropped.
 */
export function addCapped<K, V>(
  cache: ReadonlyMap<K, V>,
  entries: readonly (readonly [K, V])[],
  max: number,
  keep: K | null,
): Map<K, V> {
  const next = new Map(cache);
  for (const [k, v] of entries) {
    next.delete(k);
    next.set(k, v);
  }
  for (const k of next.keys()) {
    if (next.size <= max) break;
    if (k !== keep) next.delete(k);
  }
  return next;
}
