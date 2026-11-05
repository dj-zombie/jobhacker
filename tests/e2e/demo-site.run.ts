/**
 * J21: the public demo, end to end, on a production build served by `vite preview`.
 * Screenshots every page at 1440, 1024 and 390; runs Open & fill from the demo's workspace
 * into the sample form's tab and back; checks the replayed form against the recording, that
 * it submitted nothing, and that the prototype without the hook still shows its own toast.
 * Counts console errors (UI-KIT Check 6) on every page. Every Brandfetch request, from a
 * local or a deployed copy, goes to the stand-ins in ./brandfetch.ts: when the build has a
 * demo client ID, the tiles and the header load stand-in marks, never a real logo.
 *
 *   pnpm demo:build && pnpm exec tsx tests/e2e/demo-site.run.ts
 *   pnpm exec tsx tests/e2e/demo-site.run.ts --base=https://jobhacker.space   (a deployed copy)
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type BrowserContext, type Page, chromium } from 'playwright-core';
import { loadEnv } from 'vite';
import { recordingSchema } from '../../site/src/recording.js';
import { resolveChrome } from '../../src/core/apply/browser.js';
import { isBrandfetchLoadError, logoDomain, standInFor } from './brandfetch.js';

const VIEWPORTS = [
  { width: 1440, height: 900, size: '1440', mobile: false },
  { width: 1024, height: 768, size: '1024', mobile: false },
  { width: 390, height: 844, size: '390', mobile: true },
] as const;

const LIVE = process.argv
  .find((a) => a.startsWith('--base='))
  ?.slice('--base='.length)
  .replace(/\/$/, '');
const OUT = join('docs/testing/screenshots/J21', LIVE ? 'live' : '');
/** Workers serves 404.html for an unknown path; `vite preview` only serves it by name. */
const MISSING = LIVE ? '/no-such-page' : '/404.html';
const RECORDING = recordingSchema.parse(
  JSON.parse(readFileSync('site/src/fill-recording.json', 'utf8')),
);
const DONE = 'Filled. Nothing was submitted.';
const APP_CLIENT_ID = loadEnv('production', '.', '').BRANDFETCH_CLIENT_ID?.trim() ?? '';

const brandfetch = {
  requests: 0,
  withoutId: 0,
  appId: 0,
  referers: new Set<string>(),
  domains: new Set<string>(),
  assets: new Map<string, number>(),
};

/** `icon 128`, `symbol light`, `logo dark`: what a Logo CDN URL asks for. */
function assetOf(url: URL): string {
  const path = url.pathname.split('/');
  const after = (key: string) => path[path.indexOf(key) + 1] ?? '?';
  const type = after('type');
  return type === 'icon' ? `icon ${after('w')}` : `${type} ${after('theme')}`;
}

/** Route Brandfetch to the stand-ins for every page in `context` (SOURCES § Brand data). */
async function standIns(context: BrowserContext): Promise<void> {
  await context.route(/brandfetch\.io/i, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const id = url.searchParams.get('c') ?? '';
    brandfetch.requests++;
    if (id.length === 0) brandfetch.withoutId++;
    if (APP_CLIENT_ID.length > 0 && id === APP_CLIENT_ID) brandfetch.appId++;
    brandfetch.referers.add(request.headers().referer ?? 'none');
    const domain = logoDomain(request.url());
    if (domain) brandfetch.domains.add(domain);
    const asset = assetOf(url);
    brandfetch.assets.set(asset, (brandfetch.assets.get(asset) ?? 0) + 1);
    const stand = standInFor(request.url());
    await route.fulfill({ status: stand.status, contentType: stand.contentType, body: stand.body });
  });
}

/** Logo CDN images on the page, and how many of them drew. */
const cdnImages = (page: Page, type: string) =>
  page.evaluate((t) => {
    const imgs = [...document.images].filter(
      (img) => img.src.startsWith('https://cdn.brandfetch.io/') && img.src.includes(`/type/${t}`),
    );
    return `${imgs.filter((img) => img.complete && img.naturalWidth > 0).length}/${imgs.length}`;
  }, type);

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolvePort(port));
    });
  });
}

