import { z } from 'zod';
import type { Http } from '../util/http.js';
import {
  cleanLine,
  cleanText,
  inferRemoteType,
  normalizeEmployment,
  plainOrHtml,
  toUtcIso,
  yearlySalary,
} from './normalize.js';
import { boardError, collectPostings } from './parse.js';
import { boardToken } from './token.js';
import type { CompanyRef, NormalizedPosting, ParsedBoard, SourceAdapter } from './types.js';

/**
 * Ashby public job board. Schema written against a live
 * `job-board/ramp?includeCompensation=true` response on 2026-10-22 (fixture
 * `tests/fixtures/ashby-ramp.json`).
 *
 * `workplaceType` is `Remote | Hybrid | OnSite` and wins over `isRemote`.
 * Unlisted postings (`isListed: false`) are omitted. Yearly salary components
 * become `comp_min` / `comp_max`.
 */

const componentSchema = z
  .object({
    compensationType: z.string().nullable().optional(),
    interval: z.string().nullable().optional(),
    currencyCode: z.string().nullable().optional(),
    minValue: z.number().nullable().optional(),
    maxValue: z.number().nullable().optional(),
  })
  .passthrough();

const ashbyJobSchema = z
  .object({
    id: z.string().trim().min(1),
    title: z.string().trim().min(1),
    jobUrl: z.string().trim().min(1),
    applyUrl: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    employmentType: z.string().nullable().optional(),
    workplaceType: z.string().nullable().optional(),
    isRemote: z.boolean().nullable().optional(),
    isListed: z.boolean().nullable().optional(),
    publishedAt: z.string().nullable().optional(),
    descriptionPlain: z.string().nullable().optional(),
    descriptionHtml: z.string().nullable().optional(),
    compensation: z
      .object({
        compensationTiers: z
          .array(
            z
              .object({
                components: z.array(componentSchema).nullable().optional(),
              })
              .passthrough(),
          )
          .nullable()
          .optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

const ashbyBoardSchema = z
  .object({
    jobs: z.array(z.unknown()),
  })
  .passthrough();

export type AshbyJob = z.infer<typeof ashbyJobSchema>;

export function ashbyBoardUrl(token: string): string {
  return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(boardToken(token))}?includeCompensation=true`;
}

export const ashbyAdapter: SourceAdapter<AshbyJob> = {
  kind: 'board',
  needsKey: false,
  ats: 'ashby',

  async fetchBoard(token: string, http: Http): Promise<unknown> {
    return http.getJson(ashbyBoardUrl(token));
  },

  parse(raw: unknown): ParsedBoard<AshbyJob> {
    const board = ashbyBoardSchema.safeParse(raw);
    if (!board.success) throw boardError('ashby', board.error);
    return collectPostings(
      'ashby',
      board.data.jobs,
      ashbyJobSchema,
      (job) => job.isListed !== false,
    );
  },

  normalize(posting: AshbyJob, company: CompanyRef): NormalizedPosting {
    if (company.ats !== 'ashby') {
      throw new Error(`ashby adapter cannot normalize a ${company.ats} company`);
    }
    const locationRaw = cleanText(posting.location);
    const comp = yearlySalary(posting.compensation?.compensationTiers);
    return {
      ats: 'ashby',
      externalId: posting.id,
      title: cleanText(posting.title) ?? posting.title,
      locationRaw,
      remoteType: inferRemoteType({
        workplaceType: posting.workplaceType,
        location: locationRaw,
      }),
      employmentType: normalizeEmployment(posting.employmentType),
      url: posting.jobUrl,
      applyUrl: cleanLine(posting.applyUrl),
      descriptionText: plainOrHtml(posting.descriptionPlain, posting.descriptionHtml),
      compMin: comp.min,
      compMax: comp.max,
      compCurrency: comp.currency,
      postedAt: toUtcIso(posting.publishedAt),
    };
  },
};
