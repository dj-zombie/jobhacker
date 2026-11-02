import type { Criteria } from '../config/schemas.js';
import type { Db } from '../db/client.js';
import { domainsRepo } from '../db/repo/domains.js';
import type { Clock } from '../util/clock.js';
import { normalizeCompanyName } from '../util/hash.js';
import { registrableDomain } from './domain.js';
import { logoCompanies } from './logo-set.js';
import { sameSiteIconUrl } from './site-icon.js';

/**
 * What Kris did in the logo picker. A pick and a typed domain both go through
 * `registrableDomain` before anything is stored, so a website URL can't sit
 * in the table and then fail `logoUrl()`.
 */
export type LogoChoice =
  | { kind: 'confirm' }
  | { kind: 'pick'; domain: string; brandId: string | null }
  | { kind: 'type'; domain: string; markUrl: string | null }
  | { kind: 'none' };

export interface StoredLogo {
  companyKey: string;
  name: string;
  domain: string | null;
  state: 'confirmed' | 'none';
  source: string;
  brandId: string | null;
  markUrl: string | null;
}

export type LogoChoiceResult = { ok: true; logo: StoredLogo } | { ok: false; error: string };

function brandIdOf(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 100 ? trimmed : null;
}

/** Store Kris's answer for one logo-set company. Nothing else calls this. */
export function applyLogoChoice(
  db: Db,
  clock: Clock,
  criteria: Criteria,
  name: string,
  choice: LogoChoice,
): LogoChoiceResult {
  const key = normalizeCompanyName(name);
  const company = key
    ? logoCompanies(db, clock, criteria).find((row) => row.companyKey === key)
    : undefined;
  if (!company) return { ok: false, error: "That company isn't in the logo set." };

  if (choice.kind === 'confirm') {
    if (company.state !== 'found' || !company.domain) {
      return { ok: false, error: "There's no logo to confirm." };
    }
    const logo: StoredLogo = {
      companyKey: company.companyKey,
      name: company.name,
      domain: company.domain,
      state: 'confirmed',
      source: company.source ?? 'found',
      brandId: company.brandId,
      markUrl: null,
    };
    domainsRepo(db, clock).upsertChoice(logo);
    return { ok: true, logo };
  }

  if (choice.kind === 'none') {
    const logo: StoredLogo = {
      companyKey: company.companyKey,
      name: company.name,
      domain: null,
      state: 'none',
      source: 'none',
      brandId: null,
      markUrl: null,
    };
    domainsRepo(db, clock).upsertChoice(logo);
    return { ok: true, logo };
  }

  const domain = registrableDomain(choice.domain);
  if (!domain) return { ok: false, error: "That isn't a domain." };
  const logo: StoredLogo = {
    companyKey: company.companyKey,
    name: company.name,
    domain,
    state: 'confirmed',
    source: choice.kind === 'pick' ? 'picked' : 'typed',
    brandId: choice.kind === 'pick' ? brandIdOf(choice.brandId) : null,
    markUrl: choice.kind === 'type' ? sameSiteIconUrl(choice.markUrl, domain) : null,
  };
  domainsRepo(db, clock).upsertChoice(logo);
  return { ok: true, logo };
}
