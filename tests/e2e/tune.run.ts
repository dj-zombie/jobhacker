/**
 * J6 acceptance, against a copy of the database and a copy of config/.
 * Run after `NEXT_DIST_DIR=.next-shoot pnpm build`.
 *
 *   pnpm exec tsx tests/e2e/tune.run.ts
 *
 * Opens Tune, raises Domain by 4, checks the list, the sidebar and that
 * llm_usage did not move, saves, reloads, resets, and compares Anywhere band
 * counts with `pnpm cli rank --where anywhere`. Screenshots land in
 * docs/testing/screenshots/J6/. Does not write data/jobhacker.db or config/.
 * It presses T, Escape and slider arrows, and clicks Save and Reset. It never
 * shortlists, skips, archives or prepares a job.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, type Page, chromium } from 'playwright-core';
import { resolveChrome } from '../../src/core/apply/browser.js';
import { installBrandfetchStandIns, isBrandfetchLoadError } from './brandfetch.js';

const ROOT = process.cwd();
const COPY = join(tmpdir(), `j6-tune-${process.pid}.db`);
const CONFIG = join(tmpdir(), `j6-tune-${process.pid}-config`);
const SHOTS = join(ROOT, 'docs/testing/screenshots/J6');
const REAL_CRITERIA = join(ROOT, 'config/criteria.yaml');
const chrome = resolveChrome();
if (!chrome) throw new Error('Chrome is not installed');

const SIZES = [
  { width: 1440, height: 900, name: '05-tune-1440.png' },
  { width: 1024, height: 768, name: '05-tune-1024.png' },
  { width: 390, height: 844, name: '05-tune-390.png' },
] as const;

const problems: string[] = [];
const note = (ok: boolean, label: string) => {
  console.log(`${ok ? 'ok' : 'FAIL'}  ${label}`);
  if (!ok) problems.push(label);
};

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

function sha(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function llmCount(): number {
  const raw = execFileSync(
    'sqlite3',
    [COPY, "select count(*) from events where type='llm_usage'"],
    {
      encoding: 'utf8',
    },
  ).trim();
  return Number(raw);
}

function listen(page: Page, errors: string[]): void {
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (isBrandfetchLoadError(msg.text(), msg.location().url)) return;
    errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
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

async function listIds(page: Page): Promise<string[]> {
  return page.locator('[role="option"]').evaluateAll((els) => els.map((el) => el.id));
}

/** The kit puts `aria-label` on the slider root; the thumb is the thing with the role. */
function domainSlider(page: Page) {
  return page.locator('#w-domain [role="slider"]');
}

async function domainValue(page: Page): Promise<string> {
  const slider = domainSlider(page);
  await slider.scrollIntoViewIfNeeded({ timeout: 5_000 });
  return (await slider.getAttribute('aria-valuenow')) ?? '';
}

async function sidebarMatches(page: Page): Promise<string> {
  const text = await page
    .getByRole('link', { name: /Top matches/ })
    .first()
    .innerText();
  return text.replace(/\s+/g, ' ').trim();
}

async function segmentText(page: Page): Promise<string> {
  return (await page.getByRole('group', { name: 'Match band' }).innerText())
    .replace(/\s+/g, ' ')
    .trim();
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(SHOTS, name) });
  console.log('shot', name);
}

function rankBands(): string {
  const out = execFileSync('pnpm', ['cli', 'rank', '--where', 'anywhere', '-n', '8'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_PATH: COPY, JOBHACKER_CONFIG_DIR: CONFIG },
    encoding: 'utf8',
  });
  return out;
}

