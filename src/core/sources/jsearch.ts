import { z } from 'zod';
import { htmlToText } from '../util/text.js';
import { rankApplyOptions } from './apply-options.js';
import { cleanText, inferRemoteType, toUtcIso } from './normalize.js';
import type { SearchAdapter, SearchHit } from './search.js';
import type { ApplyOption } from './types.js';

/**
 * JSearch (OpenWeb Ninja), the Google-for-Jobs index. Free tier is 200
 * requests/month and needs `JSEARCH_API_KEY`. This shape follows the vendor's
 * published `data[]` job object, checked against the live responses recorded
 * in `tests/fixtures/jsearch-search.json` and `jsearch-details.json` (J29).
 */

const jobSchema = z
  .object({
    job_id: z.string().min(1),
    job_title: z.string().trim().min(1),
    employer_name: z.string().trim().min(1),
    job_apply_link: z.string().trim().min(1).optional(),
    job_google_link: z.string().optional(),
    job_publisher: z.string().nullable().optional(),
    job_apply_is_direct: z.boolean().nullable().optional(),
    apply_options: z.array(z.unknown()).nullable().optional(),
    job_description: z.string().nullable().optional(),
    job_city: z.string().nullable().optional(),
    job_state: z.string().nullable().optional(),
    job_country: z.string().nullable().optional(),
    job_is_remote: z.boolean().optional(),
    job_posted_at_datetime_utc: z.string().nullable().optional(),
    job_min_salary: z.number().nullable().optional(),
    job_max_salary: z.number().nullable().optional(),
    job_salary_currency: z.string().nullable().optional(),
    job_employment_type: z.string().nullable().optional(),
    employer_website: z.string().trim().min(1).nullable().optional(),
  })
  .passthrough();

type JsearchJob = z.infer<typeof jobSchema>;

const httpUrl = z
  .string()
  .trim()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), 'not an http(s) link');

const applyOptionSchema = z.object({
  publisher: z.string().trim().min(1),
  apply_link: httpUrl,
  is_direct: z.boolean().nullable().optional(),
});

const responseSchema = z
  .object({
    data: z.array(z.unknown()).optional(),
  })
  .passthrough();

/**
 * OpenWeb Ninja's search often takes longer than the shared 15s client
 * timeout, and this adapter does not retry (a retry would bill another call).
 * D176.
 */
export const JSEARCH_TIMEOUT_MS = 45_000;

export function jsearchUrl(query: string, page: number): string {
  const params = new URLSearchParams({
    query,
    page: String(page),
    num_pages: '1',
    date_posted: 'month',
  });
  return `https://api.openwebninja.com/jsearch/search?${params.toString()}`;
}

/** One job's details, apply options included. The vendor bills each job id as a call. */
export function jsearchDetailsUrl(jobId: string): string {
  return `https://api.openwebninja.com/jsearch/job-details?${new URLSearchParams({ job_id: jobId }).toString()}`;
}

/**
 * A job's apply options. A malformed option is dropped, not the job. The
 * primary link (`job_apply_link`) leads the list when the options don't
 * already carry it. Null when JSearch sent no `apply_options` at all.
 */
export function applyOptionsOf(row: JsearchJob): ApplyOption[] | null {
  if (row.apply_options == null) return null;
  const options: ApplyOption[] = [];
  const seen = new Set<string>();
  for (const item of row.apply_options) {
    const parsed = applyOptionSchema.safeParse(item);
    if (!parsed.success || seen.has(parsed.data.apply_link)) continue;
    seen.add(parsed.data.apply_link);
    options.push({
      publisher: parsed.data.publisher,
      url: parsed.data.apply_link,
      direct: parsed.data.is_direct === true,
    });
  }
  const primary = row.job_apply_link ? httpUrl.safeParse(row.job_apply_link) : undefined;
  const publisher = cleanText(row.job_publisher ?? null);
  if (primary?.success && publisher && !seen.has(primary.data)) {
    options.unshift({ publisher, url: primary.data, direct: row.job_apply_is_direct === true });
  }
  return options;
}

function toHit(row: JsearchJob): SearchHit | null {
  const location = [row.job_city, row.job_state, row.job_country].filter(Boolean).join(', ');
  const locationRaw = cleanText(location);
  const url = row.job_apply_link || row.job_google_link || '';
  if (!url) return null;
  const applyOptions = applyOptionsOf(row);
  const companyName = cleanText(row.employer_name) ?? row.employer_name;
  return {
    companyName,
    posting: {
      ats: 'jsearch',
      externalId: row.job_id,
      title: cleanText(row.job_title) ?? row.job_title,
      locationRaw,
      remoteType: inferRemoteType({
        workplaceType: row.job_is_remote ? 'remote' : null,
        location: locationRaw,
      }),
      employmentType: row.job_employment_type ? row.job_employment_type.toLowerCase() : null,
      url,
      applyUrl: rankApplyOptions(applyOptions, row.job_apply_link ?? url, companyName),
      applyOptions,
      descriptionText: htmlToText(row.job_description ?? ''),
      compMin: money(row.job_min_salary),
      compMax: money(row.job_max_salary),
      compCurrency: cleanText(row.job_salary_currency)?.toUpperCase() ?? null,
      postedAt: toUtcIso(row.job_posted_at_datetime_utc),
      companyWebsite: cleanText(row.employer_website),
    },
  };
}

function listings(raw: unknown): unknown[] {
  const body = responseSchema.safeParse(raw);
  if (!body.success) throw new Error('JSearch response did not parse');
  if (body.data.data === undefined) throw new Error('JSearch response had no listings');
  return body.data.data;
}

export function parseJsearch(raw: unknown): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const item of listings(raw)) {
    const job = jobSchema.safeParse(item);
    if (!job.success) continue;
    const hit = toHit(job.data);
    if (hit) hits.push(hit);
  }
  return hits;
}

/** What a job-details call says about one job's apply links. */
export interface JsearchDetails {
  jobId: string;
  applyLink: string | null;
  /** [] when the job came back with no options. */
  options: ApplyOption[];
}

/**
 * A job-details response, one entry per job that came back. An empty `data`
 * (the job id expired) is an empty list, not an error.
 */
export function parseJsearchDetails(raw: unknown): JsearchDetails[] {
  const out: JsearchDetails[] = [];
  for (const item of listings(raw)) {
    const job = jobSchema.safeParse(item);
    if (!job.success) continue;
    out.push({
      jobId: job.data.job_id,
      applyLink: job.data.job_apply_link ?? null,
      options: applyOptionsOf(job.data) ?? [],
    });
  }
  return out;
}

function money(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value);
}

export const jsearchAdapter: SearchAdapter = {
  kind: 'search',
  name: 'jsearch',
  needsKey: true,
  costPerCall: 0,

  async search(query, ctx): Promise<SearchHit[]> {
    if (!ctx.key) throw new Error('jsearch requires JSEARCH_API_KEY');
    if (!ctx.charge()) return [];
    const text = [query.titles.join(' '), query.remoteOnly ? 'remote' : '', query.location ?? '']
      .filter(Boolean)
      .join(' ');
    const raw = await ctx.http.getJson(jsearchUrl(text, query.page ?? 1), {
      headers: { 'x-api-key': ctx.key },
      maxTries: 1,
      timeoutMs: JSEARCH_TIMEOUT_MS,
    });
    return parseJsearch(raw);
  },
};
