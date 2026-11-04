import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHttp } from '../util/http.js';
import { nullLogger } from '../util/logger.js';
import { ashbyBoardUrl } from './ashby.js';
import { probeBoard } from './discover.js';

/**
 * A redirect must not become the board. Default fetch follows Location, so a
 * renamed board's 302 would be parsed as the old token and appended (J15,
 * invariant 2). The probe asks for redirect: 'error' instead.
 */

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('probeBoard', () => {
  it('does not follow a redirect onto another board', async () => {
    const original = ashbyBoardUrl('coinhako');
    const followed = ashbyBoardUrl('sbi-coinhako');
    const jobs = JSON.parse(readFileSync('tests/fixtures/ashby-ramp.json', 'utf8')) as unknown;
    const called: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      called.push(url);
      if (init?.redirect !== 'error' && url === original) {
        return fetchImpl(followed, { ...init, redirect: 'error' });
      }
      if (url === followed) return Response.json(jobs);
      return new Response(null, { status: 302, headers: { location: followed } });
    };
    dir = mkdtempSync(join(tmpdir(), 'jobhacker-probe-'));
    const http = createHttp({
      fetch: fetchImpl,
      minIntervalMs: 0,
      sleep: async () => {},
    });
    const result = await probeBoard(
      { http, log: nullLogger(), cache: { version: 1, entries: {} }, dir },
      { ats: 'ashby', token: 'coinhako' },
      { append: { tags: ['search-link'] }, fallbackName: 'Coinhako' },
    );
    expect(result.kind).toBe('error');
    expect(called).toEqual([original]);
    const file = join(dir, 'companies.yaml');
    expect(existsSync(file) ? readFileSync(file, 'utf8') : '').not.toContain('coinhako');
  });
});
