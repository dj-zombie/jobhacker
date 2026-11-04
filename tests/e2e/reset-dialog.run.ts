/**
 * J14 dialog screenshots and Check 6, on a production build. Opens Start fresh,
 * shoots the disabled confirm and the confirm after RESET is typed, then Cancel.
 * Never clicks Confirm, so the live database is not reset.
 *
 *   pnpm build && pnpm exec tsx tests/e2e/reset-dialog.run.ts
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { resolveChrome } from '../../src/core/apply/browser.js';
import { installBrandfetchStandIns, isBrandfetchLoadError } from './brandfetch.js';

const VIEWPORTS = [
  { width: 1440, height: 900, size: '1440' },
  { width: 1024, height: 768, size: '1024' },
  { width: 390, height: 844, size: '390' },
] as const;

const OUT = join('docs/testing/screenshots/J14');

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

async function main(): Promise<void> {
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
    const html = await fetch(base).then((res) => res.text());
    const leaked = html.match(
      /llm_usage|draft_answers|\/Users\/|data\/(?:jobhacker|logs|seeds)|jobhacker\.db/g,
    );
    console.log(`check 5 matches: ${leaked ? leaked.join(', ') : '0'}`);
    if (leaked) throw new Error(`rendered HTML matched ${leaked.join(', ')}`);

    const executablePath = resolveChrome();
    if (!executablePath) throw new Error('No Chrome found (set JOBHACKER_CHROME_PATH).');
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
      for (const vp of VIEWPORTS) {
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
        }
        await page.getByRole('button', { name: 'Start fresh' }).click();
        await page.getByRole('heading', { name: 'Start fresh' }).waitFor();
        await page.getByText('with an application', { exact: true }).waitFor();
        const confirm = page.getByRole('button', { name: 'Confirm' });
        if (!(await confirm.isDisabled())) {
          throw new Error(`${vp.size}: Confirm was enabled before RESET`);
        }
        await page.waitForTimeout(400);
        if (vp.size === '1440')
          console.log(`dialog\n${await page.getByRole('dialog').innerText()}`);
        await page.screenshot({ path: join(OUT, `39-reset-${vp.size}.png`) });
        await page.getByLabel('Type RESET to confirm').fill('RESET');
        if (await confirm.isDisabled()) {
          throw new Error(`${vp.size}: Confirm stayed disabled after RESET`);
        }
        await page.waitForTimeout(200);
        await page.screenshot({ path: join(OUT, `39-reset-typed-${vp.size}.png`) });
        await page.getByRole('button', { name: 'Cancel' }).click();
        await page.getByRole('heading', { name: 'Start fresh' }).waitFor({ state: 'hidden' });
        if (await page.getByRole('heading', { name: 'Queue cleared' }).count()) {
          throw new Error('Confirm ran: the queue-cleared heading is up');
        }
        await context.close();
        console.log(`shot 39-reset-${vp.size} and 39-reset-typed-${vp.size}`);
      }
    } finally {
      await browser.close();
    }
  } finally {
    if (child.pid) process.kill(-child.pid, 'SIGTERM');
  }
  writeFileSync(join(OUT, 'console-errors.json'), `${JSON.stringify(errors, null, 2)}\n`);
  console.log(
    `console errors: ${errors.length} across / with the dialog open × ${VIEWPORTS.length} sizes`,
  );
  for (const error of errors) console.log(`  ${error.viewport} [${error.kind}] ${error.text}`);
  if (errors.length > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
