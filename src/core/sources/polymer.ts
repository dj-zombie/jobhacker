import { z } from 'zod';
import type { Http } from '../util/http.js';
import { cleanText, inferRemoteType, mapEmployment, toUtcIso } from './normalize.js';
import { boardError, collectPostings } from './parse.js';
import { boardToken } from './token.js';
import type { CompanyRef, NormalizedPosting, ParsedBoard, SourceAdapter } from './types.js';

/**
 * Polymer public hire API. No key. The list omits `description` (that field is
 * on the per-job call). Schema written from a live `aperturelabs` response on
 * 2026-10-23 (`tests/fixtures/polymer-aperturelabs.json`).
 */

const postingSchema = z
  .object({
    id: z.union([z.number().int(), z.string().min(1)]),
    title: z.string().trim().min(1),
    job_post_url: z.string().trim().min(1),
    display_location: z.string().nullable().optional(),
    remoteness_pretty: z.string().nullable().optional(),
    kind_pretty: z.string().nullable().optional(),
    job_category_name: z.string().nullable().optional(),
    salary_pretty: z.string().nullable().optional(),
    organization_name: z.string().nullable().optional(),
    published_at: z.string().nullable().optional(),
  })
  .passthrough();

const pageSchema = z
  .object({
    items: z.array(z.unknown()),
    meta: z
      .object({
        organization_name: z.string().nullable().optional(),
        is_last: z.boolean().optional(),
        next_page: z.number().int().nullable().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type PolymerPosting = z.infer<typeof postingSchema>;

export function polymerBoardUrl(token: string, page?: number): string {
  const id = encodeURIComponent(boardToken(token));
  const base = `https://api.polymer.co/v1/hire/organizations/${id}/jobs`;
  return page && page > 1 ? `${base}?page=${page}` : base;
}

export const polymerAdapter: SourceAdapter<PolymerPosting> = {
  kind: 'board',
  needsKey: false,
  ats: 'polymer',

  async fetchBoard(token: string, http: Http): Promise<unknown> {
    const items: unknown[] = [];
    let page = 1;
    let organization: string | undefined;
    for (;;) {
      const raw = await http.getJson(polymerBoardUrl(token, page));
      const parsed = pageSchema.safeParse(raw);
      if (!parsed.success) return raw;
      items.push(...parsed.data.items);
      organization = parsed.data.meta?.organization_name ?? organization;
      const next = parsed.data.meta?.next_page;
      if (parsed.data.meta?.is_last !== false || next == null || page > 20) {
        return { items, meta: { organization_name: organization, is_last: true } };
      }
      page = next;
    }
  },

  parse(raw: unknown): ParsedBoard<PolymerPosting> {
    const board = pageSchema.safeParse(raw);
    if (!board.success) throw boardError('polymer', board.error);
    return collectPostings('polymer', board.data.items, postingSchema);
  },

  normalize(posting: PolymerPosting, company: CompanyRef): NormalizedPosting {
    if (company.ats !== 'polymer') {
      throw new Error(`polymer adapter cannot normalize a ${company.ats} company`);
    }
    const locationRaw = cleanText(posting.display_location);
    const remoteLabel = posting.remoteness_pretty ?? '';
    const workplace = /no remote/i.test(remoteLabel)
      ? 'onsite'
      : /hybrid/i.test(remoteLabel)
        ? 'hybrid'
        : /remote/i.test(remoteLabel)
          ? 'remote'
          : null;
    return {
      ats: 'polymer',
      externalId: String(posting.id),
      title: cleanText(posting.title) ?? posting.title,
      locationRaw,
      remoteType: inferRemoteType({ workplaceType: workplace, location: locationRaw }),
      employmentType: mapEmployment(posting.kind_pretty),
      url: posting.job_post_url,
      applyUrl: posting.job_post_url,
      descriptionText: [
        locationRaw,
        posting.job_category_name,
        posting.salary_pretty,
        posting.kind_pretty,
      ]
        .map((part) => cleanText(part ?? undefined))
        .filter((part): part is string => Boolean(part))
        .join('\n'),
      compMin: null,
      compMax: null,
      compCurrency: null,
      postedAt: toUtcIso(posting.published_at),
    };
  },
};

export function polymerCompanyName(raw: unknown): string | undefined {
  const board = pageSchema.safeParse(raw);
  if (!board.success) return undefined;
  const fromMeta = cleanText(board.data.meta?.organization_name);
  if (fromMeta) return fromMeta;
  for (const item of board.data.items) {
    const posting = postingSchema.safeParse(item);
    const name = posting.success ? cleanText(posting.data.organization_name) : null;
    if (name) return name;
  }
  return undefined;
}
