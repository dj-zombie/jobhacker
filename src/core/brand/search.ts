import { z } from 'zod';
import type { Db } from '../db/client.js';
import { domainsRepo } from '../db/repo/domains.js';
import type { Clock } from '../util/clock.js';
import { normalizeCompanyName } from '../util/hash.js';
import { isPlatformDomain, registrableDomain } from './domain.js';

/**
 * A search hit's domain. The brand name already has to be the company, so the
 * label has to be the name too. A short extra (`notionup` for Notion) is a
 * different brand. `mobi.ai` for Mobi.AI is the name plus its own suffix.
 */
export function searchMatchesName(domain: string, companyName: string): boolean {
  const label = domain.split('.')[0] ?? '';
  const compact = normalizeCompanyName(companyName).replace(/[^a-z0-9]/g, '');
  if (!label || !compact) return false;
  if (label === compact) return true;
  const suffix = domain.split('.').slice(1).join('');
  return suffix.length >= 2 && suffix.length <= 3 && compact === `${label}${suffix}`;
}

/**
 * One Brand Search hit. The icon URL is left out on purpose: it expires, and
 * SOURCES § Brand data says not to keep it. `claimed` and `verified` are
 * left out too.
 */
export const searchHitSchema = z
  .object({
    name: z.string().nullable().optional(),
    domain: z.string(),
    brandId: z.string().nullable().optional(),
  })
  .strip();

export const searchHitsSchema = z.array(searchHitSchema).max(8);

export type SearchHit = z.infer<typeof searchHitSchema>;

export interface SearchPick {
  domain: string;
  brandId: string | null;
}

/**
 * The one brand that is this company, or null when nothing is unambiguous.
 * The brand's name has to be the company, and the domain has to match that
 * name. Two such brands is a tie, unless one domain's first label is the name.
 */
export function pickSearchMatch(
  companyName: string,
  hits: readonly SearchHit[],
): SearchPick | null {
  const key = normalizeCompanyName(companyName);
  const compact = key.replace(/[^a-z0-9]/g, '');
  if (!key || !compact) return null;
  const unique = new Map<string, SearchPick & { exact: boolean }>();
  for (const hit of hits) {
    if (!hit.name || normalizeCompanyName(hit.name) !== key) continue;
    const domain = registrableDomain(hit.domain);
    if (!domain || isPlatformDomain(domain) || !searchMatchesName(domain, companyName)) {
      continue;
    }
    if (unique.has(domain)) continue;
    const label = domain.split('.')[0] ?? '';
    unique.set(domain, {
      domain,
      brandId: hit.brandId ?? null,
      exact: label === compact,
    });
  }
  const list = [...unique.values()];
  if (list.length === 1) {
    const only = list[0];
    return only ? { domain: only.domain, brandId: only.brandId } : null;
  }
  const exact = list.filter((item) => item.exact);
  if (exact.length === 1) {
    const only = exact[0];
    return only ? { domain: only.domain, brandId: only.brandId } : null;
  }
  return null;
}

/**
 * Store a domain Kris's browser resolved. Refuses a domain that doesn't match
 * the name, a platform host, and any row that already has a job-data domain
 * or that Kris confirmed. Returns the stored domain, or null when nothing changed.
 */
export function saveSearchedDomain(
  db: Db,
  clock: Clock,
  input: { name: string; domain: string; brandId: string | null },
): string | null {
  const key = normalizeCompanyName(input.name);
  const domain = registrableDomain(input.domain);
  if (!key || !domain || isPlatformDomain(domain) || !searchMatchesName(domain, input.name)) {
    return null;
  }
  const repo = domainsRepo(db, clock);
  const existing = repo.get(key);
  if (existing && existing.state !== 'found') return null;
  if (existing?.domain && existing.source !== 'brand_search') return null;
  const wrote = repo.upsertFound({
    companyKey: key,
    name: input.name,
    domain,
    source: 'brand_search',
    brandId: input.brandId,
  });
  return wrote === 'kept' ? null : domain;
}
