/**
 * J10 acceptance, against a copy of the database. Run after
 * `NEXT_DIST_DIR=.next-shoot pnpm build`.
 *
 *   pnpm exec tsx tests/e2e/logo-picker.run.ts
 *
 * Prints the three company_domains rows, the counter, and any console errors.
 * Screenshots land in docs/testing/screenshots/J10/. Does not touch data/jobhacker.db.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, type Page, chromium } from 'playwright-core';
import { resolveChrome } from '../../src/core/apply/browser.js';
import { installBrandfetchStandIns, isBrandfetchLoadError } from './brandfetch.js';

const ROOT = process.cwd();
const COPY = join(tmpdir(), `j10-logos-${process.pid}.db`);
const SHOTS = join(ROOT, 'docs/testing/screenshots/J10');
const chrome = resolveChrome();
if (!chrome) throw new Error('Chrome is not installed');

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

function backup(): void {
  execFileSync('sqlite3', [join(ROOT, 'data/jobhacker.db'), `.backup ${COPY}`], {
    stdio: 'inherit',
  });
}

function query(sql: string, args: string[] = []): string {
  return execFileSync('sqlite3', ['-json', COPY, sql, ...args], { encoding: 'utf8' });
}

function domainRow(name: string): string {
  const sql = `select company_key, name, domain, state, source, brand_id from company_domains where name = '${name.replaceAll("'", "''")}'`;
  const raw = query(sql).trim();
  return raw && raw !== '[]' ? raw : '(no row)';
}

function cliLogos(): string {
  return execFileSync('pnpm', ['cli', 'logos'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_PATH: COPY },
    encoding: 'utf8',
  });
}

function parseLogos(text: string): { total: number; none: number; missing: number } {
  const block = text.split('all companies')[0] ?? text;
  const total = Number(/logo set \((\d+) companies\)/.exec(block)?.[1]);
  const none = Number(/none\s+(\d+)/.exec(block)?.[1]);
  const missing = Number(/no domain yet\s+(\d+)/.exec(block)?.[1]);
  if (![total, none, missing].every((n) => Number.isInteger(n))) {
    throw new Error(`could not parse cli logos:\n${text}`);
  }
  return { total, none, missing };
}

async function waitReady(url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server did not answer ${url}`);
}

async function selectSegment(page: Page, label: string): Promise<void> {
  const button = page.getByRole('button', { name: new RegExp(`^${label}`) });
  for (let attempt = 0; attempt < 5; attempt++) {
    await button.click();
    try {
      await page.waitForFunction(
        (name) =>
          [...document.querySelectorAll('button[aria-pressed="true"]')].some((node) =>
            (node.textContent ?? '').trim().startsWith(name),
          ),
        label,
        { timeout: 2_000 },
      );
      return;
    } catch {
      // A click before hydration is dropped when React resets the segment.
    }
  }
  throw new Error(`segment ${label} did not stay selected`);
}

function listen(page: Page, errors: string[]): void {
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (isBrandfetchLoadError(text, msg.location().url)) return;
    errors.push(text.replace(/[?&]c=[^&\s]+/g, '?c=REDACTED'));
  });
  page.on('pageerror', (err) => errors.push(String(err).replace(/[?&]c=[^&\s]+/g, '?c=REDACTED')));
}

async function settleCounter(
  page: Page,
): Promise<{ showing: number; listed: number; missing: number }> {
  await page.waitForFunction(
    () => {
      const node = document.querySelector('[data-logos-showing]');
      const imgs = [...document.querySelectorAll('ul.divide-y img')].filter(
        (img) => img instanceof HTMLImageElement,
      );
      if (!imgs.every((img) => img.complete)) return false;
      const loaded = imgs.filter((img) => img.naturalWidth > 0).length;
      return node != null && Number(node.getAttribute('data-logos-showing')) === loaded;
    },
    null,
    { timeout: 20_000 },
  );
  return page.locator('[data-logos-showing]').evaluate((node) => ({
    showing: Number(node.getAttribute('data-logos-showing')),
    listed: Number(node.getAttribute('data-logos-listed')),
    missing: Number(node.getAttribute('data-logos-missing')),
  }));
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(SHOTS, name) });
  console.log('shot', name);
}

async function main(): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  backup();
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn('pnpm', ['exec', 'next', 'start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_PATH: COPY,
      NEXT_DIST_DIR: '.next-shoot',
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout?.on('data', (chunk) => {
    serverLog += String(chunk);
  });
  server.stderr?.on('data', (chunk) => {
    serverLog += String(chunk);
  });
  const browser: Browser = await chromium.launch({ executablePath: chrome, headless: true });
  const errors: string[] = [];
  try {
    await waitReady(base);
    const logos = cliLogos();
    console.log('--- pnpm cli logos (copy, before) ---');
    console.log(logos.trim());
    const parsed = parseLogos(logos);

    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(90_000);
    page.setDefaultNavigationTimeout(90_000);
    listen(page, errors);
    await installBrandfetchStandIns(page);
    await page.goto(`${base}/companies`, { waitUntil: 'domcontentloaded' });
    await settleCounter(page);
    await selectSegment(page, 'All');
    const counts = await settleCounter(page);
    const side = await page.getByRole('link', { name: /Company logos/ }).innerText();
    const sideCount = Number(side.match(/(\d+)\s*$/)?.[1]);
    console.log('page All', counts, 'sidebar', side.replace(/\s+/g, ' ').trim());
    if (counts.listed !== parsed.total - parsed.none) {
      throw new Error(`M ${counts.listed} != cli total-none ${parsed.total - parsed.none}`);
    }
    if (counts.missing !== parsed.missing || sideCount !== counts.missing) {
      throw new Error(`missing page ${counts.missing} sidebar ${sideCount} cli ${parsed.missing}`);
    }
    console.log('counts agree');

    await selectSegment(page, 'Needs a look');
    await settleCounter(page);
    await shot(page, 'companies-1440.png');
    await page.setViewportSize({ width: 1024, height: 768 });
    await settleCounter(page);
    await shot(page, 'companies-1024.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await settleCounter(page);
    await shot(page, 'companies-390.png');
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.waitForFunction(() => {
      const link = [...document.querySelectorAll('a')].find((a) =>
        (a.textContent ?? '').includes('Company logos'),
      );
      const box = link?.getBoundingClientRect();
      return box != null && box.x >= 0 && box.x < 40 && box.width > 160;
    });
    await shot(page, 'phone-nav-390.png');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 900 });
    const names = await page
      .locator('ul.divide-y li')
      .evaluateAll((nodes) =>
        nodes.slice(0, 3).map((node) => node.querySelector('.truncate')?.textContent?.trim() ?? ''),
      );
    if (names.filter(Boolean).length < 3)
      throw new Error(`need 3 companies, saw ${names.join('|')}`);
    const [pickName, typeName, noneName] = names as [string, string, string];
    console.log('--- rows before ---');
    for (const name of names) console.log(name, domainRow(name));

    // All keeps a row on screen after it leaves Needs a look.
    await selectSegment(page, 'All');
    const row = (name: string) =>
      page
        .locator('ul.divide-y li')
        .filter({ has: page.getByText(name, { exact: true }) })
        .first();
    await row(pickName).getByRole('button', { name: 'Change' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /\.com/ }).first().click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const slug = pickName.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'company';
    await row(pickName).getByText(`${slug}.com`).waitFor();
    console.log('pick visible without reload', pickName);

    await row(typeName).getByRole('button', { name: 'Change' }).click();
    await page.getByRole('button', { name: 'Type a domain' }).click();
    await page.getByLabel('Domain').fill('j10typed.com');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await row(typeName).getByText('j10typed.com').waitFor();
    console.log('typed visible without reload', typeName);

    await row(noneName).getByRole('button', { name: 'No logo' }).click();
    await row(noneName).locator('.text-fg-3', { hasText: 'No logo' }).waitFor();
    console.log('none visible without reload', noneName);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await settleCounter(page);
    await selectSegment(page, 'All');
    await row(pickName).getByText(`${slug}.com`).waitFor();
    await row(typeName).getByText('j10typed.com').waitFor();
    await row(noneName).locator('.text-fg-3', { hasText: 'No logo' }).waitFor();
    console.log('all three survived a reload');
    console.log('--- rows after ---');
    for (const name of names) console.log(name, domainRow(name));

    await page.setViewportSize({ width: 1440, height: 900 });
    await selectSegment(page, 'All');
    await row(pickName).getByRole('button', { name: 'Change' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /\.com/ }).first().waitFor();
    await page.waitForFunction(() => {
      const imgs = [...document.querySelectorAll('[role="dialog"] img')];
      return (
        imgs.length > 0 &&
        imgs.every((img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0)
      );
    });
    await shot(page, 'picker-1440.png');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    await row(pickName).getByRole('button', { name: 'Change' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /\.com/ }).first().waitFor();
    await page.waitForFunction(() => {
      const imgs = [...document.querySelectorAll('[role="dialog"] img')];
      return (
        imgs.length > 0 &&
        imgs.every((img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0)
      );
    });
    await shot(page, 'picker-390.png');
    await page.keyboard.press('Escape');

    const jobId = query(
      "select id from jobs where closed_at is null and duplicate_of is null and json_extract(gate_result,'$.passed')=1 and status in ('scored','shortlisted') limit 1",
    );
    const id = JSON.parse(jobId)[0]?.id as number;
    for (const [w, h] of [
      [1440, 900],
      [1024, 768],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`${base}/job/${id}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Change company logo' }).waitFor();
      await page.waitForFunction(() => {
        const btn = document.querySelector('button[aria-label="Change company logo"]');
        const img = btn?.querySelector('img');
        if (img instanceof HTMLImageElement) return img.complete && img.naturalWidth > 0;
        return btn != null;
      });
      await shot(page, `detail-${w}.png`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('option').first().waitFor();
    await page.waitForTimeout(1000);
    await shot(page, 'top-1440.png');
    await page.goto(`${base}/applications`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() =>
      [...document.querySelectorAll('img')].some(
        (img) => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0,
      ),
    );
    await shot(page, 'applications-1440.png');
    await page.close();

    const plain = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    plain.setDefaultTimeout(90_000);
    plain.setDefaultNavigationTimeout(90_000);
    listen(plain, errors);
    await installBrandfetchStandIns(plain, { delayMs: 0 });
    await plain.goto(`${base}/companies`, { waitUntil: 'networkidle' });
    const fast = await settleCounter(plain);
    await selectSegment(plain, 'All');
    const fastAll = await settleCounter(plain);
    await plain.close();

    const slow = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    slow.setDefaultTimeout(90_000);
    slow.setDefaultNavigationTimeout(90_000);
    listen(slow, errors);
    await slow.route('**/_next/static/chunks/**', async (route) => {
      await new Promise((r) => setTimeout(r, 1000));
      await route.continue();
    });
    await installBrandfetchStandIns(slow, { delayMs: 0 });
    await slow.goto(`${base}/companies`, { waitUntil: 'load' });
    const delayed = await settleCounter(slow);
    await selectSegment(slow, 'All');
    const delayedAll = await settleCounter(slow);
    await slow.close();
    console.log(
      'counter needs',
      fast.showing,
      'delayed',
      delayed.showing,
      'all',
      fastAll.showing,
      delayedAll.showing,
    );
    if (fast.showing !== delayed.showing || fastAll.showing !== delayedAll.showing) {
      throw new Error(
        `hydration counter ${delayed.showing}/${delayedAll.showing} != ${fast.showing}/${fastAll.showing}`,
      );
    }

    const report = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    report.setDefaultTimeout(90_000);
    report.setDefaultNavigationTimeout(90_000);
    listen(report, errors);
    await installBrandfetchStandIns(report, { delayMs: 0 });
    await report.goto(`${base}/dev/logo-report`, { waitUntil: 'domcontentloaded' });
    await report.waitForFunction(() => {
      const img = document.querySelector('[data-preload]');
      return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
    });
    let reported = false;
    for (let attempt = 0; attempt < 5 && !reported; attempt++) {
      await report.getByRole('button', { name: 'Mount tile' }).click();
      try {
        await report.waitForFunction(
          () => document.querySelector('[data-reports]')?.getAttribute('data-reports') === '1',
          null,
          { timeout: 3_000 },
        );
        reported = true;
      } catch {
        // A click before hydration is dropped.
      }
    }
    if (!reported) throw new Error('tile never reported loaded');
    await report.waitForTimeout(600);
    const reports = await report.locator('[data-reports]').getAttribute('data-reports');
    console.log('logo reports', reports);
    if (reports !== '1') throw new Error(`tile reported ${reports} times`);
    await report.close();

    console.log('console errors:', errors.length ? errors.join('\n') : 'none');
    if (errors.length) throw new Error('console errors');
  } catch (err) {
    console.error(serverLog.slice(-2000));
    throw err;
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
