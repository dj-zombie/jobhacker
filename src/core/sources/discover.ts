import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { appendCompany } from '../config/companies-file.js';
import { DEFAULT_CONFIG_DIR } from '../config/load.js';
import type { BoardAts } from '../config/schemas.js';
import { type Http, HttpError } from '../util/http.js';
import type { Logger } from '../util/logger.js';
import { humanizeToken, plainCompanyName } from './detect.js';
import { loadBoard } from './registry.js';
import { slugify } from './slug.js';

/**
 * Probe board ATSs for each seed line and append the ones that return at
 * least one posting. `ats/token` probes that ATS. A plain name is probed on
 * every enabled keyless ATS, hyphenated (`riot-games`) and then joined
 * (`riotgames`), stopping at the first form that hits on that ATS. 404s and
 * empty boards are cached so the next run skips them.
 *
 * `probeBoard` is the one probe of one board. Discovery, harvest and
 * relocation all call it (J15).
 */

const LINE_ATS =
  /^(greenhouse|lever|ashby|smartrecruiters|breezy|polymer|workable|teamtailor)[/:]([A-Za-z0-9][A-Za-z0-9._-]{0,80})$/;

/** Where probes are remembered. `JOBHACKER_DISCOVER_CACHE` points a run at a copy. */
export const DEFAULT_CACHE_PATH =
  process.env.JOBHACKER_DISCOVER_CACHE ?? 'data/discover-cache.json';

/** A probe waits this long, and tries once. A slow board is not worth a scout's time. */
export const PROBE_TIMEOUT_MS = 8_000;

export interface DiscoverStats {
  lines: number;
  probed: number;
  added: number;
  already: number;
  misses: number;
  empty: number;
  cached: number;
  errors: number;
}

export type CacheEntry = 'miss' | 'empty' | 'hit';

export interface DiscoverCache {
  version: 1;
  entries: Record<string, CacheEntry>;
}

export interface ProbeContext {
  http: Http;
  log: Logger;
  cache: DiscoverCache;
  /** Config dir whose `companies.yaml` a hit is appended to. */
  dir: string;
  keys?: { workable?: string; teamtailor?: string };
}

export interface ProbeOptions {
  /** Append a hit to `companies.yaml` with these tags. Omitted: only look. */
  append?: { tags: string[] };
  /** Name for a board whose API gives none. Falls back to the token. */
  fallbackName?: string;
  /** Skip a board the cache records as a hit. Discovery does; harvest and relocation refetch it. */
  skipCachedHit?: boolean;
}

export type ProbeResult =
  | { kind: 'cached'; entry: CacheEntry }
  | { kind: 'no-adapter' }
  | { kind: 'no-key' }
  | { kind: 'hit'; postings: number; name: string; added: boolean }
  | { kind: 'empty' }
  | { kind: 'miss' }
  | { kind: 'error'; message: string };

/**
 * One probe: cache check, one fetch, parse, append on a hit, cache a miss or
 * an empty board. Timeouts and 5xx are not cached, so the next probe retries.
 * It goes through the caller's HTTP client, so a scout's per-host limit holds.
 * A redirect is an error: following it would parse some other URL as this token.
 */
export async function probeBoard(
  ctx: ProbeContext,
  board: { ats: BoardAts; token: string },
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const cacheKey = `${board.ats}:${board.token.toLowerCase()}`;
  const known = ctx.cache.entries[cacheKey];
  if (known && (known !== 'hit' || options.skipCachedHit)) return { kind: 'cached', entry: known };
  const adapter = loadBoard(board.ats);
  if (!adapter) return { kind: 'no-adapter' };
  const key = keyFor(board.ats, ctx.keys);
  if (adapter.needsKey && !key) return { kind: 'no-key' };

  const http: Http = {
    getJson: (url, request) =>
      ctx.http.getJson(url, {
        ...request,
        maxTries: 1,
        timeoutMs: PROBE_TIMEOUT_MS,
        redirect: 'error',
      }),
    postJson() {
      throw new Error('postJson is not used by this fake');
    },
  };
  try {
    const raw = await adapter.fetchBoard(board.token, http, key);
    const parsed = adapter.parse(raw);
    if (parsed.postings.length === 0) {
      ctx.cache.entries[cacheKey] = 'empty';
      return { kind: 'empty' };
    }
    const name =
      adapter.companyName(raw) ||
      plainCompanyName(options.fallbackName) ||
      humanizeToken(board.token);
    if (!options.append) {
      return { kind: 'hit', postings: parsed.postings.length, name, added: false };
    }
    const written = appendCompany(ctx.dir, {
      name,
      ats: board.ats,
      token: board.token,
      active: true,
      tags: [...options.append.tags],
    });
    ctx.cache.entries[cacheKey] = 'hit';
    ctx.log.info(
      { ats: board.ats, token: board.token, postings: parsed.postings.length, name },
      written.already ? 'board already listed' : 'board added',
    );
    return { kind: 'hit', postings: parsed.postings.length, name, added: !written.already };
  } catch (err) {
    if (isMiss(err)) {
      ctx.cache.entries[cacheKey] = 'miss';
      return { kind: 'miss' };
    }
    const message = err instanceof Error ? err.message : String(err);
    ctx.log.warn({ ats: board.ats, token: board.token, err: message }, 'board probe failed');
    return { kind: 'error', message };
  }
}

