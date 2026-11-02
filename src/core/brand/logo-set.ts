import type { Criteria } from '../config/schemas.js';
import type { Db } from '../db/client.js';
import { type DomainRecord, domainsRepo } from '../db/repo/domains.js';
import { companies } from '../db/schema.js';
import { rankedList } from '../pipeline/ranked.js';
import type { Clock } from '../util/clock.js';
import { normalizeCompanyName } from '../util/hash.js';
import { sameSiteIconUrl } from './site-icon.js';

export interface LogoCounts {
  total: number;
  confirmed: number;
  found: number;
  none: number;
  noDomainYet: number;
}

/** Distinct normalized company names, last display name wins. */
export function allCompanyKeys(db: Db): Map<string, string> {
  const rows = db.select({ name: companies.name }).from(companies).all();
  const keys = new Map<string, string>();
  for (const row of rows) {
    const key = normalizeCompanyName(row.name);
    if (key) keys.set(key, row.name);
  }
  return keys;
}

/**
 * Companies with an open, canonical, gate-passed Strong or Maybe job that
 * isn't skipped or archived. Every place counts. Ranking is `rank.ts`.
 */
export function logoSetKeys(db: Db, clock: Clock, criteria: Criteria): Map<string, string> {
  const ranked = rankedList(db, clock, { weights: criteria.weights, bands: criteria.bands });
  const keys = new Map<string, string>();
  for (const row of ranked) {
    if (row.verdict !== 'strong' && row.verdict !== 'maybe') continue;
    if (row.status === 'skipped' || row.status === 'archived') continue;
    const key = normalizeCompanyName(row.company);
    if (!key || keys.has(key)) continue;
    keys.set(key, row.company);
  }
  return keys;
}

export function countDomains(
  keys: ReadonlyMap<string, string>,
  records: DomainRecord[],
): LogoCounts {
  const byKey = new Map(records.map((row) => [row.companyKey, row]));
  let confirmed = 0;
  let found = 0;
  let none = 0;
  for (const key of keys.keys()) {
    const row = byKey.get(key);
    // Kris said no logo. That answer counts even when the domain was cleared.
    if (row?.state === 'none') {
      none += 1;
      continue;
    }
    if (!row?.domain) continue;
    if (row.state === 'confirmed') confirmed += 1;
    else if (row.state === 'found') found += 1;
  }
  const total = keys.size;
  return {
    total,
    confirmed,
    found,
    none,
    noDomainYet: total - confirmed - found - none,
  };
}

export interface LogoCompany {
  companyKey: string;
  name: string;
  band: 'strong' | 'maybe';
  domain: string | null;
  state: DomainRecord['state'] | null;
  source: string | null;
  brandId: string | null;
  markUrl: string | null;
}

/**
 * The logo set as rows for the Company logos page. Best band first (the first
 * qualifying job in score order), then by name. `null` state means no row yet.
 */
export function logoCompanies(db: Db, clock: Clock, criteria: Criteria): LogoCompany[] {
  const ranked = rankedList(db, clock, { weights: criteria.weights, bands: criteria.bands });
  const best = new Map<string, { name: string; band: 'strong' | 'maybe' }>();
  for (const row of ranked) {
    if (row.verdict !== 'strong' && row.verdict !== 'maybe') continue;
    if (row.status === 'skipped' || row.status === 'archived') continue;
    const key = normalizeCompanyName(row.company);
    if (!key || best.has(key)) continue;
    best.set(key, { name: row.company, band: row.verdict });
  }
  const known = new Map(
    domainsRepo(db, clock)
      .all()
      .map((row) => [row.companyKey, row]),
  );
  const out: LogoCompany[] = [];
  for (const [companyKey, info] of best) {
    const record = known.get(companyKey);
    const cleared = record?.state === 'none';
    out.push({
      companyKey,
      name: info.name,
      band: info.band,
      domain: cleared ? null : (record?.domain ?? null),
      state: record?.state ?? null,
      source: record?.source ?? null,
      brandId: record?.brandId ?? null,
      markUrl:
        record && !cleared && record.source === 'typed'
          ? sameSiteIconUrl(record.markUrl, record.domain)
          : null,
    });
  }
  out.sort((a, b) => {
    if (a.band !== b.band) return a.band === 'strong' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

/**
 * Logo-set companies that still have no domain, strongest first.
 * `none` is Kris's answer and is not looked up again.
 */
export function namesMissingDomain(db: Db, clock: Clock, criteria: Criteria): string[] {
  const known = new Map(
    domainsRepo(db, clock)
      .all()
      .map((row) => [row.companyKey, row]),
  );
  const names: string[] = [];
  for (const [key, name] of logoSetKeys(db, clock, criteria)) {
    const row = known.get(key);
    if (row?.state === 'none') continue;
    if (row?.domain) continue;
    names.push(name);
  }
  return names;
}

/** What a tile needs from `company_domains`. `none` and a missing row are absent. */
export interface ShownDomain {
  domain: string;
  source: string;
  markUrl: string | null;
}

export function domainMap(records: DomainRecord[]): Map<string, ShownDomain> {
  const map = new Map<string, ShownDomain>();
  for (const row of records) {
    if (row.state === 'none' || !row.domain) continue;
    map.set(row.companyKey, {
      domain: row.domain,
      source: row.source,
      markUrl: row.source === 'typed' ? sameSiteIconUrl(row.markUrl, row.domain) : null,
    });
  }
  return map;
}

export function loadDomainMap(db: Db, clock: Clock): Map<string, ShownDomain> {
  return domainMap(domainsRepo(db, clock).all());
}
