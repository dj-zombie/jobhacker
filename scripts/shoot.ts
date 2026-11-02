/**
 * Screenshot the review UI for a UI round (AGENTS § Definition of done, UI-KIT § Checks 6 and 8).
 *
 *   pnpm shoot --round J4                                  build into .next-shoot, serve, shoot, stop
 *   pnpm shoot --round J4 --no-build                       reuse the last .next-shoot build
 *   pnpm shoot --round J4 --base http://localhost:3000     shoot a server that is already running
 *   pnpm shoot --round J4 --routes /,/applications --label before
 *   pnpm shoot --round J4 --focus-walk                     Tab through every focusable element
 *   pnpm shoot --round J4 --reduced-motion
 *   pnpm shoot --round J4 --single --routes /job/1         one viewport frame per size
 *
 * Output: docs/testing/screenshots/<round>/[<label>/]<route>-<w>x<h>[-NN].png at 1440×900,
 * 1024×768 and 390×844: one frame per viewport-height slice of whatever scrolls (the document, or
 * the shell's main panel), plus a full-page frame, and focus-walk.json when --focus-walk is set.
 * Console errors and page errors on every route are printed and saved to console-errors.json;
 * any at all makes the command exit 1.
 *
 * The build goes to `.next-shoot` (NEXT_DIST_DIR) so it never rewrites the `.next` directory a
 * running `pnpm dev` is using in the same checkout.
 *
 * This drives the local review UI only. It refuses any non-localhost URL, and its only input is
 * the Tab key: it never clicks, types or presses Enter, so it cannot act on a job or a form.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { type Page, chromium } from 'playwright-core';
import { resolveChrome } from '../src/core/apply/browser.js';
import { installBrandfetchStandIns, isBrandfetchLoadError } from '../tests/e2e/brandfetch.js';

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

/** Every route in the shell; detail pages need a real id, so pass them with --routes. */
const DEFAULT_ROUTES = [
  '/',
  '/new',
  '/shortlist',
  '/unscored',
  '/?view=review',
  '/?view=ranked',
  '/applications',
  '/applications/submitted',
  '/applications/follow-ups',
].join(',');

const DIST_DIR = '.next-shoot';
const MAX_SLICES = 12;
const MAX_TABS = 400;

interface FocusStop {
  index: number;
  tag: string;
  role: string | null;
  name: string;
  ringOn: 'self' | 'parent' | null;
  outline: string;
  boxShadow: string;
  visible: boolean;
}

function parse() {
  const { values } = parseArgs({
    options: {
      round: { type: 'string' },
      base: { type: 'string' },
      routes: { type: 'string', default: DEFAULT_ROUTES },
      label: { type: 'string' },
      'no-build': { type: 'boolean', default: false },
      'focus-walk': { type: 'boolean', default: false },
      'focus-shots': { type: 'string', default: '4,12,24,40' },
      'reduced-motion': { type: 'boolean', default: false },
      single: { type: 'boolean', default: false },
    },
  });
  if (!values.round) throw new Error('--round is required, e.g. --round J4');
  return {
    round: values.round,
    base: values.base,
    routes: values.routes.split(',').map((r) => r.trim()),
    label: values.label,
    build: !values['no-build'],
    focusWalk: values['focus-walk'],
    focusShots: values['focus-shots'].split(',').map(Number),
    reducedMotion: values['reduced-motion'],
    single: values.single,
  };
}

function assertLocal(url: string): void {
  const host = new URL(url).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(`shoot only drives the local review UI; refusing ${url}`);
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, stdio: 'inherit' });
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`)),
    );
  });
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server at ${url} did not come up within ${timeoutMs}ms`);
}

async function startServer(build: boolean): Promise<{ base: string; child: ChildProcess }> {
  const env = { ...process.env, NEXT_DIST_DIR: DIST_DIR, NEXT_TELEMETRY_DISABLED: '1' };
  if (build) await run('pnpm', ['exec', 'next', 'build'], env);
  const port = await freePort();
  const child = spawn('pnpm', ['exec', 'next', 'start', '-p', String(port)], {
    env,
    stdio: 'inherit',
    detached: true,
  });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(base, 60_000);
  return { base, child };
}

