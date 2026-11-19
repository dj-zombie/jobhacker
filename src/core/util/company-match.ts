import { nameMatches } from '../sources/relocate.js';

/**
 * The listed spelling that matches `company`, or null (J27, D174).
 * `nameMatches` folds case, punctuation and legal suffixes, and a listed name
 * of at least 3 characters also matches as whole words inside the stored name.
 * The first list entry wins.
 */
export function companyOnList(company: string, list: readonly string[]): string | null {
  for (const name of list) {
    if (nameMatches(name, company)) return name;
  }
  return null;
}

export interface TargetOrderRow {
  companyName: string;
  /** Already scored under the current cache key. Those stay in place. */
  current: boolean;
  inFirst: boolean;
  inIndustry: boolean;
  /** The deferral tier `listScorable` already sorts by. Lower goes first. */
  tier: number;
}

/**
 * Within each industry group, place group and deferral tier, a job that is not
 * already current at a listed company goes first. The groups themselves stay
 * in the order `listScorable` uses. An empty list returns the rows unchanged.
 */
export function preferTargetCompanies<T extends TargetOrderRow>(
  rows: readonly T[],
  targets: readonly string[],
): T[] {
  if (targets.length === 0) return [...rows];
  const indexed = rows.map((row, index) => ({ row, index }));
  indexed.sort((a, b) => {
    if (a.row.inIndustry !== b.row.inIndustry) return a.row.inIndustry ? -1 : 1;
    if (a.row.inFirst !== b.row.inFirst) return a.row.inFirst ? -1 : 1;
    if (a.row.tier !== b.row.tier) return a.row.tier - b.row.tier;
    const at = !a.row.current && companyOnList(a.row.companyName, targets) !== null ? 0 : 1;
    const bt = !b.row.current && companyOnList(b.row.companyName, targets) !== null ? 0 : 1;
    if (at !== bt) return at - bt;
    return a.index - b.index;
  });
  return indexed.map((item) => item.row);
}
