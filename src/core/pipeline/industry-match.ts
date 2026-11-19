/**
 * Industry matching with no database imports, so the triage view and ⌘K can
 * use it in the browser. A view filter, never a gate.
 */

/** Marker ⌘K puts on an industry row so an alias query selects that row only. */
export const INDUSTRY_ALIAS_MARK = '\u0000alias:';

/** Lowercased aliases, including each id, that open an industry in ⌘K. */
export function industryAliasSet(
  industries: readonly { id: string; aliases: readonly string[] }[],
): Set<string> {
  const set = new Set<string>();
  for (const industry of industries) {
    set.add(industry.id);
    for (const alias of industry.aliases) {
      const word = alias.trim().toLowerCase();
      if (word) set.add(word);
    }
  }
  return set;
}

/** The palette value for one industry. An alias query matches only this. */
export function industryMatchValue(industry: {
  id: string;
  label: string;
  aliases: readonly string[];
}): string {
  const words = [industry.id, ...industry.aliases.map((alias) => alias.trim().toLowerCase())];
  const marks = [...new Set(words.filter(Boolean))].map((word) => `${INDUSTRY_ALIAS_MARK}${word}`);
  return `${industry.label} ${marks.join(' ')}`;
}

/**
 * ⌘K scoring. An industry alias selects only the industry row. Anything else
 * matches when the value contains the query as a substring, not a subsequence.
 */
export function paletteScore(value: string, search: string, aliases: ReadonlySet<string>): number {
  const query = search.trim().toLowerCase();
  if (!query) return 1;
  if (aliases.has(query)) {
    return value.toLowerCase().includes(`${INDUSTRY_ALIAS_MARK}${query}`) ? 1 : 0;
  }
  return value.toLowerCase().includes(query) ? 1 : 0;
}

/** True when the row is suggested or confirmed as `industry`. Null shows every row. */
export function inIndustry(
  row: { industryId: string | null; industryStatus: string | null },
  industry: string | null,
): boolean {
  if (!industry) return true;
  return (
    row.industryId === industry &&
    (row.industryStatus === 'suggested' || row.industryStatus === 'confirmed')
  );
}