function slug(route: string): string {
  const s = route.replace(/^\/+|\/+$/g, '').replace(/[^\w-]+/g, '_');
  return s.length > 0 ? s : 'home';
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.evaluate(() =>
    Promise.all(
      Array.from(document.images).map(
        (img) =>
          img.complete ||
          new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
          }),
      ),
    ).then(() => undefined),
  );
  await page.waitForTimeout(150);
}

async function shootSlices(page: Page, outDir: string, name: string): Promise<string[]> {
  const files: string[] = [];
  const full = join(outDir, `${name}-full.png`);
  await page.screenshot({ path: full, fullPage: true });
  files.push(full);
  // The shell is viewport-high and its main panel scrolls, so slice the document if it scrolls,
  // otherwise the scrollable overflow-y container with the largest visible height (the main
  // panel, not a small inner box). Marked with a data attribute so the scroll step below can find
  // it again without a helper function inside the page.
  const { total, step } = await page.evaluate(() => {
    const doc = document.documentElement;
    let best: Element = doc;
    if (doc.scrollHeight - doc.clientHeight <= 1) {
      let visible = 0;
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const oy = getComputedStyle(el).overflowY;
        if (oy !== 'auto' && oy !== 'scroll') continue;
        if (el.scrollHeight - el.clientHeight <= 1) continue;
        if (el.clientHeight > visible) {
          best = el;
          visible = el.clientHeight;
        }
      }
    }
    best.setAttribute('data-shoot-scroll', '');
    return { total: best.scrollHeight, step: best.clientHeight || doc.clientHeight };
  });
  const slices = Math.min(MAX_SLICES, Math.ceil(total / step));
  for (let i = 0; i < slices; i++) {
    await page.evaluate((y) => {
      const el = document.querySelector('[data-shoot-scroll]');
      if (el && el !== document.documentElement) el.scrollTop = y;
      else window.scrollTo(0, y);
    }, i * step);
    await page.waitForTimeout(120);
    const file = join(outDir, `${name}-${String(i + 1).padStart(2, '0')}.png`);
    await page.screenshot({ path: file });
    files.push(file);
  }
  await page.evaluate(() => {
    const el = document.querySelector('[data-shoot-scroll]');
    if (el && el !== document.documentElement) el.scrollTop = 0;
    window.scrollTo(0, 0);
  });
  return files;
}

/** Tab through the page and record, for every stop, whether a focus indicator is painted. */
async function focusWalk(
  page: Page,
  outDir: string,
  name: string,
  shotsAt: number[],
): Promise<FocusStop[]> {
  const stops: FocusStop[] = [];
  let firstKey: string | null = null;
  for (let i = 1; i <= MAX_TABS; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(40);
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      // A field flush inside a clipped container (the command input) paints its ring on its
      // wrapper via :has(:focus-visible); count that as the field's ring. No named helpers in
      // here: tsx's keepNames injects a __name call that does not exist in the page.
      const candidates = [cs, el.parentElement ? getComputedStyle(el.parentElement) : null];
      const at = candidates.findIndex(
        (s) =>
          s !== null &&
          ((s.outlineStyle !== 'none' && (Number.parseFloat(s.outlineWidth) || 0) >= 1) ||
            (s.boxShadow !== 'none' && s.boxShadow !== '')),
      );
      const ringOn: 'self' | 'parent' | null = at === 0 ? 'self' : at === 1 ? 'parent' : null;
      const ringStyle = (at === 1 ? candidates[1] : null) ?? cs;
      const path: string[] = [];
      for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
        const parent: Element | null = n.parentElement;
        path.push(`${n.tagName}${parent ? Array.from(parent.children).indexOf(n) : 0}`);
      }
      return {
        key: path.join('/'),
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role'),
        name: (
          el.getAttribute('aria-label') ||
          (el as HTMLInputElement).labels?.[0]?.textContent ||
          el.getAttribute('placeholder') ||
          el.textContent ||
          ''
        )
          .trim()
          .slice(0, 60),
        ringOn,
        outline: `${ringStyle.outlineStyle} ${ringStyle.outlineWidth} ${ringStyle.outlineColor} offset ${ringStyle.outlineOffset}`,
        boxShadow: ringStyle.boxShadow,
        visible: ringOn !== null && rect.width > 0 && rect.height > 0,
      };
    });
    if (!info) continue;
    if (firstKey === info.key) break;
    firstKey ??= info.key;
    stops.push({
      index: i,
      tag: info.tag,
      role: info.role,
      name: info.name,
      ringOn: info.ringOn,
      outline: info.outline,
      boxShadow: info.boxShadow,
      visible: info.visible,
    });
    if (shotsAt.includes(i)) {
      await page.evaluate(() =>
        (document.activeElement as HTMLElement | null)?.scrollIntoView({ block: 'center' }),
      );
      await page.waitForTimeout(80);
      await page.screenshot({
        path: join(outDir, `${name}-focus-${String(i).padStart(3, '0')}.png`),
      });
    }
  }
  return stops;
}

