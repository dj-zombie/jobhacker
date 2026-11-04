import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type Http, HttpError } from '../util/http.js';
import { nullLogger } from '../util/logger.js';
import { ashbyBoardUrl } from './ashby.js';
import type { DiscoverCache, ProbeContext } from './discover.js';
import { leverBoardUrl } from './lever.js';
import { lookedLine, nameMatches, relocateBoard } from './relocate.js';

const ENABLED = ['greenhouse', 'lever', 'ashby'] as const;

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(`tests/fixtures/${name}`, 'utf8'));
}

/** Answers the listed URLs; every other URL is a 404, recorded in `calls`. */
function fakeHttp(answers: Record<string, unknown>): Http & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async postJson() {
      throw new Error('postJson is not used by this fake');
    },
    async getJson(url) {
      calls.push(url);
      if (url in answers) return answers[url];
      throw new HttpError(`HTTP 404 from ${url}`, url, 404);
    },
  };
}

function context(http: Http, cache: DiscoverCache = { version: 1, entries: {} }): ProbeContext {
  dir = mkdtempSync(join(tmpdir(), 'jobhacker-relocate-'));
  return { http, log: nullLogger(), cache, dir };
}

const ACME = { ats: 'greenhouse', token: 'acme', name: 'Acme' };

describe('relocateBoard', () => {
  it('a 404 Greenhouse board "Acme" whose name answers on Ashby gets that candidate', async () => {
    const http = fakeHttp({ [ashbyBoardUrl('acme')]: fixture('ashby-ramp.json') });
    const result = await relocateBoard(context(http), {
      board: ACME,
      hits: [],
      enabled: ENABLED,
    });
    expect(result.candidates).toEqual([
      { ats: 'ashby', token: 'acme', name: 'Acme', postings: 3, via: 'name' },
    ]);
    expect(result.looked).toEqual(['lever', 'ashby']);
    expect(lookedLine(result)).toBe(
      'Looked on Lever and Ashby, and in your search results: found 1 board',
    );
    expect(http.calls).toEqual([leverBoardUrl('acme'), ashbyBoardUrl('acme')]);
  });

  it('a search hit from "Acme Labs" linking a Lever board gets that candidate', async () => {
    const http = fakeHttp({ [leverBoardUrl('acme-labs')]: fixture('lever-spotify.json') });
    const result = await relocateBoard(context(http), {
      board: ACME,
      hits: [
        {
          companyName: 'Acme Labs',
          texts: ['https://jobs.lever.co/acme-labs/5e1f-4c2a/apply', null, 'We build robots.'],
        },
        { companyName: 'Other Co', texts: ['https://jobs.ashbyhq.com/other-co/1'] },
      ],
      enabled: ENABLED,
    });
    expect(result.matched_hits).toBe(1);
    expect(result.candidates).toEqual([
      { ats: 'lever', token: 'acme-labs', name: 'Acme Labs', postings: 3, via: 'search' },
    ]);
    expect(http.calls).not.toContain(ashbyBoardUrl('other-co'));
  });

  it('neither gives no candidate and the "looked" line', async () => {
    const http = fakeHttp({});
    const result = await relocateBoard(context(http), {
      board: ACME,
      hits: [{ companyName: 'Acme Labs', texts: ['https://example.com/careers'] }],
      enabled: ['greenhouse', 'lever', 'ashby', 'smartrecruiters'],
    });
    expect(result.candidates).toEqual([]);
    expect(lookedLine(result)).toBe(
      'Looked on Lever, Ashby and SmartRecruiters, and in your search results: no new board',
    );
  });

  it('an Ashby board with zero postings is not a candidate, and is cached as empty', async () => {
    const http = fakeHttp({ [ashbyBoardUrl('acme')]: { apiVersion: '1', jobs: [] } });
    const ctx = context(http);
    const result = await relocateBoard(ctx, { board: ACME, hits: [], enabled: ENABLED });
    expect(result.candidates).toEqual([]);
    expect(ctx.cache.entries['ashby:acme']).toBe('empty');
    expect(ctx.cache.entries['lever:acme']).toBe('miss');
  });

  it('skips what the cache already knows, and says which ATS did not answer', async () => {
    const http: Http = {
      async postJson() {
        throw new Error('postJson is not used by this fake');
      },
      async getJson(url) {
        throw new Error(`network error for ${url}: timeout`);
      },
    };
    const ctx = context(http, { version: 1, entries: { 'lever:acme': 'miss' } });
    const result = await relocateBoard(ctx, { board: ACME, hits: [], enabled: ENABLED });
    expect(result.unanswered).toEqual(['ashby']);
    expect(lookedLine(result)).toBe(
      "Looked on Lever and Ashby, and in your search results (Ashby didn't answer): no new board",
    );
    expect(ctx.cache.entries['ashby:acme']).toBeUndefined();
  });
});

describe('nameMatches', () => {
  it('matches the same name after normalization, or a hit company that contains it', () => {
    expect(nameMatches('Coinhako', 'SBI Coinhako')).toBe(true);
    expect(nameMatches('Acme', 'Acme, Inc.')).toBe(true);
    expect(nameMatches('Acme', 'Acme Labs')).toBe(true);
    expect(nameMatches('Box', 'Dropbox')).toBe(false);
    expect(nameMatches('Acme Labs', 'Acme')).toBe(false);
  });
});
