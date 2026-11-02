import { z } from 'zod';
import type { Http } from '../util/http.js';
import { cleanText, inferRemoteType, mapEmployment, toUtcIso } from './normalize.js';
import { collectPostings } from './parse.js';
import { boardToken } from './token.js';
import { BoardParseError } from './types.js';
import type { CompanyRef, NormalizedPosting, ParsedBoard, SourceAdapter } from './types.js';

/**
 * Breezy's keyless portal feed, `https://{token}.breezy.hr/json`. It is a JSON
 * array and it does not include the posting body. Schema written from a live
 * RhynoCare board on 2026-10-23 (`tests/fixtures/breezy-rhynocare.json`).
 * An unknown subdomain is HTTP 404 HTML, which the HTTP client rejects.
 */

const postingSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1),
    url: z.string().trim().min(1),
    published_date: z.string().nullable().optional(),
    salary: z.string().nullable().optional(),
    department: z.string().nullable().optional(),
    type: z.object({ name: z.string().nullable().optional() }).passthrough().nullable().optional(),
    location: z
      .object({
        name: z.string().nullable().optional(),
        is_remote: z.boolean().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    company: z
      .object({ name: z.string().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

export type BreezyPosting = z.infer<typeof postingSchema>;

export function breezyBoardUrl(token: string): string {
  return `https://${encodeURIComponent(boardToken(token))}.breezy.hr/json`;
}

export const breezyAdapter: SourceAdapter<BreezyPosting> = {
  kind: 'board',
  needsKey: false,
  ats: 'breezy',

  async fetchBoard(token: string, http: Http): Promise<unknown> {
    return http.getJson(breezyBoardUrl(token));
  },

  parse(raw: unknown): ParsedBoard<BreezyPosting> {
    if (!Array.isArray(raw)) {
      throw new BoardParseError('breezy board payload is not a list');
    }
    return collectPostings('breezy', raw, postingSchema);
  },

  normalize(posting: BreezyPosting, company: CompanyRef): NormalizedPosting {
    if (company.ats !== 'breezy') {
      throw new Error(`breezy adapter cannot normalize a ${company.ats} company`);
    }
    const locationRaw = cleanText(posting.location?.name);
    const workplace = posting.location?.is_remote ? 'remote' : null;
    return {
      ats: 'breezy',
      externalId: posting.id,
      title: cleanText(posting.name) ?? posting.name,
      locationRaw,
      remoteType: inferRemoteType({ workplaceType: workplace, location: locationRaw }),
      employmentType: mapEmployment(posting.type?.name),
      url: posting.url,
      applyUrl: posting.url,
      descriptionText: [locationRaw, posting.department, posting.salary, posting.type?.name]
        .map((part) => cleanText(part ?? undefined))
        .filter((part): part is string => Boolean(part))
        .join('\n'),
      compMin: null,
      compMax: null,
      compCurrency: null,
      postedAt: toUtcIso(posting.published_date),
    };
  },
};

export function breezyCompanyName(raw: unknown): string | undefined {
  if (!Array.isArray(raw)) return undefined;
  for (const item of raw) {
    const posting = postingSchema.safeParse(item);
    const name = posting.success ? cleanText(posting.data.company?.name) : null;
    if (name) return name;
  }
  return undefined;
}
