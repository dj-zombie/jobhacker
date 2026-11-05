import type { CostBasis } from '../../core/config/staleness.js';

/** The paths each Settings section shows an error under. Anything else shows on the section. */
const FIELD_PATHS = {
  contact: /^contact\.(name|email|phone|location)$/,
  links: /^links\.(linkedin|github|portfolio)$/,
  summary: /^summary$/,
  skills: /^skills\.\d+\.group$/,
  experience: /^experience\.\d+\.(company|title|start|end|location|bullets\.\d+\.text)$/,
  education: /^education\.\d+\.(school|credential|start|end)$/,
  standard_answers: /^standard_answers\.\d+\.(key|value)$/,
  self_identification:
    /^self_identification\.(gender|race_ethnicity|veteran_status|disability_status|overrides\.\d+\.(key|value))$/,
  preferences: /^preferences$/,
} as const;

export type SettingsSectionKey = keyof typeof FIELD_PATHS;

export interface SplitIssues {
  /** Dotted path → message, for the fields the section shows. */
  fields: Record<string, string>;
  /** Whole issues the section shows above its fields. */
  section: string[];
}

/** Split a save's `path: message` issues into field errors and the rest. */
export function splitIssues(section: SettingsSectionKey, issues: readonly string[]): SplitIssues {
  const fields: Record<string, string> = {};
  const rest: string[] = [];
  for (const issue of issues) {
    const match = /^([A-Za-z0-9_.()]+): ([\s\S]+)$/.exec(issue);
    const path = match?.[1];
    const message = match?.[2];
    if (path && message && FIELD_PATHS[section].test(path) && !(path in fields)) {
      fields[path] = message;
    } else {
      rest.push(issue);
    }
  }
  return { fields, section: rest };
}

/** "$16.62". A cost under a cent reads as one. */
export function usd(amount: number): string {
  if (amount > 0 && amount < 0.01) return 'under $0.01';
  return `$${amount.toFixed(2)}`;
}

/** "$0.015": a per-score cost, with the third decimal it usually needs. */
function perScore(amount: number): string {
  return amount < 0.1 ? `$${amount.toFixed(3)}` : `$${amount.toFixed(2)}`;
}

function monthName(month: string, withYear: boolean): string {
  const [year, m] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (m ?? 1) - 1, 1));
  return date.toLocaleString('en-US', {
    month: 'long',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
}

/** Where the estimate comes from, or null when no scoring call is on record. */
export function costBasisLabel(basis: CostBasis | null): string | null {
  if (!basis) return null;
  const calls = `${basis.calls.toLocaleString('en-US')} scoring ${basis.calls === 1 ? 'call' : 'calls'}`;
  const mean = `mean of ${perScore(basis.perScoreUsd)} a score, over ${calls}`;
  return basis.thisMonth
    ? `${monthName(basis.month, false)}'s ${mean}`
    : `${monthName(basis.month, true)}'s ${mean}. No job has been scored this month yet`;
}
