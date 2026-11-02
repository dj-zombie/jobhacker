import { z } from 'zod';
import type { Http } from '../util/http.js';
import { cleanText, inferRemoteType, mapEmployment, toUtcIso } from './normalize.js';
import { boardError, collectPostings } from './parse.js';
import { boardToken } from './token.js';
import type { CompanyRef, NormalizedPosting, ParsedBoard, SourceAdapter } from './types.js';

/**
 * SmartRecruiters public Posting API. No key. The list payload has no job
 * body — descriptions live on a second per-posting call, which a 1 req/s
 * scout cannot afford — so the stored text is the fields the list actually
 * returns. Schema written from a live `smartrecruiters` board on 2026-10-23
 * (`tests/fixtures/smartrecruiters-smartrecruiters.json`).
 */

const postingSchema = z
  .object({
    id: z.union([z.string().min(1), z.number().int()]),
    name: z.string().trim().min(1),
    releasedDate: z.string().nullable().optional(),
    typeOfEmployment: z
      .object({ label: z.string().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
    location: z
      .object({
        fullLocation: z.string().nullable().optional(),
        city: z.string().nullable().optional(),
        region: z.string().nullable().optional(),
        remote: z.boolean().optional(),
        hybrid: z.boolean().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    company: z
      .object({
        identifier: z.string().nullable().optional(),
        name: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    department: z
      .object({ label: z.string().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

const pageSchema = z
  .object({
    totalFound: z.number().int().nonnegative(),
    content: z.array(z.unknown()),
  })
  .passthrough();

export type SmartRecruitersPosting = z.infer<typeof postingSchema>;

const PAGE = 100;

export function smartRecruitersBoardUrl(token: string, offset: number): string {
  const id = encodeURIComponent(boardToken(token));
  return `https://api.smartrecruiters.com/v1/companies/${id}/postings?limit=${PAGE}&offset=${offset}`;
}

export const smartRecruitersAdapter: SourceAdapter<SmartRecruitersPosting> = {
  kind: 'board',
  needsKey: false,
  ats: 'smartrecruiters',

  async fetchBoard(token: string, http: Http): Promise<unknown> {
    const content: unknown[] = [];
    let offset = 0;
    let total = 0;
    for (;;) {
      const page = await http.getJson(smartRecruitersBoardUrl(token, offset));
      const parsed = pageSchema.safeParse(page);
      if (!parsed.success) return page;
      content.push(...parsed.data.content);
      total = parsed.data.totalFound;
      offset += parsed.data.content.length;
      if (parsed.data.content.length === 0 || offset >= total || offset > 2000) break;
    }
    return { totalFound: total, content };
  },

  parse(raw: unknown): ParsedBoard<SmartRecruitersPosting> {
    const board = pageSchema.safeParse(raw);
    if (!board.success) throw boardError('smartrecruiters', board.error);
    return collectPostings('smartrecruiters', board.data.content, postingSchema);
  },

  normalize(posting: SmartRecruitersPosting, company: CompanyRef): NormalizedPosting {
    if (company.ats !== 'smartrecruiters') {
      throw new Error(`smartrecruiters adapter cannot normalize a ${company.ats} company`);
    }
    const locationRaw = cleanText(posting.location?.fullLocation ?? posting.location?.city);
    const identifier = posting.company?.identifier || company.token;
    const url = `https://jobs.smartrecruiters.com/${encodeURIComponent(identifier)}/${encodeURIComponent(String(posting.id))}`;
    const workplace = posting.location?.remote
      ? 'remote'
      : posting.location?.hybrid
        ? 'hybrid'
        : null;
    return {
      ats: 'smartrecruiters',
      externalId: String(posting.id),
      title: cleanText(posting.name) ?? posting.name,
      locationRaw,
      remoteType: inferRemoteType({ workplaceType: workplace, location: locationRaw }),
      employmentType: mapEmployment(posting.typeOfEmployment?.label),
      url,
      applyUrl: url,
      descriptionText: [locationRaw, posting.department?.label, posting.typeOfEmployment?.label]
        .map((part) => cleanText(part ?? undefined))
        .filter((part): part is string => Boolean(part))
        .join('\n'),
      compMin: null,
      compMax: null,
      compCurrency: null,
      postedAt: toUtcIso(posting.releasedDate),
    };
  },
};

export function smartRecruitersCompanyName(raw: unknown): string | undefined {
  const board = pageSchema.safeParse(raw);
  if (!board.success) return undefined;
  for (const item of board.data.content) {
    const posting = postingSchema.safeParse(item);
    const name = posting.success ? cleanText(posting.data.company?.name) : null;
    if (name) return name;
  }
  return undefined;
}
