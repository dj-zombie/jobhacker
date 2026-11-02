import { z } from 'zod';
import type { Http } from '../util/http.js';
import { cleanText, inferRemoteType, richTextToPlain, toUtcIso } from './normalize.js';
import { boardError, collectPostings } from './parse.js';
import { boardToken } from './token.js';
import type { CompanyRef, NormalizedPosting, ParsedBoard, SourceAdapter } from './types.js';

/**
 * Greenhouse public board. Schema written against a live
 * `boards/discord/jobs?content=true` response on 2026-10-22 (fixture
 * `tests/fixtures/greenhouse-discord.json`).
 *
 * `id` is the public job id. `internal_job_id` is not stored (STATUS, round 0).
 * `content` is entity-escaped HTML. `first_published` is the post time;
 * `updated_at` is not.
 */

const greenhouseJobSchema = z
  .object({
    id: z.union([z.number().int(), z.string().min(1)]),
    internal_job_id: z.union([z.number(), z.string()]).nullable().optional(),
    title: z.string().trim().min(1),
    absolute_url: z.string().trim().min(1),
    content: z.string().nullable().optional(),
    location: z
      .union([
        z.object({ name: z.string().nullable().optional() }).passthrough(),
        z.string(),
        z.null(),
      ])
      .optional(),
    first_published: z.string().nullable().optional(),
    company_name: z.string().nullable().optional(),
  })
  .passthrough();

const greenhouseBoardSchema = z
  .object({
    jobs: z.array(z.unknown()),
  })
  .passthrough();

export type GreenhouseJob = z.infer<typeof greenhouseJobSchema>;

export function greenhouseBoardUrl(token: string): string {
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken(token))}/jobs?content=true`;
}

function locationName(location: GreenhouseJob['location']): string | null {
  if (!location) return null;
  if (typeof location === 'string') return cleanText(location);
  return cleanText(location.name);
}

export const greenhouseAdapter: SourceAdapter<GreenhouseJob> = {
  kind: 'board',
  needsKey: false,
  ats: 'greenhouse',

  async fetchBoard(token: string, http: Http): Promise<unknown> {
    return http.getJson(greenhouseBoardUrl(token));
  },

  parse(raw: unknown): ParsedBoard<GreenhouseJob> {
    const board = greenhouseBoardSchema.safeParse(raw);
    if (!board.success) throw boardError('greenhouse', board.error);
    return collectPostings('greenhouse', board.data.jobs, greenhouseJobSchema);
  },

  normalize(posting: GreenhouseJob, company: CompanyRef): NormalizedPosting {
    if (company.ats !== 'greenhouse') {
      throw new Error(`greenhouse adapter cannot normalize a ${company.ats} company`);
    }
    const locationRaw = locationName(posting.location);
    return {
      ats: 'greenhouse',
      externalId: String(posting.id),
      title: cleanText(posting.title) ?? posting.title,
      locationRaw,
      remoteType: inferRemoteType({ location: locationRaw }),
      employmentType: null,
      url: posting.absolute_url,
      applyUrl: null,
      descriptionText: richTextToPlain(posting.content ?? ''),
      compMin: null,
      compMax: null,
      compCurrency: null,
      postedAt: toUtcIso(posting.first_published),
    };
  },
};

export function greenhouseCompanyName(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null || !('jobs' in raw)) return undefined;
  const jobs = raw.jobs;
  if (!Array.isArray(jobs)) return undefined;
  for (const job of jobs) {
    if (typeof job !== 'object' || job === null || !('company_name' in job)) continue;
    const name = job.company_name;
    if (typeof name === 'string' && name.trim()) return name.trim();
  }
  return undefined;
}
