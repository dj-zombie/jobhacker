import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fixedClock } from './clock.js';
import { USER_AGENT, createHttp } from './http.js';

function harness(fetchImpl: typeof fetch) {
  const clock = fixedClock('2026-10-22T00:00:00.000Z');
  const sleeps: number[] = [];
  const http = createHttp({
    fetch: fetchImpl,
    clock,
    random: () => 0,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.advance(ms);
    },
  });
  return { http, sleeps, clock };
}

describe('createHttp', () => {
  it('sends the honest user agent and returns JSON', async () => {
    let userAgent: string | null = null;
    let accept: string | null = null;
    let sawSignal = false;
    const { http } = harness(async (_input, init) => {
      const headers = new Headers(init?.headers);
      userAgent = headers.get('user-agent');
      accept = headers.get('accept');
      sawSignal = init?.signal instanceof AbortSignal;
      return Response.json({ jobs: [] });
    });

    await expect(
      http.getJson('https://boards-api.greenhouse.io/v1/boards/discord/jobs'),
    ).resolves.toEqual({
      jobs: [],
    });
    expect(userAgent).toBe(USER_AGENT);
    expect(accept).toBe('application/json');
    expect(sawSignal).toBe(true);

    const pkg: unknown = JSON.parse(readFileSync('package.json', 'utf8'));
    const version =
      typeof pkg === 'object' && pkg !== null && 'version' in pkg && typeof pkg.version === 'string'
        ? pkg.version
        : '';
    expect(USER_AGENT).toBe(
      `JobHacker/${version} (personal job search tool; +https://jobhacker.space)`,
    );
  });

  it('retries a 500 then succeeds, backing off and still spacing the host', async () => {
    let calls = 0;
    const { http, sleeps } = harness(async () => {
      calls += 1;
      if (calls === 1) return new Response('unavailable', { status: 500 });
      return Response.json({ ok: true });
    });

    await expect(
      http.getJson('https://api.lever.co/v0/postings/spotify?mode=json'),
    ).resolves.toEqual({
      ok: true,
    });
    expect(calls).toBe(2);
    // 200ms backoff, then the remainder of the 1s per-host gap.
    expect(sleeps).toEqual([200, 800]);
  });

  it('honors Retry-After on 429 and does not retry a 404', async () => {
    let rateCalls = 0;
    const rate = harness(async () => {
      rateCalls += 1;
      if (rateCalls === 1) {
        return new Response('slow down', { status: 429, headers: { 'retry-after': '2' } });
      }
      return Response.json({ ok: true });
    });
    await rate.http.getJson('https://api.ashbyhq.com/posting-api/job-board/ramp');
    expect(rateCalls).toBe(2);
    expect(rate.sleeps[0]).toBe(2000);

    let missingCalls = 0;
    const missing = harness(async () => {
      missingCalls += 1;
      return new Response('Document not found', { status: 404 });
    });
    await expect(
      missing.http.getJson('https://api.lever.co/v0/postings/nope?mode=json'),
    ).rejects.toThrow(/HTTP 404/);
    expect(missingCalls).toBe(1);
    expect(missing.sleeps).toEqual([]);
  });

  it('retries network errors up to 3 tries and does not retry invalid JSON', async () => {
    let calls = 0;
    const network = harness(async () => {
      calls += 1;
      throw new TypeError('fetch failed');
    });
    await expect(
      network.http.getJson('https://boards-api.greenhouse.io/v1/boards/x/jobs'),
    ).rejects.toThrow(/network error/);
    expect(calls).toBe(3);

    let jsonCalls = 0;
    const badJson = harness(async () => {
      jsonCalls += 1;
      return new Response('not-json', { status: 200 });
    });
    await expect(
      badJson.http.getJson('https://api.lever.co/v0/postings/spotify?mode=json'),
    ).rejects.toThrow(/invalid JSON/);
    expect(jsonCalls).toBe(1);
  });

  it('spaces requests to one host and lets other hosts proceed immediately', async () => {
    const times: number[] = [];
    const { http, clock } = harness(async () => {
      times.push(clock.nowMs());
      return Response.json({ ok: true });
    });
    const start = clock.nowMs();
    await http.getJson('https://boards-api.greenhouse.io/v1/a');
    await http.getJson('https://boards-api.greenhouse.io/v1/b');
    expect(times[0]).toBe(start);
    expect((times[1] ?? 0) - (times[0] ?? 0)).toBeGreaterThanOrEqual(1000);

    const otherTimes: number[] = [];
    const other = harness(async () => {
      otherTimes.push(0);
      return Response.json({ ok: true });
    });
    await other.http.getJson('https://api.lever.co/v0/postings/a?mode=json');
    await other.http.getJson('https://api.ashbyhq.com/posting-api/job-board/b');
    expect(other.sleeps).toEqual([]);
    expect(otherTimes).toEqual([0, 0]);
  });

  it('reserves a distinct per-host slot for each concurrent request (invariant 6)', async () => {
    // A sleep that records the wait without moving the clock, so each caller's
    // reserved gap is visible directly. Reserving only after awaiting would let
    // the 2nd and 3rd callers read the same slot and ask for the same wait.
    const clock = fixedClock('2026-10-22T00:00:00.000Z');
    const waits: number[] = [];
    const http = createHttp({
      fetch: async () => Response.json({ ok: true }),
      clock,
      random: () => 0,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    await Promise.all([
      http.getJson('https://api.lever.co/v0/postings/a?mode=json'),
      http.getJson('https://api.lever.co/v0/postings/b?mode=json'),
      http.getJson('https://api.lever.co/v0/postings/c?mode=json'),
    ]);
    expect(waits).toEqual([1000, 2000]);
  });

  it('falls back to exponential backoff when Retry-After is not a delay', async () => {
    let calls = 0;
    const { http, sleeps } = harness(async () => {
      calls += 1;
      if (calls === 1)
        return new Response('later', { status: 429, headers: { 'retry-after': 'soon' } });
      return Response.json({ ok: true });
    });
    await http.getJson('https://api.lever.co/v0/postings/spotify?mode=json');
    expect(sleeps[0]).toBe(200);
  });

  it('postJson keeps one request a second per host and sends JSON', async () => {
    const times: number[] = [];
    let contentType: string | null = null;
    let userAgent: string | null = null;
    let method: string | undefined;
    let sentBody: unknown;
    const { http, clock } = harness(async (_input, init) => {
      times.push(clock.nowMs());
      const headers = new Headers(init?.headers);
      contentType = headers.get('content-type');
      userAgent = headers.get('user-agent');
      method = init?.method;
      sentBody = init?.body ? JSON.parse(String(init.body)) : null;
      return Response.json({ ok: true });
    });
    const start = clock.nowMs();
    await http.postJson('https://api.jobspipe.dev/v1/jobs/search', { limit: 5 });
    await http.postJson('https://api.jobspipe.dev/v1/jobs/search', { limit: 5 });
    expect(times[0]).toBe(start);
    expect((times[1] ?? 0) - (times[0] ?? 0)).toBeGreaterThanOrEqual(1000);
    expect(method).toBe('POST');
    expect(contentType).toBe('application/json');
    expect(userAgent).toBe(USER_AGENT);
    expect(sentBody).toEqual({ limit: 5 });
  });

  it('postJson retries a 503, honors Retry-After on a 429, and does not retry a 402', async () => {
    let serverCalls = 0;
    const retried = harness(async () => {
      serverCalls += 1;
      if (serverCalls === 1) return new Response('unavailable', { status: 503 });
      return Response.json({ ok: true });
    });
    await expect(
      retried.http.postJson('https://api.jobspipe.dev/v1/jobs/search', { q: 1 }),
    ).resolves.toEqual({ ok: true });
    expect(serverCalls).toBe(2);
    expect(retried.sleeps[0]).toBe(200);

    let limited = 0;
    const rate = harness(async () => {
      limited += 1;
      if (limited === 1) {
        return new Response('slow down', { status: 429, headers: { 'retry-after': '2' } });
      }
      return Response.json({ ok: true });
    });
    await rate.http.postJson('https://api.jobspipe.dev/v1/jobs/search', {});
    expect(limited).toBe(2);
    expect(rate.sleeps[0]).toBe(2000);

    let unpaid = 0;
    const out = harness(async () => {
      unpaid += 1;
      return new Response('out of credits', { status: 402 });
    });
    await expect(out.http.postJson('https://api.jobspipe.dev/v1/jobs/search', {})).rejects.toThrow(
      /HTTP 402/,
    );
    expect(unpaid).toBe(1);
    expect(out.sleeps).toEqual([]);
  });
});
