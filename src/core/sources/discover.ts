import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { appendCompany } from '../config/companies-file.js';
import { DEFAULT_CONFIG_DIR } from '../config/load.js';
import type { BoardAts } from '../config/schemas.js';
import { type Http, HttpError } from '../util/http.js';
import type { Logger } from '../util/logger.js';
import { humanizeToken } from './detect.js';
import { loadBoard } from './registry.js';
import { slugify } from './slug.js';

/**
 * Probe board ATSs for each seed line and append the ones that return at
 * least one posting. `ats/token` probes that ATS. A plain name is slugified
 * and probed on every enabled keyless ATS. 404s and empty boards are cached
 * so the next run skips them.
 */

const LINE_ATS =
  /^(greenhouse|lever|ashby|smartrecruiters|breezy|polymer|workable|teamtailor)[/:]([A-Za-z0-9][A-Za-z0-9._-]{0,80})$/;

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

interface CacheFile {
  version: 1;
  entries: Record<string, 'miss' | 'empty' | 'hit'>;
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
  const dir = options.dir ?? DEFAULT_CONFIG_DIR;
  const cachePath = options.cachePath ?? 'data/discover-cache.json';
  const cache = readCache(cachePath);
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
    const probes: Array<{ ats: BoardAts; token: string }> = [];
    if (targeted) {
      const ats = targeted[1] as BoardAts;
      const token = targeted[2];
      if (ats && token && options.enabled.includes(ats)) probes.push({ ats, token });
    } else {
      const token = slugify(line);
      for (const ats of options.enabled) {
        const adapter = loadBoard(ats);
        if (!adapter || adapter.needsKey) continue;
        probes.push({ ats, token });
      }
    }

    for (const probe of probes) {
      const adapter = loadBoard(probe.ats);
      if (!adapter) continue;
      const cacheKey = `${probe.ats}:${probe.token.toLowerCase()}`;
      const known = cache.entries[cacheKey];
      if (known) {
        stats.cached += 1;
        continue;
      }
      if (adapter.needsKey && !keyFor(probe.ats, options.keys)) {
        continue;
      }
      stats.probed += 1;
      try {
        const raw = await adapter.fetchBoard(
          probe.token,
          options.http,
          keyFor(probe.ats, options.keys),
        );
        const parsed = adapter.parse(raw);
        if (parsed.postings.length === 0) {
          cache.entries[cacheKey] = 'empty';
          stats.empty += 1;
          continue;
        }
        const name = adapter.companyName(raw) || humanizeToken(probe.token);
        const written = appendCompany(dir, {
          name,
          ats: probe.ats,
          token: probe.token,
          active: true,
          tags: [],
        });
        cache.entries[cacheKey] = 'hit';
        if (written.already) stats.already += 1;
        else stats.added += 1;
        options.log.info(
          { ats: probe.ats, token: probe.token, postings: parsed.postings.length, name },
          written.already ? 'board already listed' : 'board added',
        );
      } catch (err) {
        if (isMiss(err)) {
          cache.entries[cacheKey] = 'miss';
          stats.misses += 1;
        } else {
          stats.errors += 1;
          options.log.warn(
            {
              ats: probe.ats,
              token: probe.token,
              err: err instanceof Error ? err.message : String(err),
            },
            'discover probe failed',
          );
        }
      }
      sinceSave += 1;
      if (sinceSave >= 25) {
        writeCache(cachePath, cache);
        options.log.info(
          { probed: stats.probed, added: stats.added, misses: stats.misses, empty: stats.empty },
          'discover progress',
        );
        sinceSave = 0;
      }
    }
  }

  writeCache(cachePath, cache);
  return stats;
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

function readCache(path: string): CacheFile {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof raw === 'object' && raw !== null && 'entries' in raw) {
      const entries = (raw as { entries?: unknown }).entries;
      if (entries && typeof entries === 'object') {
        return { version: 1, entries: entries as Record<string, 'miss' | 'empty' | 'hit'> };
      }
    }
  } catch {
    // A missing cache is the first run.
  }
  return { version: 1, entries: {} };
}

function writeCache(path: string, cache: CacheFile): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(cache)}\n`);
  } catch {
    // Discovery still appended boards; a cache miss only costs a re-probe.
  }
}