export async function discoverBoards(options: {
  seedPath: string;
  http: Http;
  log: Logger;
  enabled: BoardAts[];
  dir?: string;
  cachePath?: string;
  keys?: { workable?: string; teamtailor?: string };
}): Promise<DiscoverStats> {
  const cachePath = options.cachePath ?? DEFAULT_CACHE_PATH;
  const ctx: ProbeContext = {
    http: options.http,
    log: options.log,
    cache: readCache(cachePath),
    dir: options.dir ?? DEFAULT_CONFIG_DIR,
    keys: options.keys,
  };
  const stats: DiscoverStats = {
    lines: 0,
    probed: 0,
    added: 0,
    already: 0,
    misses: 0,
    empty: 0,
    cached: 0,
    errors: 0,
  };
  const text = readFileSync(options.seedPath, 'utf8');
  let sinceSave = 0;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    stats.lines += 1;
    const targeted = LINE_ATS.exec(line);
    const groups: Array<{ ats: BoardAts; tokens: string[] }> = [];
    if (targeted) {
      const ats = targeted[1] as BoardAts;
      const token = targeted[2];
      if (ats && token && options.enabled.includes(ats)) groups.push({ ats, tokens: [token] });
    } else {
      const tokens = slugForms(line);
      for (const ats of options.enabled) {
        const adapter = loadBoard(ats);
        if (!adapter || adapter.needsKey) continue;
        groups.push({ ats, tokens });
      }
    }

    for (const group of groups) {
      for (const token of group.tokens) {
        const result = await probeBoard(
          ctx,
          { ats: group.ats, token },
          { append: { tags: [] }, skipCachedHit: true },
        );
        if (result.kind === 'no-adapter' || result.kind === 'no-key') break;
        if (result.kind === 'cached') {
          stats.cached += 1;
          if (result.entry === 'hit') break;
          continue;
        }
        stats.probed += 1;
        if (result.kind === 'empty') stats.empty += 1;
        else if (result.kind === 'miss') stats.misses += 1;
        else if (result.kind === 'error') stats.errors += 1;
        else if (result.kind === 'hit') {
          if (result.added) stats.added += 1;
          else stats.already += 1;
        }
        sinceSave += 1;
        if (sinceSave >= 25) {
          writeCache(cachePath, ctx.cache);
          options.log.info(
            { probed: stats.probed, added: stats.added, misses: stats.misses, empty: stats.empty },
            'discover progress',
          );
          sinceSave = 0;
        }
        if (result.kind === 'hit') break;
      }
    }
  }

  writeCache(cachePath, ctx.cache);
  return stats;
}

/** `Riot Games` → `riot-games`, `riotgames`. Boards use either form. */
export function slugForms(name: string): string[] {
  const hyphenated = slugify(name);
  if (!hyphenated) return [];
  const joined = hyphenated.replace(/-/g, '');
  return joined && joined !== hyphenated ? [hyphenated, joined] : [hyphenated];
}

function keyFor(
  ats: BoardAts,
  keys: { workable?: string; teamtailor?: string } | undefined,
): string | undefined {
  if (ats === 'workable') return keys?.workable;
  if (ats === 'teamtailor') return keys?.teamtailor;
  return undefined;
}

function isMiss(err: unknown): boolean {
  if (!(err instanceof HttpError)) return false;
  // 404/400 are missing boards. Polymer answers 422 when the slug has no careers page.
  if (err.status === 404 || err.status === 400 || err.status === 422) return true;
  return /invalid JSON/i.test(err.message);
}

export function readCache(path: string): DiscoverCache {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof raw === 'object' && raw !== null && 'entries' in raw) {
      const entries = (raw as { entries?: unknown }).entries;
      if (entries && typeof entries === 'object') {
        return { version: 1, entries: entries as Record<string, CacheEntry> };
      }
    }
  } catch {
    // A missing cache is the first run.
  }
  return { version: 1, entries: {} };
}

export function writeCache(path: string, cache: DiscoverCache): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(cache)}\n`);
  } catch {
    // Discovery still appended boards; a cache miss only costs a re-probe.
  }
}
