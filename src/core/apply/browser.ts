import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import type { Browser } from 'playwright-core';
import { SafePage } from './safe-page.js';

/**
 * Connect to Kris's dedicated Chrome over CDP (ARCHITECTURE § Flows "Apply
 * assist", D6). No stealth, no bundled browser: a real, normal Chrome that Kris
 * is already logged into, reached at `http://127.0.0.1:9222`. If it is not
 * reachable, `connectChrome` throws a `BrowserError` whose message includes the
 * exact launch command, so the CLI and UI can show it (acceptance #4).
 */

export const CHROME_DEBUG_ENDPOINT = 'http://127.0.0.1:9222';
export const CHROME_USER_DATA_DIR = `${homedir()}/.jobhacker-chrome`;

/** The macOS candidates for a normal Chrome binary. */
export const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
];

/** Resolve a Chrome binary path (override → env → standard macOS locations). */
export function resolveChrome(override?: string): string | undefined {
  const candidates = [override, process.env.JOBHACKER_CHROME_PATH, ...CHROME_CANDIDATES].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
  return candidates.find((p) => existsSync(p));
}

/** The command `pnpm cli chrome` runs; shown to the human when Chrome is down. */
export function chromeLaunchCommand(chromePath?: string): string {
  const bin = chromePath ?? CHROME_CANDIDATES[0];
  return `"${bin}" --remote-debugging-port=9222 --user-data-dir="${CHROME_USER_DATA_DIR}"`;
}

export class BrowserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserError';
  }
}

function notRunningMessage(endpoint: string): string {
  return [
    `Could not connect to Chrome at ${endpoint}.`,
    'Start the dedicated profile first (or run `pnpm cli chrome`):',
    `  ${chromeLaunchCommand(resolveChrome())}`,
  ].join('\n');
}

function attachFailedMessage(endpoint: string, err: unknown): string {
  const reason = err instanceof Error ? err.message.split('\n')[0] : String(err);
  return [
    `Chrome is running at ${endpoint} but could not be driven.`,
    'This usually means the dedicated Chrome has no open window, so it has no',
    'browser context to attach to. Click its icon to open a window (or quit and',
    'run `pnpm cli chrome` again), then retry.',
    `  underlying error: ${reason}`,
  ].join('\n');
}

/** Is the DevTools HTTP endpoint reachable (i.e. is Chrome actually running)? */
async function defaultReachable(endpoint: string): Promise<boolean> {
  try {
    const res = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Open a blank tab via the DevTools HTTP endpoint. When the dedicated Chrome has
 * no open window, its default browser context is torn down and
 * `connectOverCDP` fails on `Browser.setDownloadBehavior` ("Browser context
 * management is not supported"). Creating a tab re-establishes that context.
 * Newer Chrome requires `PUT`; older accepts `GET`.
 */
async function defaultOpenBlankTab(endpoint: string): Promise<void> {
  const url = `${endpoint}/json/new?about:blank`;
  try {
    const res = await fetch(url, { method: 'PUT', signal: AbortSignal.timeout(3000) });
    if (res.ok) return;
  } catch {
    // fall through to GET for older Chrome
  }
  try {
    await fetch(url, { signal: AbortSignal.timeout(3000) });
  } catch {
    // best effort; the retried connect will surface a clear error if this failed
  }
}

/**
 * Ensure the reachable Chrome has at least one page tab, opening a blank one if
 * it is in the zero-window background state (where its default browser context
 * is torn down). Safe to call when the endpoint is already up; returns whether a
 * tab was opened. Used by `pnpm cli chrome` so "already listening" is not
 * misleading when there is no attachable window (Known issue [5]).
 */
export async function ensureAttachableTab(
  endpoint: string = CHROME_DEBUG_ENDPOINT,
): Promise<boolean> {
  try {
    const res = await fetch(`${endpoint}/json`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const targets = (await res.json()) as Array<{ type?: string }>;
      if (Array.isArray(targets) && targets.some((t) => t.type === 'page')) return false;
    }
  } catch {
    // fall through and try to open a tab anyway
  }
  await defaultOpenBlankTab(endpoint);
  return true;
}

export interface ConnectDeps {
  connectOverCDP?: (endpoint: string) => Promise<Browser>;
  reachable?: (endpoint: string) => Promise<boolean>;
  openBlankTab?: (endpoint: string) => Promise<void>;
}

/**
 * Connect to the already-running dedicated Chrome. Caller must close the Browser.
 *
 * If Chrome is not reachable at all, throws a `BrowserError` with the launch
 * command. If it is reachable but the first connect fails (the common
 * "no open window" case), it opens a tab to restore the default browser context
 * and retries once before giving up with an explanatory message.
 */
export async function connectChrome(
  endpoint: string = CHROME_DEBUG_ENDPOINT,
  deps: ConnectDeps = {},
): Promise<Browser> {
  const connect =
    deps.connectOverCDP ??
    (async (e: string) => {
      const { chromium } = await import('playwright-core');
      return chromium.connectOverCDP(e);
    });
  const reachable = deps.reachable ?? defaultReachable;
  const openBlankTab = deps.openBlankTab ?? defaultOpenBlankTab;

  if (!(await reachable(endpoint))) {
    throw new BrowserError(notRunningMessage(endpoint));
  }

  try {
    return await connect(endpoint);
  } catch {
    // Reachable but no attachable context: open a window and retry once.
    await openBlankTab(endpoint);
    try {
      return await connect(endpoint);
    } catch (secondErr) {
      throw new BrowserError(attachFailedMessage(endpoint, secondErr));
    }
  }
}

/**
 * Open `url` in a new tab of the connected Chrome and return a `SafePage`. Uses
 * the existing (default) browser context so Kris's logins apply; never an
 * incognito context.
 */
export async function openApplyPage(browser: Browser, url: string): Promise<SafePage> {
  const context = browser.contexts()[0] ?? (await browser.newContext());
  // Reuse the blank tab opened during connect recovery, so we don't leave a
  // stray about:blank behind; otherwise open a fresh tab.
  const blank = context.pages().find((p) => {
    const u = p.url();
    return u === 'about:blank' || u === '';
  });
  const page = blank ?? (await context.newPage());
  const safe = new SafePage(page);
  await safe.goto(url);
  return safe;
}