async function waitFor(url: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server at ${url} did not come up`);
}

const errors: { page: string; text: string; url: string }[] = [];
/** The not-found page's own 404 status, matched by URL (UI-KIT Check 6 filters by URL). */
const expected: { page: string; url: string }[] = [];
const visited = new Map<string, number>();
const current = new WeakMap<Page, string>();

/** Label what `page` shows next; its listeners are attached once, on the first call. */
function watch(page: Page, name: string): void {
  visited.set(name, (visited.get(name) ?? 0) + 1);
  const first = !current.has(page);
  current.set(page, name);
  if (!first) return;
  const label = () => current.get(page) ?? name;
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const url = msg.location().url;
    if (url === `${new URL(page.url()).origin}${MISSING}` && /status of 404/.test(msg.text())) {
      expected.push({ page: label(), url: new URL(url).pathname });
      return;
    }
    if (isBrandfetchLoadError(msg.text(), url)) {
      expected.push({ page: label(), url: `${new URL(url).host} (a logo that 404s)` });
      return;
    }
    errors.push({ page: label(), text: msg.text(), url });
  });
  page.on('pageerror', (err) => errors.push({ page: label(), text: String(err), url: '' }));
}

/** Count submit attempts on every page this context opens, and block them. */
async function countSubmits(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const w = window as unknown as { __submits?: number };
    w.__submits = 0;
    document.addEventListener(
      'submit',
      () => {
        w.__submits = (w.__submits ?? 0) + 1;
      },
      true,
    );
    HTMLFormElement.prototype.submit = () => {
      w.__submits = (w.__submits ?? 0) + 1;
    };
  });
}

const submits = (page: Page) =>
  page.evaluate(() => (window as unknown as { __submits?: number }).__submits ?? 0);

const overflows: string[] = [];

async function shot(page: Page, name: string, fullPage = false): Promise<void> {
  const wider = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (wider > 0) overflows.push(`${name} +${wider}px`);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage });
}

/** The form as the replay left it, read the way the recorder read the real fill. */
async function formMatchesRecording(page: Page): Promise<string[]> {
  const problems: string[] = [];
  for (const step of RECORDING.steps) {
    const got = await page.$eval(
      `#${step.id}`,
      (el) => {
        const c = el as HTMLInputElement;
        const value =
          c.type === 'checkbox'
            ? String(c.checked)
            : c.type === 'file'
              ? Array.from(c.files ?? [])
                  .map((f) => f.name)
                  .join(', ')
              : c.value;
        return { value, outline: c.style.outlineColor, checkbox: c.type === 'checkbox' };
      },
      undefined,
    );
    const want = got.checkbox
      ? String(step.kind === 'check')
      : step.kind === 'none'
        ? ''
        : step.value;
    if (got.value !== want) {
      problems.push(`${step.id}: value "${got.value.slice(0, 40)}" ≠ "${want.slice(0, 40)}"`);
    }
    if (Boolean(got.outline) !== (step.mark !== null)) {
      problems.push(`${step.id}: outline "${got.outline}" for mark ${step.mark}`);
    }
  }
  return problems;
}

async function toWorkspace(page: Page, mobile: boolean): Promise<void> {
  if (mobile) {
    await page.getByRole('button', { name: 'Open navigation' }).first().click();
    await page.waitForTimeout(600);
  }
  await page
    .getByRole('link', { name: /In progress/ })
    .first()
    .click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Senior \/ Staff Fullstack Engineer/ }).click();
  await page.waitForTimeout(900);
}

