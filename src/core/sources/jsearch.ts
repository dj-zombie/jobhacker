import { z } from 'zod';
import { htmlToText } from '../util/text.js';
import { cleanText, inferRemoteType, toUtcIso } from './normalize.js';
import type { SearchAdapter, SearchHit } from './search.js';

/**
 * JSearch (OpenWeb Ninja), the Google-for-Jobs index. Free tier is 200
 * requests/month and needs `JSEARCH_API_KEY`. This shape follows the vendor's
 * published `data[]` job object. There is no recorded live fixture: no key
 * is configured, and signing up is Kris's call.
 */

const jobSchema = z
  .object({
    job_id: z.string().min(1),
    job_title: z.string().trim().min(1),
    employer_name: z.string().trim().min(1),
    job_apply_link: z.string().trim().min(1).optional(),
    job_google_link: z.string().optional(),
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

const responseSchema = z
  .object({
    data: z.array(z.unknown()).optional(),
  })
  .passthrough();

export function jsearchUrl(query: string, page: number): string {
  const params = new URLSearchParams({
    query,
    page: String(page),
    num_pages: '1',
    date_posted: 'month',
  });
  return `https://api.openwebninja.com/jsearch/search?${params.toString()}`;
}

export function parseJsearch(raw: unknown): SearchHit[] {
  const body = responseSchema.safeParse(raw);
  if (!body.success) throw new Error('JSearch response did not parse');
  if (body.data.data === undefined) throw new Error('JSearch response had no listings');
  const hits: SearchHit[] = [];
  for (const item of body.data.data) {
    const job = jobSchema.safeParse(item);
    if (!job.success) continue;
    const row = job.data;
    const location = [row.job_city, row.job_state, row.job_country].filter(Boolean).join(', ');
    const locationRaw = cleanText(location);
    const url = row.job_apply_link || row.job_google_link || '';
    if (!url) continue;
    hits.push({
      companyName: cleanText(row.employer_name) ?? row.employer_name,
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
        applyUrl: row.job_apply_link ?? url,
        descriptionText: htmlToText(row.job_description ?? ''),
        compMin: money(row.job_min_salary),
        compMax: money(row.job_max_salary),
        compCurrency: cleanText(row.job_salary_currency)?.toUpperCase() ?? null,
        postedAt: toUtcIso(row.job_posted_at_datetime_utc),
        companyWebsite: cleanText(row.employer_website),
      },
    });
  }
  return hits;
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
    });
    return parseJsearch(raw);
  },
};
