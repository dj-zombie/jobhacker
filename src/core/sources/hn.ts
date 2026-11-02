import { z } from 'zod';
import { htmlToText } from '../util/text.js';
import { cleanText, inferRemoteType, toUtcIso } from './normalize.js';
import type { SearchAdapter, SearchHit } from './search.js';

/**
 * HN "Who is hiring?" via the Algolia HN API. No key. One story search plus
 * one call per comment page. Comments shorter than 80 characters are not
 * postings (replies like "Hi") and are skipped inside the parser.
 */

const storySchema = z
  .object({
    hits: z.array(
      z
        .object({
          objectID: z.string().min(1),
          title: z.string().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const commentSchema = z
  .object({
    objectID: z.string().min(1),
    comment_text: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    author: z.string().nullable().optional(),
  })
  .passthrough();

const commentPageSchema = z
  .object({
    hits: z.array(z.unknown()),
    page: z.number().int().optional(),
    nbPages: z.number().int().optional(),
  })
  .passthrough();

const STORY_URL =
  'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=5';

function commentUrl(storyId: string, page: number): string {
  return `https://hn.algolia.com/api/v1/search?tags=comment,story_${encodeURIComponent(storyId)}&hitsPerPage=100&page=${page}`;
}

export function pickHiringStory(raw: unknown): string | undefined {
  const parsed = storySchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const hit = parsed.data.hits.find((story) => /who is hiring/i.test(story.title ?? ''));
  return (hit ?? parsed.data.hits[0])?.objectID;
}

/** Parse one Algolia comment page. `done` is true on the last page. */
export function parseHiringComments(
  raw: unknown,
  sinceIso: string,
): { hits: SearchHit[]; done: boolean } {
  const page = commentPageSchema.safeParse(raw);
  if (!page.success) return { hits: [], done: true };
  const since = Date.parse(sinceIso);
  const hits: SearchHit[] = [];
  for (const item of page.data.hits) {
    const comment = commentSchema.safeParse(item);
    if (!comment.success) continue;
    const created = toUtcIso(comment.data.created_at);
    if (created && Number.isFinite(since) && Date.parse(created) < since) continue;
    const plain = htmlToText(comment.data.comment_text ?? '').trim();
    if (plain.length < 80) continue;
    const first = plain.split('\n').find((line) => line.trim().length > 0) ?? plain;
    const parts = first.split('|').map((part) => part.trim());
    const companyName = cleanText(parts[0]) ?? 'Unknown';
    const title = cleanText(first.slice(0, 180)) ?? 'Hiring';
    const link = firstHttps(plain);
    const url = link ?? `https://news.ycombinator.com/item?id=${comment.data.objectID}`;
    hits.push({
      companyName,
      posting: {
        ats: 'hn',
        externalId: comment.data.objectID,
        title,
        locationRaw: parts.length > 2 ? cleanText(parts.slice(2).join(' | ')) : null,
        remoteType: inferRemoteType({ location: plain.slice(0, 400) }),
        employmentType: /full-?time/i.test(first)
          ? 'full_time'
          : /contract/i.test(first)
            ? 'contract'
            : null,
        url,
        applyUrl: link,
        descriptionText: plain.slice(0, 8000),
        compMin: null,
        compMax: null,
        compCurrency: null,
        postedAt: created,
      },
    });
  }
  const pageNo = page.data.page ?? 0;
  const pages = page.data.nbPages ?? pageNo + 1;
  return { hits, done: pageNo + 1 >= pages || page.data.hits.length === 0 };
}

function firstHttps(text: string): string | null {
  const match = /https?:\/\/[^\s<>"']+/i.exec(text);
  if (!match) return null;
  return match[0].replace(/[),.;]+$/, '');
}

export const hnAdapter: SearchAdapter = {
  kind: 'search',
  name: 'hn',
  needsKey: false,
  costPerCall: 0,

  async search(query, ctx): Promise<SearchHit[]> {
    if (!ctx.charge()) return [];
    const storyRaw = await ctx.http.getJson(STORY_URL, { maxTries: 1 });
    const storyId = pickHiringStory(storyRaw);
    if (!storyId) return [];
    const hits: SearchHit[] = [];
    for (let page = 0; page < 8; page++) {
      if (!ctx.charge()) break;
      const raw = await ctx.http.getJson(commentUrl(storyId, page), { maxTries: 1 });
      const batch = parseHiringComments(raw, query.since);
      hits.push(...batch.hits);
      if (batch.done) break;
    }
    return hits;
  },
};
