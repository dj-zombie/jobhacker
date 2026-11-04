import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { BOARD_ATS, type BoardAts, type CompanyConfig } from '../config/schemas.js';
import type { Db } from '../db/client.js';
import { runsRepo } from '../db/repo/runs.js';
import { companies, jobs, runs } from '../db/schema.js';
import { type ProbeContext, readCache, writeCache } from '../sources/discover.js';
import {
  type HarvestResult,
  type HarvestSource,
  harvestBoards,
  linkedBoards,
} from '../sources/harvest.js';
import { boardKey } from '../sources/links.js';
import { GONE_STATUS, type Relocation, httpStatus, relocateBoard } from '../sources/relocate.js';
import type { Clock } from '../util/clock.js';
import type { Http } from '../util/http.js';
import type { Logger } from '../util/logger.js';

/**
 * Board upkeep (J15), the database side: which search hits harvest and
 * relocation read, and `boards:relocate` against a finished scout.
 */

/** Every stored search job's company and the text its links are read from, newest first. */
export function storedSearchSources(db: Db): HarvestSource[] {
  return db
    .select({
      companyName: companies.name,
      url: jobs.url,
      applyUrl: jobs.applyUrl,
      description: jobs.descriptionText,
    })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(eq(jobs.sourceKind, 'search'))
    .orderBy(desc(jobs.firstSeenAt), desc(jobs.id))
    .all()
    .map((row) => ({
      companyName: row.companyName,
      texts: [row.url, row.applyUrl, row.description],
    }));
}

export interface UpkeepDeps {
  db: Db;
  http: Http;
  log: Logger;
  /** Config dir whose companies.yaml harvest appends to. */
  dir: string;
  cachePath: string;
  enabled: readonly BoardAts[];
  keys?: ProbeContext['keys'];
}

function context(deps: UpkeepDeps): ProbeContext {
  return {
    http: deps.http,
    log: deps.log,
    cache: readCache(deps.cachePath),
    dir: deps.dir,
    keys: deps.keys,
  };
}

/** `boards:harvest`: every stored search hit, no cap. */
export async function harvestStored(
  deps: UpkeepDeps & { listed: readonly CompanyConfig[] },
): Promise<HarvestResult & { hits: number }> {
  const ctx = context(deps);
  const sources = storedSearchSources(deps.db);
  const result = await harvestBoards(ctx, {
    sources,
    listed: deps.listed,
    enabled: deps.enabled,
    save: () => writeCache(deps.cachePath, ctx.cache),
  });
  return { ...result, hits: sources.length };
}

/** Relocate each gone board against the stored search hits. The cache is saved once at the end. */
export async function relocateBoards(
  deps: UpkeepDeps,
  gone: ReadonlyArray<{ ats: string; token: string; name: string }>,
  ctx: ProbeContext = context(deps),
): Promise<Relocation[]> {
  if (gone.length === 0) return [];
  const hits = storedSearchSources(deps.db);
  const out: Relocation[] = [];
  for (const board of gone) {
    out.push(await relocateBoard(ctx, { board, hits, enabled: deps.enabled }));
  }
  writeCache(deps.cachePath, ctx.cache);
  return out;
}

const runErrors = z.object({
  errors: z
    .array(
      z.object({
        company: z.string().optional(),
        ats: z.string().optional(),
        token: z.string().optional(),
        message: z.string().optional(),
      }),
    )
    .default([]),
});

/** The boards a run's errors say are gone (400, 404, 410, 422), once each. */
export function goneBoards(stats: unknown): Array<{ ats: string; token: string; name: string }> {
  const parsed = runErrors.safeParse(stats ?? {});
  if (!parsed.success) return [];
  const seen = new Set<string>();
  const out: Array<{ ats: string; token: string; name: string }> = [];
  for (const error of parsed.data.errors) {
    const ats = error.ats?.trim();
    const token = error.token?.trim();
    if (!ats || !token || !(BOARD_ATS as readonly string[]).includes(ats)) continue;
    const status = httpStatus(error.message?.trim() ?? '');
    if (status == null || !GONE_STATUS.has(status)) continue;
    const key = boardKey(ats, token);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ats, token, name: error.company?.trim() || token });
  }
  return out;
}

/**
 * `boards:relocate`: relocate every gone board in the latest finished scout and write the result
 * onto that run's stats, so the card shows it without a new scout.
 */
export async function relocateLatestScout(
  deps: UpkeepDeps & { clock: Clock },
): Promise<{ runId: number; relocations: Relocation[] } | null> {
  const run = deps.db
    .select()
    .from(runs)
    .where(and(eq(runs.kind, 'scout'), isNotNull(runs.finishedAt)))
    .orderBy(desc(runs.finishedAt), desc(runs.id))
    .get();
  if (!run) return null;
  const relocations = await relocateBoards(deps, goneBoards(run.stats));
  runsRepo(deps.db, deps.clock).mergeStats(run.id, { relocation: relocations });
  return { runId: run.id, relocations };
}

/** Readable board links in stored search hits that companies.yaml doesn't list, for `pnpm cli stats`. */
export function unlistedLinks(
  db: Db,
  listed: ReadonlyArray<{ ats: string; token: string }>,
  enabled: readonly string[],
  cache: Record<string, string>,
): {
  unlisted: number;
  toProbe: number;
  missed: number;
  empty: number;
  unreadable: Record<string, number>;
} {
  const listedKeys = new Set(listed.map((board) => boardKey(board.ats, board.token)));
  const on = new Set(enabled);
  const out = {
    unlisted: 0,
    toProbe: 0,
    missed: 0,
    empty: 0,
    unreadable: {} as Record<string, number>,
  };
  for (const link of linkedBoards(storedSearchSources(db))) {
    if (!link.readable) {
      out.unreadable[link.ats] = (out.unreadable[link.ats] ?? 0) + 1;
      continue;
    }
    if (!on.has(link.ats)) continue;
    const key = boardKey(link.ats, link.token);
    if (listedKeys.has(key)) continue;
    out.unlisted += 1;
    const entry = cache[key];
    if (entry === 'miss') out.missed += 1;
    else if (entry === 'empty') out.empty += 1;
    else out.toProbe += 1;
  }
  return out;
}
