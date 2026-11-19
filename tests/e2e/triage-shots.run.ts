/**
 * J25 acceptance 5: the triage frames at the reference's sizes, on a real job, against a server
 * that is already running.
 *
 *   pnpm exec tsx tests/e2e/triage-shots.run.ts http://127.0.0.1:3000 --job 51113
 *
 * Writes to docs/testing/screenshots/J25/ (gitignored). The job is selected by clicking its row,
 * which only selects it. Pairs, by the reference's names: 01-top-1728, 17-compact-fictiv-1728,
 * 01-top-1920, 03-row-hover-1920, 01-top-scrolled-1920, 09-unscored-1920, 01-top-1440,
 * 03-row-hover-1440, 16-top-1024, 18-phone-list, 19-phone-detail, 20-phone-detail-scrolled.
 */
import { mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { type Browser, type Page, chromium } from 'playwright-core';
import { resolveChrome } from '../../src/core/apply/browser.js';
import { installBrandfetchStandIns, isBrandfetchLoadError } from './brandfetch.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    job: { type: 'string' },
    out: { type: 'string', default: 'docs/testing/screenshots/J25' },
  },
});
const base = positionals[0];
const job = values.job;
if (!base || !job) throw new Error('pass the server origin and --job <id>');
const out = values.out ?? 'docs/testing/screenshots/J25';
mkdirSync(out, { recursive: true });
const chrome = resolveChrome();
if (!chrome) throw new Error('Chrome is not installed');

const errors: string[] = [];
const notes: string[] = [];

async function open(browser: Browser, width: number, height: number, path: string) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await installBrandfetchStandIns(page, { delayMs: 0 });
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isBrandfetchLoadError(msg.text(), msg.location().url)) {
      errors.push(`${width} ${path}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => errors.push(`${width} ${path}: ${String(err)}`));
  await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  if (path.startsWith('/job/'))
    await page.locator('[data-detail-scroll]').waitFor({ timeout: 60_000 });
  else await page.locator('[role="option"]').first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1400);
  return { ctx, page };
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', name);
}

/** Scrolls the list to the job's row and clicks it, which selects it. */
async function selectJob(page: Page, id: string) {
  const found = (await page.evaluate(`(async () => {
    const list = document.querySelector('[role="listbox"]');
    if (!list) return false;
    list.scrollTop = 0;
    for (let i = 0; i < 2000; i++) {
      const row = document.getElementById('job-${id}');
      if (row) {
        row.scrollIntoView({ block: 'center' });
        await new Promise((r) => setTimeout(r, 300));
        return true;
      }
      if (list.scrollTop + list.clientHeight >= list.scrollHeight - 1) return false;
      list.scrollTop += list.clientHeight * 0.8;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    return false;
  })()`)) as boolean;
  if (!found) {
    notes.push(`job ${id} is not in ${page.url()}; the first job stays selected`);
    return;
  }
  await page.locator(`#job-${id}`).click({ position: { x: 60, y: 14 } });
  await page.waitForTimeout(1500);
}

/** Moves the pointer onto the nth row inside the list's view. Hover follows a moving pointer only. */
async function hoverRow(page: Page, n: number) {
  const box = (await page.evaluate(`(() => {
    const lb = document.querySelector('[role="listbox"]').getBoundingClientRect();
    const rows = [...document.querySelectorAll('[role="option"]')]
      .map((o) => o.getBoundingClientRect())
      .filter((r) => r.top >= lb.top && r.bottom <= lb.bottom)
      .sort((a, b) => a.top - b.top);
    const r = rows[${n}];
    return r ? { x: r.left + r.width * 0.4, y: r.top + r.height / 2 } : null;
  })()`)) as { x: number; y: number } | null;
  if (!box) return;
  await page.mouse.move(box.x, box.y - 12);
  await page.mouse.move(box.x, box.y, { steps: 4 });
  await page.waitForTimeout(400);
}

const scrollDetail = (page: Page, top: number) =>
  page
    .locator('[data-detail-scroll]')
    .first()
    .evaluate((el, y) => {
      el.scrollTop = y;
    }, top);

const browser = await chromium.launch({ executablePath: chrome, headless: true });

{
  const { ctx, page } = await open(browser, 1728, 964, '/matches');
  await shot(page, 'matches-first-1728x964');
  await selectJob(page, job);
  await shot(page, 'matches-1728x964');
  await page.mouse.move(1700, 940);
  await page.keyboard.press('d');
  await page.keyboard.press('j');
  await page.waitForTimeout(900);
  await shot(page, 'matches-compact-1728x964');
  await ctx.close();
}
{
  const { ctx, page } = await open(browser, 1920, 1080, '/matches');
  await selectJob(page, job);
  await shot(page, 'matches-1920x1080');
  await hoverRow(page, 1);
  await shot(page, 'matches-row-hover-1920x1080');
  await page.mouse.move(1880, 1040);
  await scrollDetail(page, 420);
  await page.waitForTimeout(500);
  await shot(page, 'matches-scrolled-1920x1080');
  await scrollDetail(page, 1600);
  await page.waitForTimeout(500);
  await shot(page, 'matches-scrolled-deep-1920x1080');
  await ctx.close();
}
{
  const { ctx, page } = await open(browser, 1920, 1080, '/unscored');
  await shot(page, 'unscored-1920x1080');
  await ctx.close();
}
{
  const { ctx, page } = await open(browser, 1440, 900, '/matches');
  await selectJob(page, job);
  await shot(page, 'matches-1440x900');
  await hoverRow(page, 1);
  await shot(page, 'matches-row-hover-1440x900');
  await ctx.close();
}
{
  const { ctx, page } = await open(browser, 1024, 768, '/matches');
  await selectJob(page, job);
  await shot(page, 'matches-1024x768');
  await page.mouse.move(1000, 740);
  await scrollDetail(page, 700);
  await page.waitForTimeout(500);
  await shot(page, 'matches-scrolled-1024x768');
  await ctx.close();
}
{
  const { ctx, page } = await open(browser, 390, 844, '/matches');
  await shot(page, 'phone-list-390x844');
  await selectJob(page, job);
  await shot(page, 'phone-detail-390x844');
  await page.mouse.move(195, 500);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(400);
  await shot(page, 'phone-detail-scrolled-390x844');
  await page.mouse.wheel(0, 1400);
  await page.waitForTimeout(400);
  await shot(page, 'phone-detail-scrolled-deep-390x844');
  await ctx.close();
}
{
  const { ctx, page } = await open(browser, 1440, 900, `/job/${job}`);
  await shot(page, 'job-1440x900');
  await page.mouse.move(1400, 860);
  await scrollDetail(page, 900);
  await page.waitForTimeout(500);
  await shot(page, 'job-scrolled-1440x900');
  await ctx.close();
}
await browser.close();

console.log(JSON.stringify({ notes, errors }, null, 2));
if (errors.length) process.exit(1);
