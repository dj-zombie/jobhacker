import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDb } from '../db/client.js';
import { fixedClock } from '../util/clock.js';
import { type Http, HttpError, createHttp } from '../util/http.js';
import { ashbyBoardUrl } from './ashby.js';
import { MoveError, moveToLink, verifyBoardLink } from './move.js';

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function http(answers: Record<string, unknown>): Http & { calls: string[] } {
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

const RAMP = JSON.parse(readFileSync('tests/fixtures/ashby-ramp.json', 'utf8')) as unknown;

describe('verifyBoardLink', () => {
  it("says a careers page isn't a board it can read, without fetching it", async () => {
    const fake = http({});
    await expect(
      verifyBoardLink({ url: 'https://example.com/careers', http: fake }),
    ).rejects.toThrow("That link isn't a board JobHacker can read.");
    expect(fake.calls).toEqual([]);
  });

  it('names an ATS it has no adapter for', async () => {
    await expect(
      verifyBoardLink({ url: 'https://acme.wd5.myworkdayjobs.com/External', http: http({}) }),
    ).rejects.toThrow("That's a Workday board. JobHacker can't read Workday boards yet");
  });

  it('refuses a board with no postings, and one that is gone too', async () => {
    const empty = http({ [ashbyBoardUrl('quiet')]: { apiVersion: '1', jobs: [] } });
    await expect(
      verifyBoardLink({ url: 'https://jobs.ashbyhq.com/quiet', http: empty }),
    ).rejects.toThrow('That board has no postings, so nothing changed.');
    await expect(
      verifyBoardLink({ url: 'https://jobs.ashbyhq.com/gone', http: http({}) }),
    ).rejects.toThrow("That board returned 404, so it isn't there either.");
  });

  it('does not follow a redirect onto another board', async () => {
    const original = ashbyBoardUrl('coinhako');
    const followed = ashbyBoardUrl('sbi-coinhako');
    const called: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      called.push(url);
      if (init?.redirect !== 'error' && url === original) {
        return fetchImpl(followed, { ...init, redirect: 'error' });
      }
      if (url === followed) return Response.json(RAMP);
      return new Response(null, { status: 302, headers: { location: followed } });
    };
    const real = createHttp({ fetch: fetchImpl, minIntervalMs: 0, sleep: async () => {} });
    await expect(
      verifyBoardLink({ url: 'https://jobs.ashbyhq.com/coinhako', http: real }),
    ).rejects.toThrow("That board didn't answer.");
    expect(called).toEqual([original]);
  });

  it('verifies a board with one fetch and keeps the token as the link gives it', async () => {
    const fake = http({ [ashbyBoardUrl('SBI-Coinhako')]: RAMP });
    const board = await verifyBoardLink({
      url: 'https://jobs.ashbyhq.com/SBI-Coinhako/0a1b',
      http: fake,
      fallbackName: 'Coinhako',
    });
    expect(board).toEqual({ ats: 'ashby', token: 'SBI-Coinhako', name: 'Coinhako', postings: 3 });
    expect(fake.calls).toHaveLength(1);
  });
});

describe('moveToLink', () => {
  it('changes nothing when the link is refused', async () => {
    dir = mkdtempSync(join(tmpdir(), 'jobhacker-move-'));
    const yaml =
      'companies:\n  - name: Immunefi\n    ats: greenhouse\n    token: immunefi\n    active: true\n    tags: []\n';
    writeFileSync(join(dir, 'companies.yaml'), yaml);
    const { db, sqlite } = createMigratedTestDb();
    try {
      await expect(
        moveToLink(
          { dir, db, clock: fixedClock('2026-11-03T12:00:00.000Z'), http: http({}) },
          { ats: 'greenhouse', token: 'immunefi', name: 'Immunefi' },
          'https://example.com/careers',
        ),
      ).rejects.toBeInstanceOf(MoveError);
      expect(readFileSync(join(dir, 'companies.yaml'), 'utf8')).toBe(yaml);
    } finally {
      sqlite.close();
    }
  });
});
