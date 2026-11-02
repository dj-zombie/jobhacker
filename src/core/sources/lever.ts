import { z } from 'zod';
import type { Http } from '../util/http.js';
import {
  cleanLine,
  cleanText,
  inferRemoteType,
  normalizeEmployment,
  plainOrHtml,
  richTextToPlain,
  toUtcIso,
} from './normalize.js';
import { boardError, collectPostings } from './parse.js';
import { boardToken } from './token.js';
import type { CompanyRef, NormalizedPosting, ParsedBoard, SourceAdapter } from './types.js';

/**
 * Lever public postings. Schema written against a live
 * `postings/spotify?mode=json` response on 2026-10-22 (fixture
 * `tests/fixtures/lever-spotify.json`).
 *
 * The list is the whole payload. `text` is the title. `workplaceType` is
 * `remote | hybrid | onsite`. Description lists are separate from
 * `descriptionPlain`, so they are appended. No structured salary was present.
 */

const leverListSchema = z
  .object({
    text: z.string().nullable().optional(),
    content: z.string().nullable().optional(),
  })
  .passthrough();

const leverJobSchema = z
  .object({
    id: z.string().trim().min(1),
    text: z.string().trim().min(1),
    hostedUrl: z.string().trim().min(1),
    applyUrl: z.string().nullable().optional(),
    createdAt: z.number().nullable().optional(),
    workplaceType: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    descriptionPlain: z.string().nullable().optional(),
    additional: z.string().nullable().optional(),
    additionalPlain: z.string().nullable().optional(),
    lists: z.array(leverListSchema).nullable().optional(),
    categories: z
      .object({
        commitment: z.string().nullable().optional(),
        location: z.string().nullable().optional(),
        allLocations: z.array(z.string()).nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

const leverBoardSchema = z.array(z.unknown());

export type LeverJob = z.infer<typeof leverJobSchema>;

export function leverBoardUrl(token: string): string {
  return `https://api.lever.co/v0/postings/${encodeURIComponent(boardToken(token))}?mode=json`;
}

function descriptionText(posting: LeverJob): string {
  const parts: string[] = [];
  const body = plainOrHtml(posting.descriptionPlain, posting.description);
  if (body) parts.push(body);
  for (const list of posting.lists ?? []) {
    const heading = cleanLine(list.text);
    const items = list.content ? richTextToPlain(list.content) : '';
    if (heading && items) parts.push(`${heading}\n${items}`);
    else if (heading) parts.push(heading);
    else if (items) parts.push(items);
  }
  const extra = plainOrHtml(posting.additionalPlain, posting.additional);
  if (extra) parts.push(extra);
  return parts.join('\n\n');
}

export const leverAdapter: SourceAdapter<LeverJob> = {
  kind: 'board',
  needsKey: false,
  ats: 'lever',

  async fetchBoard(token: string, http: Http): Promise<unknown> {
    return http.getJson(leverBoardUrl(token));
  },

  parse(raw: unknown): ParsedBoard<LeverJob> {
    const board = leverBoardSchema.safeParse(raw);
    if (!board.success) throw boardError('lever', board.error);
    return collectPostings('lever', board.data, leverJobSchema);
  },

  normalize(posting: LeverJob, company: CompanyRef): NormalizedPosting {
    if (company.ats !== 'lever') {
      throw new Error(`lever adapter cannot normalize a ${company.ats} company`);
    }
    const locationRaw = cleanText(posting.categories?.location);
    return {
      ats: 'lever',
      externalId: posting.id,
      title: cleanText(posting.text) ?? posting.text,
      locationRaw,
      remoteType: inferRemoteType({
        workplaceType: posting.workplaceType,
        location: locationRaw,
      }),
      employmentType: normalizeEmployment(posting.categories?.commitment),
      url: posting.hostedUrl,
      applyUrl: cleanLine(posting.applyUrl),
      descriptionText: descriptionText(posting),
      compMin: null,
      compMax: null,
      compCurrency: null,
      postedAt: toUtcIso(posting.createdAt),
    };
  },
};
