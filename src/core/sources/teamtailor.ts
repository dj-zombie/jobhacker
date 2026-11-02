import { z } from 'zod';
import type { Http } from '../util/http.js';
import { cleanText, inferRemoteType, richTextToPlain, toUtcIso } from './normalize.js';
import { boardError, collectPostings } from './parse.js';
import type { CompanyRef, NormalizedPosting, ParsedBoard, SourceAdapter } from './types.js';

/**
 * Teamtailor JSON:API. Per-tenant token (`TEAMTAILOR_API_KEY`). The published
 * list is `GET https://api.teamtailor.com/v1/jobs` with `Authorization: Token
 * token=…` and `X-Api-Version`. The company token is recorded but the API
 * identifies the tenant by the key. No live fixture until a key exists.
 */

const postingSchema = z
  .object({
    id: z.union([z.string().min(1), z.number().int()]),
    attributes: z
      .object({
        title: z.string().trim().min(1),
        body: z.string().nullable().optional(),
        pitch: z.string().nullable().optional(),
        'remote-status': z.string().nullable().optional(),
      })
      .passthrough(),
    links: z.object({ 'careersite-job-url': z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

const pageSchema = z
  .object({
    data: z.array(z.unknown()),
    links: z.object({ next: z.string().nullable().optional() }).passthrough().optional(),
  })
  .passthrough();

export type TeamtailorPosting = z.infer<typeof postingSchema>;

export const TEAMTAILOR_JOBS_URL = 'https://api.teamtailor.com/v1/jobs?page[size]=30';

export const teamtailorAdapter: SourceAdapter<TeamtailorPosting> = {
  kind: 'board',
  needsKey: true,
  ats: 'teamtailor',

  async fetchBoard(_token: string, http: Http, key?: string): Promise<unknown> {
    if (!key) throw new Error('teamtailor board requires TEAMTAILOR_API_KEY');
    const headers = {
      authorization: `Token token=${key}`,
      'x-api-version': '20240404',
    };
    const data: unknown[] = [];
    let url: string | undefined = TEAMTAILOR_JOBS_URL;
    for (let page = 0; url && page < 20; page++) {
      const raw = await http.getJson(url, { headers, maxTries: 1 });
      const parsed = pageSchema.safeParse(raw);
      if (!parsed.success) return raw;
      data.push(...parsed.data.data);
      url = parsed.data.links?.next ?? undefined;
    }
    return { data };
  },

  parse(raw: unknown): ParsedBoard<TeamtailorPosting> {
    const board = pageSchema.safeParse(raw);
    if (!board.success) throw boardError('teamtailor', board.error);
    return collectPostings('teamtailor', board.data.data, postingSchema);
  },

  normalize(posting: TeamtailorPosting, company: CompanyRef): NormalizedPosting {
    if (company.ats !== 'teamtailor') {
      throw new Error(`teamtailor adapter cannot normalize a ${company.ats} company`);
    }
    const remote = posting.attributes['remote-status'];
    const url =
      posting.links?.['careersite-job-url'] || `https://career.teamtailor.com/jobs/${posting.id}`;
    return {
      ats: 'teamtailor',
      externalId: String(posting.id),
      title: cleanText(posting.attributes.title) ?? posting.attributes.title,
      locationRaw: null,
      remoteType: inferRemoteType({ workplaceType: remote }),
      employmentType: null,
      url,
      applyUrl: url,
      descriptionText: richTextToPlain(posting.attributes.body ?? posting.attributes.pitch ?? ''),
      compMin: null,
      compMax: null,
      compCurrency: null,
      postedAt: toUtcIso(null),
    };
  },
};
