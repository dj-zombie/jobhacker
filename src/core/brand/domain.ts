import { parse } from 'tldts';
import { normalizeCompanyName } from '../util/hash.js';

/**
 * Company domains from job data only (J9). No requests, no guessing from a name.
 * A domain from a link has to match the company name. A domain three or more
 * companies point at is a platform or a recruiter and never counts.
 */

export const SHARED_DOMAIN_COMPANIES = 3;

export type SourceQuality = 'high' | 'medium' | 'low';

/** Registrable domains that are never a company's own site. */
export const PLATFORM_DOMAINS: readonly string[] = [
  // Board ATS hosts (SOURCES § Board sources) and the gated ones under it.
  'greenhouse.io',
  'lever.co',
  'ashbyhq.com',
  'smartrecruiters.com',
  'breezy.hr',
  'polymer.co',
  'workable.com',
  'teamtailor.com',
  'myworkdayjobs.com',
  'workday.com',
  'icims.com',
  'successfactors.com',
  'taleo.net',
  'jobvite.com',
  'bamboohr.com',
  'personio.com',
  'personio.de',
  // Search sources' own hosts.
  'ycombinator.com',
  'algolia.com',
  'openwebninja.com',
  // Job boards.
  'linkedin.com',
  'indeed.com',
  'glassdoor.com',
  'ziprecruiter.com',
  'wellfound.com',
  'builtin.com',
  'dice.com',
  'jooble.org',
  'lensa.com',
  'jobleads.com',
  'jobgether.com',
  'monster.com',
  'simplyhired.com',
  'careerbuilder.com',
  'tealhq.com',
  'flexjobs.com',
  'otta.com',
  'welcometothejungle.com',
  'weworkremotely.com',
  'remoteok.com',
  'himalayas.app',
  'remotive.com',
  'usajobs.gov',
  'adzuna.com',
  'gem.com',
  'jobright.ai',
  // Social.
  'x.com',
  'twitter.com',
  'facebook.com',
  'instagram.com',
  'youtube.com',
  'medium.com',
  // Code, document and form hosts, and link shorteners.
  'github.com',
  'github.io',
  'notion.com',
  'notion.so',
  'notion.site',
  'google.com',
  'typeform.com',
  'forms.gle',
  'bit.ly',
  'bitly.com',
  't.co',
  'tinyurl.com',
  'goo.gl',
  'lnkd.in',
  'buff.ly',
];

const PLATFORM = new Set(PLATFORM_DOMAINS);

const QUALITY_RANK: Record<SourceQuality, number> = { high: 3, medium: 2, low: 1 };

const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export interface JobLink {
  url: string | null;
  applyUrl: string | null;
  /** HN post text. Null for every other source. */
  post: string | null;
  /** Job text, from every source. Links and hostnames in it are candidates. */
  text: string | null;
  /** A company-website field, such as JSearch's employer_website. */
  companyWebsite: string | null;
  sourceQuality: SourceQuality;
}

export interface CompanyInput {
  name: string;
  jobs: JobLink[];
}

export interface DomainChoice {
  domain: string;
  source: string;
}

interface Candidate {
  domain: string;
  source: string;
  quality: SourceQuality;
  /** Lower is better: website, post link, url, apply url, then text. */
  priority: number;
}

/**
 * The registrable domain of a URL or host, or null when it isn't one.
 * A token has to be on the public suffix list. `Next.js` is not a domain.
 */
export function registrableDomain(value: string): string | null {
  const parsed = parse(value);
  if (!parsed.domain || !parsed.isIcann) return null;
  const lower = parsed.domain.toLowerCase();
  return HOSTNAME.test(lower) ? lower : null;
}

export function isPlatformDomain(domain: string): boolean {
  return PLATFORM.has(domain);
}

/**
 * A link's domain matches the company when its first label contains the
 * normalized name, or the name contains that label and the label is at least
 * 4 characters. `datadoghq.com` matches Datadog. `x.com` does not match Roblox.
 */
export function domainMatchesName(domain: string, companyName: string): boolean {
  const label = domain.split('.')[0] ?? '';
  const compact = normalizeCompanyName(companyName).replace(/[^a-z0-9]/g, '');
  if (!label || !compact) return false;
  if (label.includes(compact)) return true;
  return label.length >= 4 && compact.includes(label);
}

/**
 * A mention in job text. Stricter than a posting URL: the label has to be the
 * name, the name plus a short suffix (`datadoghq`), or a long label the name
 * contains. Otherwise "Cloud" would claim every `cloudflare.com` mention and
 * the shared-domain rule would throw the real one out.
 */
export function descriptionMatchesName(domain: string, companyName: string): boolean {
  const label = domain.split('.')[0] ?? '';
  const compact = normalizeCompanyName(companyName).replace(/[^a-z0-9]/g, '');
  if (!label || !compact) return false;
  if (label === compact) return true;
  const extra = label.length - compact.length;
  if (compact.length >= 5 && label.startsWith(compact) && extra >= 1 && extra <= 3) return true;
  if (label.length >= 5 && compact.includes(label)) return true;
  // "Mobi.AI" is mobi.ai: the name's last token is the domain's suffix.
  const suffix = domain.split('.').slice(1).join('');
  return suffix.length >= 2 && suffix.length <= 3 && compact === `${label}${suffix}`;
}

