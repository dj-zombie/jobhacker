import { decodeEntities, htmlToText, normalizeWhitespace } from '../util/text.js';
import type { RemoteType } from './types.js';

/**
 * Shared posting normalization (ROADMAP Round 1): HTML → text, remote_type
 * inference, and structured compensation.
 *
 * Compensation is taken only from structured yearly salary numbers. Live
 * Greenhouse and Lever payloads had none; Ashby publishes
 * `compensationTiers[].components[]`. Across those components we keep yearly
 * `Salary` entries, prefer USD when mixed currencies are present, and store
 * the low and high of that set. Equity, bonus, and monthly figures are left
 * out. Hourly is not annualized.
 */

export interface CompRange {
  min: number | null;
  max: number | null;
  currency: string | null;
}

export interface SalaryComponent {
  compensationType?: string | null;
  interval?: string | null;
  currencyCode?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
}

export interface SalaryTier {
  components?: SalaryComponent[] | null;
}

const EMPLOYMENT: Record<string, string> = {
  fulltime: 'full_time',
  'full-time': 'full_time',
  'full time': 'full_time',
  permanent: 'full_time',
  parttime: 'part_time',
  'part-time': 'part_time',
  'part time': 'part_time',
  contract: 'contract',
  contractor: 'contract',
  'full time contractor': 'contract',
  intern: 'internship',
  internship: 'internship',
  temporary: 'temporary',
  temp: 'temporary',
  'short term': 'temporary',
};

/** Map common ATS employment labels. Unknown labels are kept trimmed; "none" is empty. */
export function normalizeEmployment(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!key || key === 'none' || key === 'unspecified') return null;
  return EMPLOYMENT[key] ?? value.trim();
}

/**
 * Workplace type wins when the board states one. Otherwise a location that
 * says "hybrid" or "remote" wins over a city name; a non-empty location with
 * neither word is onsite.
 */
/** Map a feed's employment label onto the stored vocabulary. Unknown labels are kept as written. */
export function mapEmployment(label: string | null | undefined): string | null {
  if (!label) return null;
  const key = label.trim().toLowerCase();
  if (!key) return null;
  if (/full|permanent/.test(key)) return 'full_time';
  if (/part/.test(key)) return 'part_time';
  if (/contract|freelance/.test(key)) return 'contract';
  if (/intern/.test(key)) return 'internship';
  if (/temp/.test(key)) return 'temporary';
  return label.trim();
}

export function inferRemoteType(input: {
  workplaceType?: string | null;
  location?: string | null;
}): RemoteType {
  const workplace = (input.workplaceType ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  if (workplace === 'remote') return 'remote';
  if (workplace === 'hybrid') return 'hybrid';
  if (workplace === 'on-site' || workplace === 'onsite') return 'onsite';

  const location = input.location ?? '';
  if (/\bhybrid\b/i.test(location)) return 'hybrid';
  if (/\bremote\b/i.test(location)) return 'remote';
  if (location.trim()) return 'onsite';
  return 'unknown';
}

/** Yearly salary span. See the module note for which components count. */
export function yearlySalary(tiers: SalaryTier[] | null | undefined): CompRange {
  const hits: CompRange[] = [];
  for (const tier of tiers ?? []) {
    for (const component of tier.components ?? []) {
      if ((component.compensationType ?? '').trim().toLowerCase() !== 'salary') continue;
      if ((component.interval ?? '').trim().toUpperCase() !== '1 YEAR') continue;
      const min = money(component.minValue);
      const max = money(component.maxValue);
      if (min == null && max == null) continue;
      hits.push({ min, max, currency: currency(component.currencyCode) });
    }
  }
  if (hits.length === 0) return { min: null, max: null, currency: null };

  const firstCurrency = hits[0]?.currency ?? null;
  const usd = hits.filter((hit) => hit.currency === 'USD');
  const chosen = usd.length > 0 ? usd : hits.filter((hit) => hit.currency === firstCurrency);

  let min: number | null = null;
  let max: number | null = null;
  for (const hit of chosen) {
    if (hit.min != null) min = min == null ? hit.min : Math.min(min, hit.min);
    if (hit.max != null) max = max == null ? hit.max : Math.max(max, hit.max);
  }
  if (min != null && max != null && min > max) {
    const swap = min;
    min = max;
    max = swap;
  }
  return { min, max, currency: chosen[0]?.currency ?? null };
}

/** ISO-8601 UTC, or null when the value is missing or unparseable. Epoch numbers are milliseconds. */
export function toUtcIso(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  }
  return null;
}

/**
 * Greenhouse stores job HTML with the tags escaped (`&lt;p&gt;`). Decode that
 * once, then strip tags. Plain text is returned with its line breaks tidied.
 */
export function richTextToPlain(value: string): string {
  let text = value;
  if (!/<[a-z!/]/i.test(text) && /&lt;\/?[a-z]/i.test(text)) {
    text = decodeEntities(text);
  }
  if (/<[a-z!/]/i.test(text)) return htmlToText(text);
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/** Prefer the board's plain text. Fall back to HTML when plain text is empty. */
export function plainOrHtml(
  plain: string | null | undefined,
  html: string | null | undefined,
): string {
  if (plain?.trim()) return richTextToPlain(plain);
  if (html?.trim()) return richTextToPlain(html);
  return '';
}

export function cleanText(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = normalizeWhitespace(value);
  return cleaned.length > 0 ? cleaned : null;
}

export function cleanLine(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function money(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

function currency(value: string | null | undefined): string | null {
  if (!value) return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}
