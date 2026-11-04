/**
 * J15 scout-card screenshots, Check 6, and the two move actions, on a production build served
 * from copies. Refuses to run unless DATABASE_PATH, JOBHACKER_CONFIG_DIR and
 * JOBHACKER_DISCOVER_CACHE all point away from the live files, because `--use` moves a board in
 * the config copy.
 *
 *   pnpm build
 *   DATABASE_PATH=… JOBHACKER_CONFIG_DIR=… JOBHACKER_DISCOVER_CACHE=… \
 *     pnpm exec tsx tests/e2e/board-move.run.ts --state gone     # frames 41 and 42
 *   … --state moved [--use]                                       # frame 40, then Use this board
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type Page, chromium } from 'playwright-core';
import { resolveChrome } from '../../src/core/apply/browser.js';
import { installBrandfetchStandIns, isBrandfetchLoadError } from './brandfetch.js';

const VIEWPORTS = [
  { width: 1440, height: 900, size: '1440' },
  { width: 1024, height: 768, size: '1024' },
  { width: 390, height: 844, size: '390' },
] as const;

const OUT = join('docs/testing/screenshots/J15');
const LIVE = {
  DATABASE_PATH: 'data/jobhacker.db',
  JOBHACKER_CONFIG_DIR: 'config',
  JOBHACKER_DISCOVER_CACHE: 'data/discover-cache.json',
} as const;

function copiesOnly(): string {
  for (const [name, live] of Object.entries(LIVE)) {
    const value = process.env[name];
    if (!value || resolve(value) === resolve(live)) {
      throw new Error(`${name} must point at a copy, not ${live}`);
    }
  }
  return join(process.env.JOBHACKER_CONFIG_DIR ?? '', 'companies.yaml');
}

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
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`server at ${url} did not come up`);
}

function card(page: Page) {
  return page
    .locator('div.rounded-xl')
    .filter({ hasText: /boards · .* new last run/ })
    .first();
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { state: { type: 'string' }, use: { type: 'boolean', default: false } },
  });
  const state = values.state;
  if (state !== 'gone' && state !== 'moved') throw new Error('--state gone|moved is required');
  const companiesFile = copiesOnly();

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child: ChildProcess = spawn('pnpm', ['exec', 'next', 'start', '-p', String(port)], {
    stdio: 'inherit',
    detached: true,
  });
  const errors: { viewport: string; kind: string; text: string }[] = [];
  mkdirSync(OUT, { recursive: true });
  try {
    await waitFor(base);
    const executablePath = resolveChrome();
    if (!executablePath) throw new Error('No Chrome found (set JOBHACKER_CHROME_PATH).');
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
      const open = async (vp: (typeof VIEWPORTS)[number]) => {
        const context = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
        const page = await context.newPage();
        await installBrandfetchStandIns(page);
        page.on('console', (msg) => {
          if (msg.type() === 'error' && !isBrandfetchLoadError(msg.text(), msg.location().url)) {
            errors.push({ viewport: vp.size, kind: 'console', text: msg.text() });
          }
        });
        page.on('pageerror', (err) =>
          errors.push({ viewport: vp.size, kind: 'pageerror', text: err.message }),
        );
        await page.goto(`${base}/`, { waitUntil: 'networkidle' });
        if (vp.size === '390') {
          await page.getByRole('button', { name: 'Open navigation' }).click();
          await page.waitForTimeout(700);
        }
        return { context, page, wide: vp.size !== '1024' };
      };

      const frames =
        state === 'moved'
          ? [{ name: '40-board-moved', paste: '' }]
          : [
              { name: '41-board-gone', paste: '' },
              { name: '42-board-link-error', paste: 'https://example.com/careers' },
            ];
      for (const vp of VIEWPORTS) {
        for (const frame of frames) {
          const { context, page, wide } = await open(vp);
          if (wide) {
            await page
              .getByText(/^Looked /)
              .first()
              .waitFor();
            if (frame.paste) {
              const before = readFileSync(companiesFile, 'utf8');
              await page
                .getByLabel(/new careers link/)
                .first()
                .fill(frame.paste);
              await page.getByRole('button', { name: 'Move', exact: true }).first().click();
              const alert = page.getByRole('alert').filter({ hasText: 'Nothing changed' });
              await alert.waitFor();
              if (readFileSync(companiesFile, 'utf8') !== before) {
                throw new Error(`${vp.size}: companies.yaml changed on a refused link`);
              }
              console.log(
                `${vp.size} link error: ${await alert.innerText()} (companies.yaml unchanged)`,
              );
            }
            await page.waitForTimeout(300);
            if (vp.size === '1440') {
              console.log(`--- ${frame.name} card\n${await card(page).innerText()}\n---`);
            }
          } else {
            await page.waitForTimeout(400);
          }
          await page.screenshot({ path: join(OUT, `${frame.name}-${vp.size}.png`) });
          console.log(`shot ${frame.name}-${vp.size}`);
          await context.close();
        }
      }

      if (state === 'gone') {
        const { context, page } = await open(VIEWPORTS[0]);
        const before = readFileSync(companiesFile, 'utf8');
        await page
          .getByLabel(/new careers link/)
          .first()
          .focus();
        await page.keyboard.type('https://example.com/careers');
        await page.keyboard.press('Enter');
        await page.getByRole('alert').filter({ hasText: 'Nothing changed' }).waitFor();
        const focused = () =>
          page.evaluate(() => {
            const el = document.activeElement;
            return el
              ? `${el.tagName.toLowerCase()} "${el.getAttribute('name') ?? el.textContent ?? ''}"`
              : 'none';
          });
        const steps = [`after Enter: ${await focused()}`];
        for (let i = 0; i < 2; i++) {
          await page.keyboard.press('Tab');
          steps.push(`Tab: ${await focused()}`);
        }
        if (readFileSync(companiesFile, 'utf8') !== before) {
          throw new Error('keyboard: companies.yaml changed on a refused link');
        }
        console.log(`keyboard: ${steps.join(' · ')} (companies.yaml unchanged)`);
        await context.close();
      }

      if (state === 'moved' && values.use) {
        const { context, page } = await open(VIEWPORTS[0]);
        const before = readFileSync(companiesFile, 'utf8');
        await page.getByRole('button', { name: 'Use this board' }).first().click();
        const toast = page.getByText(/^Moved /).first();
        await toast.waitFor();
        console.log(`use this board: toast "${await toast.innerText()}"`);
        const after = readFileSync(companiesFile, 'utf8');
        console.log(
          `companies.yaml entries ${before.match(/^ {2}- name:/gm)?.length ?? 0} → ${after.match(/^ {2}- name:/gm)?.length ?? 0}`,
        );
        await page.waitForTimeout(800);
        console.log(`--- card after the move\n${await card(page).innerText()}\n---`);
        await page.screenshot({ path: join(OUT, '40-board-moved-used-1440.png') });
        await context.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    if (child.pid) process.kill(-child.pid, 'SIGTERM');
  }
  writeFileSync(join(OUT, `console-errors-${state}.json`), `${JSON.stringify(errors, null, 2)}\n`);
  console.log(`console errors: ${errors.length} on / with the card open, ${state} state`);
  for (const error of errors) console.log(`  ${error.viewport} [${error.kind}] ${error.text}`);
  if (errors.length > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