async function main(): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  const realHash = sha(REAL_CRITERIA);
  execFileSync('sqlite3', [join(ROOT, 'data/jobhacker.db'), `.backup ${COPY}`], {
    stdio: 'inherit',
  });
  cpSync(join(ROOT, 'config'), CONFIG, { recursive: true });
  const criteriaCopy = join(CONFIG, 'criteria.yaml');
  const beforeSave = readFileSync(criteriaCopy, 'utf8');

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn('pnpm', ['exec', 'next', 'start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_PATH: COPY,
      JOBHACKER_CONFIG_DIR: CONFIG,
      NEXT_DIST_DIR: '.next-shoot',
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const errors: string[] = [];
  let serverLog = '';
  server.stdout?.on('data', (chunk: Buffer) => {
    serverLog += chunk.toString();
  });
  server.stderr?.on('data', (chunk: Buffer) => {
    serverLog += chunk.toString();
  });
  try {
    await waitReady(base);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    listen(page, errors);
    await installBrandfetchStandIns(page, { delayMs: 0 });

    const html = await (await page.request.get(`${base}/`)).text();
    const leaked = html.match(
      /llm_usage|draft_answers|\/Users\/|data\/(?:jobhacker|logs|seeds)|jobhacker\.db/g,
    );
    note(!leaked, `rendered HTML plumbing: ${leaked ? leaked.join(',') : 'none'}`);

    const usageBefore = llmCount();
    console.log('llm_usage before', usageBefore);

    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const tuneButton = page.getByRole('button', { name: 'Tune', exact: true });
    await tuneButton.waitFor({ timeout: 30_000 });
    await page.waitForTimeout(500);
    await tuneButton.click();
    try {
      await page.getByRole('heading', { name: 'Tune ranking' }).waitFor({ timeout: 8_000 });
    } catch (err) {
      console.log('console so far:\n', errors.join('\n') || '(none)');
      console.log('server log tail:\n', serverLog.slice(-4000));
      await page.screenshot({ path: join(SHOTS, 'debug-open.png') });
      throw err;
    }
    await page.keyboard.press('Escape');
    try {
      await page
        .getByRole('heading', { name: 'Tune ranking' })
        .waitFor({ state: 'hidden', timeout: 2_000 });
      note(true, 'Escape closes Tune');
    } catch {
      note(false, 'Escape closes Tune');
    }
    await page.keyboard.press('t');
    try {
      await page.getByRole('heading', { name: 'Tune ranking' }).waitFor({ timeout: 2_000 });
      note(true, 'T opens Tune');
    } catch {
      note(false, 'T opens Tune');
      await page.getByRole('button', { name: 'Tune', exact: true }).click();
      await page.getByRole('heading', { name: 'Tune ranking' }).waitFor();
    }

    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.waitForTimeout(300);
      await shot(page, size.name);
      const wide = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      note(!wide, `no sideways scroll at ${size.width}`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(500);
    const tuneHeading = page.getByRole('heading', { name: 'Tune ranking' });
    if ((await tuneHeading.count()) === 0) {
      await page.getByRole('button', { name: 'Tune', exact: true }).click();
      await tuneHeading.waitFor();
    }

    const domainBefore = await domainValue(page);
    const orderBefore = await listIds(page);
    const sideBefore = await sidebarMatches(page);
    const transition = await page
      .locator('[role="option"]')
      .first()
      .evaluate((el) => getComputedStyle(el).transition);
    console.log('domain before', domainBefore);
    console.log('sidebar before', sideBefore);
    console.log('order before', orderBefore.slice(0, 8).join(' '));
    console.log('row transition', transition);
    note(transition.includes('transform'), 'list rows transition their transform');

    const slider = domainSlider(page);
    await slider.focus();
    for (let i = 0; i < 4; i++) await slider.press('ArrowRight');
    await page.waitForTimeout(400);
    const domainAfter = await domainValue(page);
    const orderAfter = await listIds(page);
    const sideAfter = await sidebarMatches(page);
    console.log('domain after +4', domainAfter);
    console.log('sidebar after', sideAfter);
    console.log('order after', orderAfter.slice(0, 8).join(' '));
    note(
      Number(domainAfter) === Number(domainBefore) + 4,
      `domain ${domainBefore} → ${domainAfter}`,
    );
    note(orderBefore.join() !== orderAfter.join(), 'visible list order changed');
    note(sideBefore !== sideAfter, `sidebar Top matches changed (${sideBefore} → ${sideAfter})`);

    const usageAfter = llmCount();
    console.log('llm_usage after', usageAfter);
    note(usageAfter === usageBefore, `llm_usage unchanged (${usageBefore} → ${usageAfter})`);
    await shot(page, '06-tune-domain-1440.png');

    const imgs = await page.locator('img[src*="cdn.brandfetch.io"]').count();
    console.log('brandfetch imgs', imgs);
    note(imgs > 0, 'at least one Brandfetch logo on /');

    await page.getByRole('button', { name: 'Save to criteria.yaml' }).click();
    await page.waitForTimeout(1500);
    const afterSave = readFileSync(criteriaCopy, 'utf8');
    const a = beforeSave.split('\n');
    const b = afterSave.split('\n');
    const changed: string[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) changed.push(`${i + 1}: [${a[i] ?? ''}] => [${b[i] ?? ''}]`);
    }
    console.log('criteria diff lines', changed.length);
    for (const line of changed) console.log(line);
    const comments = (text: string) => text.split('\n').filter((l) => l.trim().startsWith('#'));
    note(
      comments(beforeSave).join('\n') === comments(afterSave).join('\n'),
      'comments survived the save',
    );
    note(
      changed.length > 0 &&
        changed.every((line) =>
          /domain_interest:|role_fit:|tech_fit:|seniority_fit:|logistics_fit:|comp_fit:|strong:|maybe:/.test(
            line,
          ),
        ),
      'only weight and band lines changed',
    );

    await page.reload({ waitUntil: 'domcontentloaded' });
    const tuneAgain = page.getByRole('button', { name: 'Tune', exact: true });
    await tuneAgain.waitFor({ timeout: 30_000 });
    await page.waitForTimeout(500);
    await tuneAgain.click();
    await page.getByRole('heading', { name: 'Tune ranking' }).waitFor();
    const persisted = await domainValue(page);
    console.log('domain after reload', persisted);
    note(persisted === domainAfter, `saved domain persisted (${persisted})`);

    await domainSlider(page).press('ArrowRight');
    const bumped = await domainValue(page);
    await page.getByRole('button', { name: 'Reset' }).click();
    const reset = await domainValue(page);
    console.log('reset', bumped, '→', reset);
    note(reset === persisted && bumped !== persisted, `Reset restored ${persisted} from ${bumped}`);

    await page.goto(`${base}/?where=anywhere`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByRole('group', { name: 'Match band' }).waitFor({ timeout: 30_000 });
    const segments = await segmentText(page);
    console.log('UI segments anywhere', segments);
    await page.getByRole('button', { name: 'Tune', exact: true }).click();
    await page.getByRole('heading', { name: 'Tune ranking' }).waitFor();
    const panelCounts = (
      await page.locator('section').filter({ hasText: 'Score distribution' }).innerText()
    ).replace(/\s+/g, ' ');
    console.log('tune panel counts', panelCounts);

    const ranked = rankBands();
    console.log('--- pnpm cli rank --where anywhere -n 8 ---');
    console.log(ranked.split('\n').slice(0, 14).join('\n'));

    await page.close();
    await consoleSweep(browser, base, errors);
    note(errors.length === 0, `console errors: ${errors.length}`);
    for (const err of errors) console.log('console', err);
  } catch (err) {
    console.log('server log tail:\n', serverLog.slice(-4000));
    throw err;
  } finally {
    await browser.close();
    server.kill('SIGTERM');
    note(sha(REAL_CRITERIA) === realHash, 'real config/criteria.yaml was not written');
  }
  if (problems.length) {
    console.log(`\n${problems.length} problem(s)`);
    process.exitCode = 1;
  } else {
    console.log('\nall checks passed');
  }
}

/** Other triage routes, three sizes, tune closed. Errors append to `errors`. */
async function consoleSweep(browser: Browser, base: string, errors: string[]): Promise<void> {
  const routes = ['/', '/new', '/shortlist', '/unscored'];
  const sizes = [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ];
  const start = errors.length;
  for (const route of routes) {
    for (const size of sizes) {
      const page = await browser.newPage({ viewport: size });
      listen(page, errors);
      await installBrandfetchStandIns(page, { delayMs: 0 });
      await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.locator('h1, h2').first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(200);
      await page.close();
    }
  }
  console.log(`console sweep added ${errors.length - start}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