async function main(): Promise<void> {
  const port = LIVE ? 0 : await freePort();
  const base = LIVE ?? `http://127.0.0.1:${port}`;
  const child: ChildProcess | null = LIVE
    ? null
    : spawn(
        'pnpm',
        [
          'exec',
          'vite',
          'preview',
          '--config',
          'site/vite.config.ts',
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
          '--strictPort',
        ],
        { stdio: 'ignore', detached: true },
      );
  console.log(`serving: ${LIVE ? 'the deployed site (--base)' : 'vite preview of site/dist'}`);
  mkdirSync(OUT, { recursive: true });
  const executablePath = resolveChrome();
  if (!executablePath) throw new Error('No Chrome found (set JOBHACKER_CHROME_PATH).');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    await waitFor(base);

    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
      await countSubmits(context);
      await standIns(context);
      const page = await context.newPage();

      watch(page, '/');
      await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);
      await shot(page, `demo-${vp.size}`);
      const tiles = await cdnImages(page, 'icon');
      await toWorkspace(page, vp.mobile);
      await page.waitForLoadState('networkidle');
      await shot(page, `workspace-${vp.size}`);
      console.log(
        `logos ${vp.size}: list tiles drawn ${tiles} · workspace icons ${await cdnImages(page, 'icon')} · symbols ${await cdnImages(page, 'symbol')} · wordmarks ${await cdnImages(page, 'logo')}`,
      );

      watch(page, '/about/');
      await page.goto(`${base}/about/`, { waitUntil: 'networkidle' });
      await shot(page, `about-${vp.size}`);
      await shot(page, `about-full-${vp.size}`, true);

      watch(page, MISSING);
      await page.goto(`${base}${MISSING}`, { waitUntil: 'networkidle' });
      await shot(page, `missing-${vp.size}`);

      watch(page, '/form/');
      await page.goto(`${base}/form/`, { waitUntil: 'networkidle' });
      await shot(page, `form-start-${vp.size}`);
      const started = Date.now();
      await page.getByRole('heading', { name: DONE }).waitFor({ timeout: 90_000 });
      const replayMs = Date.now() - started;
      await page.waitForTimeout(900);
      await shot(page, `form-done-${vp.size}`);
      await shot(page, `form-done-full-${vp.size}`, true);
      const problems = await formMatchesRecording(page);
      // A synthetic Enter, never a real key press (invariant 1): it must not reach a submit.
      await page.$eval('#first_name', (el) => {
        for (const type of ['keydown', 'keypress', 'keyup']) {
          el.dispatchEvent(
            new KeyboardEvent(type, {
              key: 'Enter',
              code: 'Enter',
              bubbles: true,
              cancelable: true,
            }),
          );
        }
      });
      const inert = await page.$eval('#application_form', (el) => {
        const form = el as HTMLFormElement;
        const button = form.querySelector('button[type="submit"]') as HTMLButtonElement | null;
        return { action: form.getAttribute('action'), disabled: button?.disabled ?? false };
      });
      console.log(
        `form ${vp.size}: replay ${(replayMs / 1000).toFixed(1)} s · ${RECORDING.steps.length} steps · mismatches ${problems.length} · submits after Enter ${await submits(page)} · action ${inert.action ?? 'none'} · submit disabled ${inert.disabled}`,
      );
      for (const p of problems) console.log(`  ${p}`);
      if (problems.length > 0) throw new Error('the replayed form does not match the recording');
      await context.close();
    }

    // Open & fill from the demo: a new tab replays, then the workspace toasts the counts.
    {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      });
      await countSubmits(context);
      await standIns(context);
      const page = await context.newPage();
      watch(page, '/ (flow)');
      await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      await toWorkspace(page, false);
      const [tab] = await Promise.all([
        context.waitForEvent('page'),
        page.getByRole('button', { name: 'Open & fill' }).click(),
      ]);
      watch(tab, '/form/ (flow)');
      const label = await page.getByRole('button', { name: /Filling in Chrome/ }).count();
      await tab.waitForLoadState('networkidle');
      console.log(
        `flow: new tab ${new URL(tab.url()).pathname}${new URL(tab.url()).search.replace(/run=[^&]+/, 'run=…')} · button while waiting "Filling in Chrome" ${label}`,
      );
      await tab.getByRole('heading', { name: DONE }).waitFor({ timeout: 90_000 });
      await tab.waitForTimeout(900);
      await shot(tab, 'flow-form-done-1440');
      await page.bringToFront();
      const toast = page.getByText('Filled the sample form');
      await toast.waitFor({ timeout: 10_000 });
      const description = await page
        .locator('[data-sonner-toast]')
        .filter({ hasText: 'Filled the sample form' })
        .innerText();
      await shot(page, 'flow-workspace-toast-1440');
      console.log(`flow: toast "${description.replace(/\s+/g, ' ').trim()}"`);
      console.log(
        `flow: submits demo ${await submits(page)} · form ${await submits(tab)} · button back to "Open & fill" ${await page.getByRole('button', { name: 'Open & fill' }).count()}`,
      );
      await context.close();
    }

    // Reduced motion: the replay still runs to the end, with no typing animation.
    {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
      });
      await standIns(context);
      const page = await context.newPage();
      watch(page, '/form/ (reduced motion)');
      await page.goto(`${base}/form/`, { waitUntil: 'networkidle' });
      const started = Date.now();
      await page.getByRole('heading', { name: DONE }).waitFor({ timeout: 90_000 });
      console.log(`reduced motion: replay ${((Date.now() - started) / 1000).toFixed(1)} s`);
      await context.close();
    }

    // The prototype without the hook: the old timer and toast.
    {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      });
      await standIns(context);
      const page = await context.newPage();
      const before = brandfetch.requests;
      watch(page, 'prototype.html');
      await page.goto(pathToFileURL(resolve('ui-reference/prototype.html')).href, {
        waitUntil: 'load',
      });
      await page.waitForTimeout(800);
      await toWorkspace(page, false);
      console.log(`prototype.html: Brandfetch requests ${brandfetch.requests - before}`);
      const opened = context.waitForEvent('page', { timeout: 3_000 }).then(
        () => true,
        () => false,
      );
      await page.getByRole('button', { name: 'Open & fill' }).click();
      await page.getByText('Filled the application in Chrome').waitFor({ timeout: 5_000 });
      console.log(
        `prototype.html: toast "Filled the application in Chrome" · new tab opened ${await opened}`,
      );
      await context.close();
    }
  } finally {
    await browser.close();
    if (child?.pid) process.kill(-child.pid);
  }

  const byPage = [...visited.keys()].map(
    (name) => `${name} ${errors.filter((e) => e.page === name).length}`,
  );
  console.log(
    `brandfetch: ${brandfetch.requests} requests, all answered by the stand-ins · ${brandfetch.domains.size} domains · ${[
      ...brandfetch.assets,
    ]
      .map(([asset, n]) => `${asset} ×${n}`)
      .join(
        ', ',
      )} · without a client ID ${brandfetch.withoutId} · with the app's client ID ${brandfetch.appId} · Referer ${[...brandfetch.referers].join(', ')}`,
  );
  console.log(`horizontal overflow: ${overflows.length ? overflows.join(', ') : 'none'}`);
  console.log(`check 6 console errors: ${errors.length} (${byPage.join(' · ')})`);
  for (const e of errors) console.log(`  ${e.page}: ${e.text} ${e.url}`);
  if (expected.length > 0) {
    console.log(
      `left out, as Check 6 allows: ${expected.length} × a 404 status (${[...new Set(expected.map((e) => e.url))].join(', ')})`,
    );
  }
  writeFileSync(join(OUT, 'console-errors.json'), `${JSON.stringify(errors, null, 2)}\n`);
  if (errors.length > 0 || overflows.length > 0) process.exitCode = 1;
  if (brandfetch.withoutId > 0 || brandfetch.appId > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