async function main(): Promise<void> {
  const opts = parse();
  const outDir = join('docs/testing/screenshots', opts.round, opts.label ?? '');
  mkdirSync(outDir, { recursive: true });

  const server = opts.base ? null : await startServer(opts.build);
  const base = opts.base ?? server?.base ?? '';
  assertLocal(base);

  const executablePath = resolveChrome();
  if (!executablePath) throw new Error('No Chrome found (set JOBHACKER_CHROME_PATH).');
  const browser = await chromium.launch({ executablePath, headless: true });
  const written: string[] = [];
  const walks: Record<string, FocusStop[]> = {};
  const errors: Array<{ route: string; viewport: string; kind: string; text: string }> = [];
  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: vp,
        deviceScaleFactor: 1,
        reducedMotion: opts.reducedMotion ? 'reduce' : 'no-preference',
      });
      const page = await context.newPage();
      await installBrandfetchStandIns(page);
      let current = { route: '', viewport: `${vp.width}x${vp.height}` };
      page.on('console', (msg) => {
        if (msg.type() === 'error' && !isBrandfetchLoadError(msg.text(), msg.location().url)) {
          errors.push({ ...current, kind: 'console', text: msg.text() });
        }
      });
      page.on('pageerror', (err) =>
        errors.push({ ...current, kind: 'pageerror', text: err.message }),
      );
      for (const route of opts.routes) {
        current = { ...current, route };
        const url = new URL(route, base).toString();
        assertLocal(url);
        const res = await page.goto(url, { waitUntil: 'networkidle' });
        await settle(page);
        const brandfetchImgs = await page.evaluate(
          () =>
            Array.from(document.querySelectorAll('img')).filter((img) =>
              img.src.includes('cdn.brandfetch.io'),
            ).length,
        );
        const name = `${slug(route)}-${vp.width}x${vp.height}`;
        console.log(`  brandfetch imgs ${brandfetchImgs}`);
        console.log(`${res?.status() ?? '???'} ${url} → ${name}`);
        const landedAt = await page.evaluate(() => window.scrollY);
        if (landedAt > 0 && !url.includes('#')) {
          console.log(`  WARNING: the page scrolled itself to y=${landedAt} on load`);
        }
        if (opts.single) {
          const file = join(outDir, `${name}.png`);
          await page.screenshot({ path: file });
          written.push(file);
        } else {
          written.push(...(await shootSlices(page, outDir, name)));
        }
        if (opts.focusWalk) {
          // A fresh navigation, so Tab starts from the top of the document rather than wherever
          // slicing (or a reload's restored state) left the sequential-focus starting point.
          await page.goto('about:blank');
          await page.goto(url, { waitUntil: 'networkidle' });
          await settle(page);
          const stops = await focusWalk(page, outDir, name, opts.focusShots);
          walks[name] = stops;
          const hidden = stops.filter((s) => !s.visible);
          console.log(
            `  focus walk: ${stops.length} stops, ${hidden.length} without a visible ring`,
          );
          for (const s of hidden)
            console.log(`    #${s.index} <${s.tag}> "${s.name}" ${s.outline}`);
        }
      }
      await context.close();
    }
    if (opts.focusWalk) {
      writeFileSync(join(outDir, 'focus-walk.json'), `${JSON.stringify(walks, null, 2)}\n`);
    }
    writeFileSync(join(outDir, 'console-errors.json'), `${JSON.stringify(errors, null, 2)}\n`);
  } finally {
    await browser.close();
    if (server?.child.pid) process.kill(-server.child.pid, 'SIGTERM');
  }
  console.log(`${written.length} frames in ${outDir}`);
  console.log(
    `console errors: ${errors.length} across ${opts.routes.length} routes × ${VIEWPORTS.length} sizes`,
  );
  for (const e of errors) console.log(`  ${e.viewport} ${e.route} [${e.kind}] ${e.text}`);
  if (errors.length > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