function linksIn(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"'|]+/gi) ?? [];
  return found.map((link) => link.replace(/[),.;]+$/, ''));
}

/** Hostnames written without a scheme. `hr@acme.com` counts: the label after `@` is the company. */
function hostsIn(text: string): string[] {
  return text.match(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}\b/gi) ?? [];
}

function addCandidate(
  out: Candidate[],
  value: string | null,
  companyName: string,
  source: string,
  quality: SourceQuality,
  priority: number,
  match: 'no' | 'loose' | 'strict',
): void {
  if (!value) return;
  const domain = registrableDomain(value);
  if (!domain || isPlatformDomain(domain)) return;
  if (match === 'loose' && !domainMatchesName(domain, companyName)) return;
  if (match === 'strict' && !descriptionMatchesName(domain, companyName)) return;
  out.push({ domain, source, quality, priority });
}

function candidatesOf(job: JobLink, companyName: string): Candidate[] {
  const out: Candidate[] = [];
  addCandidate(out, job.companyWebsite, companyName, 'jsearch_website', job.sourceQuality, 0, 'no');
  if (job.post) {
    for (const link of linksIn(job.post)) {
      addCandidate(out, link, companyName, 'hn_link', job.sourceQuality, 1, 'loose');
    }
  }
  addCandidate(out, job.url, companyName, 'url', job.sourceQuality, 2, 'loose');
  addCandidate(out, job.applyUrl, companyName, 'apply_url', job.sourceQuality, 3, 'loose');
  if (job.text) {
    for (const link of linksIn(job.text)) {
      addCandidate(out, link, companyName, 'description', job.sourceQuality, 4, 'strict');
    }
    for (const host of hostsIn(job.text)) {
      addCandidate(out, host, companyName, 'description', job.sourceQuality, 5, 'strict');
    }
  }
  return out;
}

function bestCandidate(list: Candidate[]): Candidate | null {
  let best: Candidate | null = null;
  for (const candidate of list) {
    if (!best || candidate.priority < best.priority) best = candidate;
  }
  return best;
}

interface Vote {
  domain: string;
  source: string;
  quality: SourceQuality;
}

function choose(votes: Vote[]): DomainChoice | null {
  const byDomain = new Map<string, Vote[]>();
  for (const vote of votes) {
    const list = byDomain.get(vote.domain) ?? [];
    list.push(vote);
    byDomain.set(vote.domain, list);
  }
  let best: { domain: string; count: number; quality: number; source: string } | null = null;
  let tied = false;
  for (const [domain, list] of byDomain) {
    const count = list.length;
    const quality = Math.max(...list.map((vote) => QUALITY_RANK[vote.quality]));
    const source = [...list].sort((a, b) => QUALITY_RANK[b.quality] - QUALITY_RANK[a.quality])[0]
      ?.source;
    if (!source) continue;
    if (!best || count > best.count || (count === best.count && quality > best.quality)) {
      best = { domain, count, quality, source };
      tied = false;
    } else if (count === best.count && quality === best.quality && domain !== best.domain) {
      tied = true;
    }
  }
  if (!best || tied) return null;
  return { domain: best.domain, source: best.source };
}

/**
 * One domain per company, keyed by the normalized company name. Null means
 * nothing survived the rules. `confirmed` and `none` are not this function's
 * business: the caller refuses to overwrite them.
 */
export function findCompanyDomains(
  inputs: readonly CompanyInput[],
): Map<string, DomainChoice | null> {
  const grouped = new Map<string, CompanyInput>();
  for (const input of inputs) {
    const key = normalizeCompanyName(input.name);
    if (!key) continue;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { name: input.name, jobs: [...input.jobs] });
    } else {
      existing.name = input.name;
      existing.jobs.push(...input.jobs);
    }
  }

  const perKey = new Map<string, Candidate[][]>();
  const pointed = new Map<string, Set<string>>();
  for (const [key, company] of grouped) {
    const perJob: Candidate[][] = [];
    for (const job of company.jobs) {
      const found = candidatesOf(job, company.name);
      perJob.push(found);
      for (const candidate of found) {
        const keys = pointed.get(candidate.domain) ?? new Set<string>();
        keys.add(key);
        pointed.set(candidate.domain, keys);
      }
    }
    perKey.set(key, perJob);
  }

  const shared = new Set<string>();
  for (const [domain, keys] of pointed) {
    if (keys.size >= SHARED_DOMAIN_COMPANIES) shared.add(domain);
  }

  const result = new Map<string, DomainChoice | null>();
  for (const [key, perJob] of perKey) {
    const votes: Vote[] = [];
    for (const found of perJob) {
      const best = bestCandidate(found.filter((candidate) => !shared.has(candidate.domain)));
      if (best) votes.push({ domain: best.domain, source: best.source, quality: best.quality });
    }
    result.set(key, choose(votes));
  }
  return result;
}
