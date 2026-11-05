import type { Clock } from './clock.js';
import { systemClock } from './clock.js';

/**
 * Polite JSON GET and POST (ARCHITECTURE § HTTP, invariant 6).
 *
 * One request per second per host, 15s timeout, and up to 3 attempts on
 * 429, 5xx, and network errors. Honors `Retry-After`. Other 4xx responses
 * and invalid JSON are not retried. POST sends `content-type: application/json`.
 *
 * The timeout uses a cleared `setTimeout` instead of `AbortSignal.timeout`,
 * whose timer would keep the process alive after the response arrived.
 */

export const USER_AGENT = 'JobHacker/0.0.1 (personal job search tool; +https://jobhacker.space)';

export class HttpError extends Error {
  override readonly name = 'HttpError';

  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface HttpRequest {
  headers?: Record<string, string>;
  /** Overrides the client default for this call. Search adapters use 1 so a 429 is not billed three times. */
  maxTries?: number;
  /** Overrides the client's timeout for this call. Board probes use 8 s. */
  timeoutMs?: number;
  /**
   * Board probes pass `'error'` so a 3xx is a failure. Default fetch would follow it and
   * the probe would treat another board's JSON as this token (invariant 2).
   */
  redirect?: RequestRedirect;
}

export interface Http {
  getJson(url: string, request?: HttpRequest): Promise<unknown>;
  /** JSON POST. Test fakes that never post may throw from this. */
  postJson(url: string, body: unknown, request?: HttpRequest): Promise<unknown>;
}

export interface HttpOptions {
  fetch?: typeof fetch;
  clock?: Clock;
  sleep?: (ms: number) => Promise<void>;
  /** Minimum gap between requests to the same host. Default 1000. */
  minIntervalMs?: number;
  timeoutMs?: number;
  /** Total attempts, including the first. Default 3. */
  maxTries?: number;
  userAgent?: string;
  /** Returns a number in [0, 1). Used for backoff jitter. */
  random?: () => number;
}

export function createHttp(options: HttpOptions = {}): Http {
  const fetchImpl = options.fetch ?? fetch;
  const clock = options.clock ?? systemClock;
  const sleep = options.sleep ?? delay;
  const minIntervalMs = options.minIntervalMs ?? 1000;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxTries = options.maxTries ?? 3;
  const userAgent = options.userAgent ?? USER_AGENT;
  const random = options.random ?? Math.random;
  const nextAt = new Map<string, number>();

  async function waitForHost(host: string): Promise<void> {
    const now = clock.nowMs();
    const due = Math.max(nextAt.get(host) ?? now, now);
    // Reserve the next slot synchronously, before awaiting, so concurrent
    // requests to the same host each take a distinct slot and invariant 6
    // (1 req/s per host) holds no matter how callers schedule us.
    nextAt.set(host, due + minIntervalMs);
    const wait = due - now;
    if (wait > 0) await sleep(wait);
  }

  function backoffMs(attempt: number, response?: Response): number {
    if (response?.status === 429) {
      const honored = retryAfterMs(response.headers.get('retry-after'), clock.nowMs());
      if (honored != null) return honored;
    }
    const jitter = Math.floor(random() * 100);
    return 200 * 2 ** (attempt - 1) + jitter;
  }

  async function readJson(
    method: 'GET' | 'POST',
    url: string,
    init: HttpRequest | undefined,
    body?: unknown,
  ): Promise<unknown> {
    const host = new URL(url).host;
    let lastError: Error | undefined;
    const tries = init?.maxTries ?? maxTries;

    for (let attempt = 1; attempt <= tries; attempt++) {
      await waitForHost(host);
      let response: Response;
      try {
        response = await request(
          fetchImpl,
          url,
          method,
          userAgent,
          init?.timeoutMs ?? timeoutMs,
          init?.headers,
          init?.redirect,
          body,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        lastError = new HttpError(`network error for ${url}: ${message}`, url);
        if (attempt === tries) throw lastError;
        await sleep(backoffMs(attempt));
        continue;
      }

      if (response.ok) {
        try {
          return (await response.json()) as unknown;
        } catch {
          throw new HttpError(`invalid JSON from ${url}`, url, response.status);
        }
      }

      const retryable = response.status === 429 || response.status >= 500;
      const detail = await errorDetail(response);
      const message = detail
        ? `HTTP ${response.status} from ${url}: ${detail}`
        : `HTTP ${response.status} from ${url}`;
      const error = new HttpError(message, url, response.status);
      if (!retryable || attempt === tries) throw error;
      lastError = error;
      await sleep(backoffMs(attempt, response));
    }

    throw lastError ?? new HttpError(`request failed for ${url}`, url);
  }

  return {
    getJson(url: string, init?: HttpRequest): Promise<unknown> {
      return readJson('GET', url, init);
    },
    postJson(url: string, body: unknown, init?: HttpRequest): Promise<unknown> {
      return readJson('POST', url, init, body);
    },
  };
}

async function request(
  fetchImpl: typeof fetch,
  url: string,
  method: 'GET' | 'POST',
  userAgent: string,
  timeoutMs: number,
  extraHeaders?: Record<string, string>,
  redirect?: RequestRedirect,
  body?: unknown,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await fetchImpl(url, {
      method,
      headers: {
        accept: 'application/json',
        'user-agent': userAgent,
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
        ...extraHeaders,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
      ...(redirect ? { redirect } : {}),
    });
  } finally {
    clearTimeout(timer);
  }
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.replace(/\s+/g, ' ').trim().slice(0, 180);
  } catch {
    return '';
  }
}

/** `Retry-After` as delta-seconds or an HTTP date. Undefined if unusable. */
function retryAfterMs(header: string | null, nowMs: number): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds < 0) return undefined;
    return Math.round(seconds * 1000);
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - nowMs);
}

function delay(ms: number): Promise<void> {
  // Must stay ref'd. The CLI's only handle during a per-host wait is this
  // timer; unref'ing it lets Node exit before the next board is fetched.
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
