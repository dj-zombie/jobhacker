import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { domainsRepo } from '../db/repo/domains.js';
import type { Clock } from '../util/clock.js';
import { normalizeCompanyName } from '../util/hash.js';
import {
  type CompanyInput,
  type DomainChoice,
  type JobLink,
  type SourceQuality,
  findCompanyDomains,
} from './domain.js';

export interface DomainTouch {
  name: string;
  isNew: boolean;
  websites: string[];
}

export interface DomainWriteStats {
  ms: number;
  written: number;
  cleared: number;
  kept: number;
}

interface StoredJob {
  name: string;
  url: string;
  apply_url: string | null;
  source_name: string;
  source_quality: string;
  post: string | null;
  text: string | null;
}

const QUALITIES = new Set<SourceQuality>(['high', 'medium', 'low']);

function qualityOf(value: string): SourceQuality {
  return QUALITIES.has(value as SourceQuality) ? (value as SourceQuality) : 'high';
}

function loadJobs(db: Db): StoredJob[] {
  return db.all<StoredJob>(sql`
    select c.name as name, j.url as url, j.apply_url as apply_url, j.source_name as source_name,
      j.source_quality as source_quality,
      case when j.source_name = 'hn' then j.description_text else null end as post,
      j.description_text as text
    from jobs j
    join companies c on c.id = j.company_id
  `);
}

function companiesFrom(rows: StoredJob[], websites: ReadonlyMap<string, string[]>): CompanyInput[] {
  const byKey = new Map<string, CompanyInput>();
  for (const row of rows) {
    const key = normalizeCompanyName(row.name);
    if (!key) continue;
    const company = byKey.get(key) ?? { name: row.name, jobs: [] };
    company.name = row.name;
    const link: JobLink = {
      url: row.url,
      applyUrl: row.apply_url,
      post: row.source_name === 'hn' ? row.post : null,
      text: row.text && row.text.length > 0 ? row.text : null,
      companyWebsite: null,
      sourceQuality: qualityOf(row.source_quality),
    };
    company.jobs.push(link);
    byKey.set(key, company);
  }
  for (const [key, list] of websites) {
    const company = byKey.get(key) ?? { name: key, jobs: [] };
    for (const website of list) {
      company.jobs.push({
        url: null,
        applyUrl: null,
        post: null,
        text: null,
        companyWebsite: website,
        sourceQuality: 'medium',
      });
    }
    byKey.set(key, company);
  }
  return [...byKey.values()];
}

function writeChoices(
  db: Db,
  clock: Clock,
  choices: ReadonlyMap<string, DomainChoice | null>,
  names: ReadonlyMap<string, string>,
  keys: ReadonlySet<string>,
): Pick<DomainWriteStats, 'written' | 'cleared' | 'kept'> {
  const repo = domainsRepo(db, clock);
  let written = 0;
  let cleared = 0;
  let kept = 0;
  for (const key of keys) {
    const choice = choices.get(key) ?? null;
    if (!choice) {
      if (repo.deleteFound(key)) cleared += 1;
      continue;
    }
    const result = repo.upsertFound({
      companyKey: key,
      name: names.get(key) ?? key,
      domain: choice.domain,
      source: choice.source,
    });
    if (result === 'kept') kept += 1;
    else written += 1;
  }
  return { written, cleared, kept };
}

/** Record a company this scout inserted or a website it saw. */
export function noteDomainTouch(
  touches: Map<string, DomainTouch>,
  name: string,
  isNew: boolean,
  website?: string | null,
): void {
  const key = normalizeCompanyName(name);
  if (!key) return;
  const current = touches.get(key) ?? { name, isNew: false, websites: [] };
  current.name = name;
  current.isNew = current.isNew || isNew;
  if (website) current.websites.push(website);
  touches.set(key, current);
}

/**
 * Finder for companies new in this run, and for `found` companies whose jobs
 * were touched. Sees every company's jobs, so a domain shared by three
 * companies still drops. Makes no network calls.
 */
export function refreshTouchedDomains(
  db: Db,
  clock: Clock,
  touches: ReadonlyMap<string, DomainTouch>,
): DomainWriteStats {
  const started = Date.now();
  const repo = domainsRepo(db, clock);
  const existing = new Map(repo.all().map((row) => [row.companyKey, row]));
  const keys = new Set<string>();
  const websites = new Map<string, string[]>();
  const names = new Map<string, string>();
  for (const [key, touch] of touches) {
    names.set(key, touch.name);
    if (touch.websites.length > 0) websites.set(key, touch.websites);
    const row = existing.get(key);
    if (touch.isNew || row?.state === 'found') keys.add(key);
  }
  if (keys.size === 0) {
    return { ms: Date.now() - started, written: 0, cleared: 0, kept: 0 };
  }
  const companies = companiesFrom(loadJobs(db), websites);
  for (const company of companies) {
    const key = normalizeCompanyName(company.name);
    if (key) names.set(key, company.name);
  }
  const choices = findCompanyDomains(companies);
  const wrote = writeChoices(db, clock, choices, names, keys);
  return { ms: Date.now() - started, ...wrote };
}

/** Finder over every company, from what's stored. Does not touch `confirmed` or `none`. */
export function findEveryDomain(db: Db, clock: Clock): DomainWriteStats {
  const started = Date.now();
  const repo = domainsRepo(db, clock);
  const companies = companiesFrom(loadJobs(db), new Map());
  const names = new Map<string, string>();
  for (const company of companies) {
    const key = normalizeCompanyName(company.name);
    if (key) names.set(key, company.name);
  }
  const choices = findCompanyDomains(companies);
  const keys = new Set(choices.keys());
  for (const row of repo.all()) {
    if (row.state === 'found') keys.add(row.companyKey);
  }
  const wrote = writeChoices(db, clock, choices, names, keys);
  return { ms: Date.now() - started, ...wrote };
}
