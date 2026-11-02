import { z } from 'zod';
import type { Http } from '../util/http.js';
import { cleanText, inferRemoteType, mapEmployment, toUtcIso } from './normalize.js';
import { boardError, collectPostings } from './parse.js';
import { boardToken } from './token.js';
import type { CompanyRef, NormalizedPosting, ParsedBoard, SourceAdapter } from './types.js';

/**
 * Workable Job Board API. Per-account bearer token (`WORKABLE_API_KEY`).
 * The list shape follows Workable's published SPI v3. There is no live
 * fixture until a key exists.
 */

const postingSchema = z
  .object({
    id: z.union([z.string().min(1), z.number().int()]),
    title: z.string().trim().min(1),
    url: z.string().trim().min(1).optional(),
    application_url: z.string().trim().min(1).optional(),
    shortcode: z.string().optional(),
    department: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    location: z
      .object({
        location_str: z.string().nullable().optional(),
        telecommuting: z.boolean().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

const pageSchema = z
  .object({
    jobs: z.array(z.unknown()),
    paging: z.object({ next: z.string().nullable().optional() }).passthrough().optional(),
  })
  .passthrough();

export type WorkablePosting = z.infer<typeof postingSchema>;

export function workableBoardUrl(token: string): string {
  return `https://www.workable.com/spi/v3/accounts/${encodeURIComponent(boardToken(token))}/jobs`;
}

export const workableAdapter: SourceAdapter<WorkablePosting> = {
  kind: 'board',
  needsKey: true,
  ats: 'workable',

  async fetchBoard(token: string, http: Http, key?: string): Promise<unknown> {
    if (!key) throw new Error('workable board requires WORKABLE_API_KEY');
    const headers = { authorization: `Bearer ${key}` };
    const jobs: unknown[] = [];
    let url: string | undefined = workableBoardUrl(token);
    for (let page = 0; url && page < 20; page++) {
      const raw = await http.getJson(url, { headers, maxTries: 1 });
      const parsed = pageSchema.safeParse(raw);
      if (!parsed.success) return raw;
      jobs.push(...parsed.data.jobs);
      url = parsed.data.paging?.next ?? undefined;
    }
    return { jobs };
  },

  parse(raw: unknown): ParsedBoard<WorkablePosting> {
    const board = pageSchema.safeParse(raw);
    if (!board.success) throw boardError('workable', board.error);
    return collectPostings('workable', board.data.jobs, postingSchema);
  },

  normalize(posting: WorkablePosting, company: CompanyRef): NormalizedPosting {
    if (company.ats !== 'workable') {
      throw new Error(`workable adapter cannot normalize a ${company.ats} company`);
    }
    const locationRaw = cleanText(posting.location?.location_str);
    const url =
      posting.application_url ||
      posting.url ||
      `https://apply.workable.com/${encodeURIComponent(company.token)}/j/${posting.shortcode ?? posting.id}`;
    return {
      ats: 'workable',
      externalId: String(posting.id),
      title: cleanText(posting.title) ?? posting.title,
      locationRaw,
      remoteType: inferRemoteType({
        workplaceType: posting.location?.telecommuting ? 'remote' : null,
        location: locationRaw,
      }),
      employmentType: mapEmployment(null),
      url,
      applyUrl: url,
      descriptionText: [locationRaw, posting.department]
        .map((part) => cleanText(part ?? undefined))
        .filter((part): part is string => Boolean(part))
        .join('\n'),
      compMin: null,
      compMax: null,
      compCurrency: null,
      postedAt: toUtcIso(posting.created_at),
    };
  },
};
