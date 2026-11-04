import { z } from 'zod';
import { REMOTE_AREA } from '../config/schemas.js';
import { htmlToText } from '../util/text.js';
import { cleanText, inferRemoteType, toUtcIso } from './normalize.js';
import { SEARCH_SINCE_DAYS } from './query-gen.js';
import type { SearchAdapter, SearchHit, SearchQuery } from './search.js';

/**
 * JobsPipe, a licensed aggregator. One credit per new job per calendar month,
 * not per call. The free plan returns at most 25 jobs a call. `include_technologies`
 * is never sent: it costs another credit per job.
 *
 * `recruiter_emails` and `applicant_count` are never read. Pay is mapped only
 * when `salary_type` is `observed`.
 */

export const JOBSPIPE_SEARCH_URL = 'https://api.jobspipe.dev/v1/jobs/search';

/** The free plan's page size. A higher limit is capped by JobsPipe, so don't ask for more. */
export const JOBSPIPE_PAGE_LIMIT = 25;

const sourceSchema = z
  .object({
    provider: z.string().optional(),
  })
  .passthrough();

const companyObjectSchema = z
  .object({
    name: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
  })
  .passthrough();

const jobSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    job_title: z.string().nullable().optional(),
    company: z.string().nullable().optional(),
    company_domain: z.string().nullable().optional(),
    company_object: companyObjectSchema.nullable().optional(),
    url: z.string().nullable().optional(),
    source_url: z.string().nullable().optional(),
    sources: z.array(sourceSchema).optional(),
    location: z.string().nullable().optional(),
    cities: z.array(z.string()).nullable().optional(),
    state_code: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    remote: z.boolean().nullable().optional(),
    work_arrangement: z.string().nullable().optional(),
    employment_statuses: z.array(z.string()).nullable().optional(),
    salary_type: z.string().nullable().optional(),
    min_annual_salary: z.number().nullable().optional(),
    max_annual_salary: z.number().nullable().optional(),
    salary_currency: z.string().nullable().optional(),
    date_posted: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
  })
  .passthrough();

const responseSchema = z
  .object({
    metadata: z
      .object({
        credits_charged: z.number(),
        credits_remaining: z.number(),
      })
      .passthrough(),
    data: z.array(z.unknown()).optional(),
  })
  .passthrough();

export interface JobspipeParsed {
  hits: SearchHit[];
  skipped: string[];
  credits_charged: number;
  credits_remaining: number;
}

/** The JSON body for one JobsPipe search. Never includes `include_technologies`. */
export function jobspipeBody(query: SearchQuery, limit: number): Record<string, unknown> {
  const body: Record<string, unknown> = {
    job_title_or: query.titles,
    posted_at_max_age_days: SEARCH_SINCE_DAYS,
    limit,
    order_by: [{ field: 'posted_at', desc: true }],
  };
  if (query.area === REMOTE_AREA) {
    body.remote = true;
    body.job_country_code_or = query.remoteCountries ?? [];
    return body;
  }
  body.city_or = query.cities ?? [];
  body.region_or = query.regions ?? [];
  body.job_country_code_or = ['US'];
  return body;
}

export function parseJobspipe(raw: unknown): JobspipeParsed {
  const body = responseSchema.safeParse(raw);
  if (!body.success) throw new Error('JobsPipe response did not parse');
  if (body.data.data === undefined) throw new Error('JobsPipe response had no listings');
  const hits: SearchHit[] = [];
  const skipped: string[] = [];
  for (const item of body.data.data) {
    const job = jobSchema.safeParse(item);
    if (!job.success) {
      skipped.push('posting did not parse');
      continue;
    }
    const mapped = mapJob(job.data);
    if (mapped.skip) {
      skipped.push(mapped.skip);
      continue;
    }
    if (mapped.hit) hits.push(mapped.hit);
  }
  return {
    hits,
    skipped,
    credits_charged: body.data.metadata.credits_charged,
    credits_remaining: body.data.metadata.credits_remaining,
  };
}

function mapJob(row: z.infer<typeof jobSchema>): { hit?: SearchHit; skip?: string } {
  const id = String(row.id).trim();
  const provider = cleanText(row.sources?.[0]?.provider);
  if (!provider || !id) return { skip: `no source (${id || 'unknown'})` };
  const externalId = `${provider}:${id}`;
  const companyName = cleanText(row.company) ?? cleanText(row.company_object?.name);
  if (!companyName) return { skip: `no company (${externalId})` };
  const title = cleanText(row.job_title);
  if (!title) return { skip: `no job title (${externalId})` };
  const url = cleanText(row.url) ?? cleanText(row.source_url);
  const applyUrl = cleanText(row.source_url) ?? url;
  if (!url) return { skip: `no url (${externalId})` };
  const locationRaw = locationOf(row);
  const observed = row.salary_type === 'observed';
  return {
    hit: {
      companyName,
      posting: {
        ats: 'jobspipe',
        externalId,
        title,
        locationRaw,
        remoteType: remoteOf(row, locationRaw),
        employmentType: cleanText(row.employment_statuses?.[0] ?? null),
        url,
        applyUrl,
        descriptionText: htmlToText(row.description ?? ''),
        compMin: observed ? money(row.min_annual_salary) : null,
        compMax: observed ? money(row.max_annual_salary) : null,
        compCurrency: observed ? (cleanText(row.salary_currency)?.toUpperCase() ?? null) : null,
        postedAt: toUtcIso(row.date_posted),
        companyWebsite: websiteOf(row),
      },
    },
  };
}

function locationOf(row: z.infer<typeof jobSchema>): string | null {
  const direct = cleanText(row.location);
  if (direct) return direct;
  const city = row.cities?.map((value) => cleanText(value)).find((value) => value);
  const parts = [city, cleanText(row.state_code), cleanText(row.country)].filter(Boolean);
  return cleanText(parts.join(', '));
}

function remoteOf(row: z.infer<typeof jobSchema>, locationRaw: string | null) {
  const arrangement = cleanText(row.work_arrangement);
  if (arrangement) return inferRemoteType({ workplaceType: arrangement, location: locationRaw });
  if (row.remote === true) return 'remote' as const;
  return inferRemoteType({ location: locationRaw });
}

function websiteOf(row: z.infer<typeof jobSchema>): string | null {
  const site = cleanText(row.company_object?.url);
  if (site) return site;
  const domain = cleanText(row.company_domain);
  if (!domain) return null;
  if (/^https?:\/\//i.test(domain)) return domain;
  return `https://${domain}`;
}

function money(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value);
}

export const jobspipeAdapter: SearchAdapter = {
  kind: 'search',
  name: 'jobspipe',
  needsKey: true,
  costPerCall: 0,

  async search(query, ctx): Promise<SearchHit[]> {
    if (!ctx.key) throw new Error('jobspipe requires JOBSPIPE_API_KEY');
    const left = ctx.creditsLeft?.() ?? 0;
    const limit = Math.min(JOBSPIPE_PAGE_LIMIT, left);
    if (limit < 1) {
      ctx.stopForCredits?.();
      return [];
    }
    if (!ctx.charge()) return [];
    const post = ctx.http.postJson.bind(ctx.http);
    const raw = await post(JOBSPIPE_SEARCH_URL, jobspipeBody(query, limit), {
      headers: { authorization: `Bearer ${ctx.key}` },
    });
    const parsed = parseJobspipe(raw);
    ctx.recordCredits?.(parsed.credits_charged, parsed.credits_remaining);
    for (const reason of parsed.skipped) ctx.noteSkipped?.(reason);
    return parsed.hits;
  },
};
