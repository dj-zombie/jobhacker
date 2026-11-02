/**
 * J8 acceptance 1, against data/j8-walkthrough.db (a `.backup` copy) and a copy of config/.
 *
 *   NEXT_DIST_DIR=.next-shoot pnpm build
 *   pnpm exec tsx tests/e2e/finish.run.ts
 *
 * Keyboard only: no mouse clicks. Triage with j/s, open ⌘K and ?, jump to a job the current
 * Where hides, then Open & fill and Mark submitted on an already-prepared application whose
 * apply URL points at the local Ashby fixture. Fill uses a headless Chrome on a free port
 * (`JOBHACKER_CDP_ENDPOINT`), never 9222. The server starts with an empty API key, so Prepare
 * application is reached and activated but does not call a model. Deletes the copy.
 * Never writes data/jobhacker.db, config/ or output/.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, type Page, chromium } from 'playwright-core';
import { resolveChrome } from '../../src/core/apply/browser.js';
import { installBrandfetchStandIns, isBrandfetchLoadError } from './brandfetch.js';

const ROOT = process.cwd();
const REAL_DB = join(ROOT, 'data/jobhacker.db');
const COPY = join(ROOT, 'data/j8-walkthrough.db');
const TMP = mkdtempSync(join(tmpdir(), 'j8-walkthrough-'));
const CONFIG = join(TMP, 'config');
const WORK = join(TMP, 'output');
const CHROME_DIR = join(TMP, 'chrome');
const SHOTS = join(ROOT, 'docs/testing/screenshots/J8');
const FIXTURE = join(ROOT, 'tests/fixtures/forms/ashby-application.html');
const chrome = resolveChrome();
if (!chrome) throw new Error('Chrome is not installed');

const SUBMIT_COUNTER = `<script>
  window.__submits = 0;
  function __noteSubmit() {
    window.__submits += 1;
    fetch('/submits', { method: 'POST' }).catch(function () {});
  }
  document.addEventListener('submit', function (e) { __noteSubmit(); e.preventDefault(); }, true);
  HTMLFormElement.prototype.submit = function () { __noteSubmit(); };
  HTMLFormElement.prototype.requestSubmit = function () { __noteSubmit(); };
</script>`;

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

function configHashes(dir: string): Map<string, string> {
  return new Map(
    readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => [entry.name, sha(join(dir, entry.name))] as const),
  );
}

function sql(db: string, statement: string): string {
  return execFileSync('sqlite3', [db, statement], { encoding: 'utf8' }).trim();
}

const q = (statement: string) => sql(COPY, statement);

async function reachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitFor(check: () => Promise<boolean>, what: string, ms = 30_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timed out waiting for ${what}`);
}

function listen(page: Page, errors: string[]): void {
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (isBrandfetchLoadError(msg.text(), msg.location().url)) return;
    errors.push(`${page.url()} ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`${page.url()} ${String(err)}`));
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
  console.log('shot', name);
}

async function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return '';
    const aria = el.getAttribute('aria-label');
    const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    return (aria || text).slice(0, 140);
  });
}

/** Tab until the focused link's href matches. */
async function tabToHref(page: Page, href: string, max = 120): Promise<void> {
  for (let i = 0; i < max; i++) {
    const hit = await page.evaluate((want) => {
      const el = document.activeElement as HTMLElement | null;
      return el?.getAttribute('href') === want;
    }, href);
    if (hit) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Tab never reached ${href}`);
}

/** Tab until the focused control's name matches. Returns the name. */
async function tabTo(page: Page, pattern: RegExp, max = 100): Promise<string> {
  for (let i = 0; i < max; i++) {
    const name = await focusedName(page);
    if (pattern.test(name)) return name;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Tab never reached ${pattern}. Last focus: ${await focusedName(page)}`);
}

async function noSideways(page: Page, label: string): Promise<void> {
  const wide = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  note(!wide, `no sideways scroll: ${label}`);
}

function toast(page: Page, text: string) {
  return page.locator('[data-sonner-toast]', { hasText: text }).first();
}

interface PaletteJob {
  id: string;
  title: string;
  company: string;
  band: string;
  areas: string[];
}

async function main(): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(WORK, { recursive: true });
  // Kris's Chrome stays on 9222. This run fills through its own headless Chrome.
  const cdpPort = await freePort();
  const cdp = `http://127.0.0.1:${cdpPort}`;
  console.log(`fill Chrome on ${cdp} (9222 is left alone)`);
  const realConfig = configHashes(join(ROOT, 'config'));
  const realCounts = sql(
    REAL_DB,
    'select (select count(*) from applications), (select count(*) from jobs), (select max(id) from events)',
  );
  console.log('real db applications|jobs|max event id before:', realCounts);
  const realEventMax = Number(realCounts.split('|')[2]);

  rmSync(COPY, { force: true });
  execFileSync('sqlite3', ['data/jobhacker.db', '.backup data/j8-walkthrough.db'], { cwd: ROOT });
  cpSync(join(ROOT, 'config'), CONFIG, { recursive: true });

  const [appIdRaw, jobIdRaw, resumePath] = q(
    `select a.id, a.job_id, a.resume_pdf_path from applications a join jobs j on j.id = a.job_id
     where a.status = 'prepped' and j.ats = 'ashby' and a.fill_report is not null order by a.id limit 1`,
  ).split('|');
  const appId = Number(appIdRaw);
  const jobId = Number(jobIdRaw);
  if (!appId || !resumePath) throw new Error('No prepped Ashby application in the copy');
  console.log(`keyboard application ${appId} (job ${jobId})`);

  const fixtureHtml = readFileSync(FIXTURE, 'utf8').replace('<head>', `<head>${SUBMIT_COUNTER}`);
  let submits = 0;
  const fixture = createHttpServer((req, res) => {
    if (req.method === 'POST' && req.url === '/submits') {
      submits += 1;
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fixtureHtml);
  });
  const fixturePort = await freePort();
  await new Promise<void>((resolve) => fixture.listen(fixturePort, '127.0.0.1', resolve));
  const fixtureUrl = `http://127.0.0.1:${fixturePort}/ashby`;
  cpSync(resumePath, join(WORK, 'resume.pdf'));
  const appsBefore = q('select count(*) from applications');
  q(
    `update jobs set apply_url = '${fixtureUrl}' where id = ${jobId};
     update applications set resume_pdf_path = '${join(WORK, 'resume.pdf')}' where id = ${appId};`,
  );

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
      ANTHROPIC_API_KEY: '',
      JOBHACKER_CDP_ENDPOINT: cdp,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout?.on('data', (chunk: Buffer) => {
    serverLog += chunk.toString();
  });
  server.stderr?.on('data', (chunk: Buffer) => {
    serverLog += chunk.toString();
  });

  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const errors: string[] = [];
  let dedicated: ReturnType<typeof spawn> | undefined;
  try {
    await waitFor(async () => {
      try {
        return (await fetch(base, { redirect: 'manual' })).status < 500;
      } catch {
        return false;
      }
    }, 'next start');

    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    listen(page, errors);
    await installBrandfetchStandIns(page, { delayMs: 0 });
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.locator('[role="option"]').first().waitFor({ timeout: 30_000 });
    const startUrl = new URL(page.url());
    console.log('path: triage', startUrl.pathname + startUrl.search);

    const selected = await page.locator('[role="option"][aria-selected="true"]').innerText();
    console.log('path: selected', selected.split('\n')[0]);
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    const afterJ = await page.locator('[role="option"][aria-selected="true"]').innerText();
    note(afterJ !== selected, `j moves the selection (${afterJ.split('\n')[0]})`);
    const announced = await page.locator('p.sr-only[aria-live="polite"]').innerText();
    note(announced.length > 0, `selection announced: ${announced}`);

    await page.keyboard.press('s');
    await toast(page, 'Shortlisted').waitFor({ timeout: 10_000 });
    note(true, 's shortlists, toast Shortlisted');
    console.log('path: triage j, j, s');

    // ⌘K. Control counts as mod, and headless Chrome delivers it reliably.
    await page.keyboard.press('Control+k');
    await page.getByRole('dialog').waitFor();
    const jobs = (await fetch(`${base}/api/palette-jobs`).then((r) => r.json())) as PaletteJob[];
    const pressed = await page.locator('fieldset button[aria-pressed="true"]').allInnerTexts();
    const places = pressed
      .map((text) => text.toLowerCase())
      .flatMap((text) => ['portland', 'phoenix', 'remote'].filter((id) => text.includes(id)));
    const hidden = jobs.find(
      (job) => places.length > 0 && !job.areas.some((area) => places.includes(area)),
    );
    note(jobs.length > 0 && jobs.length <= 40, `palette lists ${jobs.length} jobs (cap 40)`);
    console.log(
      'palette jobs',
      jobs.length,
      'pressed',
      JSON.stringify(pressed),
      'places',
      places.join(','),
      'hidden',
      hidden ? `${hidden.company} areas=${hidden.areas.join('|') || 'none'}` : 'none',
    );
    await shot(page, 'palette-1440');
    if (hidden) {
      const palette = page.getByRole('dialog');
      await palette
        .getByRole('option', { name: hidden.company })
        .first()
        .waitFor({ timeout: 15_000 });
      for (let i = 0; i < 5; i++) {
        const tag = await page.evaluate(() => document.activeElement?.tagName ?? '');
        if (tag === 'INPUT') break;
        await page.keyboard.press('Tab');
      }
      // The id is part of the command value, so this matches that one job and not another at the same company.
      await page.keyboard.type(`job-${hidden.id}`);
      await page.waitForTimeout(200);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => location.search.includes('where=anywhere'), undefined, {
        timeout: 15_000,
      });
      const landed = new URL(page.url());
      note(
        landed.searchParams.get('where') === 'anywhere',
        `⌘K to ${hidden.company} (outside Where) switches to anywhere`,
      );
      const picked = await page.locator('[role="option"][aria-selected="true"]').innerText();
      const companyHit = picked.toLowerCase().includes(hidden.company.toLowerCase().slice(0, 40));
      note(companyHit, `selected row is ${hidden.company}`);
      console.log(
        'path: ⌘K',
        hidden.company,
        landed.pathname + landed.search,
        picked.split('\n')[0],
      );
    } else {
      await page.keyboard.press('Escape');
      note(false, `no palette job is hidden by Where (${places.join(',') || 'anywhere'})`);
    }
    await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 5_000 });
    await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (el && el.tagName === 'INPUT') el.blur();
    });

    await page.keyboard.press('?');
    await page.getByRole('dialog', { name: /shortcut/i }).waitFor({ timeout: 5_000 });
    note(true, '? opens the shortcuts dialog');
    await shot(page, 'shortcuts-1440');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 5_000 });
    note(true, 'Escape closes the shortcuts dialog');

    for (const [w, h] of [
      [1024, 768],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.keyboard.press('Control+k');
      await page.getByRole('dialog').waitFor();
      await shot(page, `palette-${w}`);
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.keyboard.press('?');
      await page.getByRole('dialog', { name: /shortcut/i }).waitFor();
      await shot(page, `shortcuts-${w}`);
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(400);

    // On Shortlist, S prepares the selected job. An empty key must fail closed.
    // The sidebar link is the keyboard path; its href keeps the current Where.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (let i = 0; i < 40; i++) {
      const href = await page.evaluate(() => document.activeElement?.getAttribute('href') ?? '');
      if (href.startsWith('/shortlist')) break;
      await page.keyboard.press('Tab');
    }
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.pathname === '/shortlist', undefined, {
      timeout: 15_000,
    });
    await page.locator('[role="option"]').first().waitFor();
    console.log('path: Tab to Shortlist', page.url());
    await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (el && el.tagName === 'INPUT') el.blur();
    });
    const appsAtPrep = q('select count(*) from applications');
    await page.keyboard.press('s');
    await toast(page, "Couldn't prepare").waitFor({ timeout: 20_000 });
    note(
      q('select count(*) from applications') === appsAtPrep,
      `Prepare with no API key adds no application (still ${appsAtPrep})`,
    );
    console.log('path: S on Shortlist prepares (no model; empty API key)');

    // The prepared application, still with the keyboard: sidebar In progress, then the row.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (let i = 0; i < 40; i++) {
      const href = await page.evaluate(() => document.activeElement?.getAttribute('href') ?? '');
      if (href === '/applications') break;
      await page.keyboard.press('Tab');
    }
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /\/applications\/?$/.test(location.pathname), undefined, {
      timeout: 15_000,
    });
    console.log('path: Tab to In progress', page.url());
    const appHref = `/applications/${appId}`;
    await tabToHref(page, appHref);
    console.log('path: Tab to', appHref);
    await page.keyboard.press('Enter');
    await page.waitForFunction((id) => location.pathname === `/applications/${id}`, appId, {
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Open & fill' }).waitFor({ timeout: 30_000 });
    console.log('path: workspace', page.url());

    dedicated = spawn(
      chrome,
      [
        '--headless=new',
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${CHROME_DIR}`,
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    await waitFor(() => reachable(`${cdp}/json/version`), 'dedicated Chrome');
    const fillName = await tabTo(page, /^Open & fill$/);
    console.log('path: Tab to', fillName);
    await page.keyboard.press('Enter');
    await toast(page, 'Filled the application in Chrome').waitFor({ timeout: 120_000 });
    note(true, 'Enter on Open & fill fills the local form');
    await new Promise((r) => setTimeout(r, 500));
    note(submits === 0, `submits on the form: ${submits}`);
    const markName = await tabTo(page, /^Mark submitted$/);
    console.log('path: Tab to', markName);
    await page.keyboard.press('Enter');
    await toast(page, 'Marked submitted').waitFor({ timeout: 15_000 });
    note(true, 'Enter on Mark submitted');
    const status = q(`select status from applications where id = ${appId}`);
    note(status === 'submitted', `copy status is ${status}`);
    await shot(page, 'keyboard-submitted-1440');

    // Phone: the sheet opens with Enter, and Back (keyboard) closes it. No sideways scroll.
    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of ['/', '/new', '/shortlist', '/unscored', '/applications']) {
      await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' });
      await page.locator('h1, [role="option"]').first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(400);
      await noSideways(page, route);
    }
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('[role="option"]').first().waitFor();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Back' }).waitFor({ timeout: 5_000 });
    const back = await tabTo(page, /^Back$/);
    console.log('path: phone Tab to', back);
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Back' }).waitFor({ state: 'hidden', timeout: 5_000 });
    note(true, 'phone: Enter opens the job sheet, Back returns to the list');
    await shot(page, 'phone-back-390');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    const motion = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.transition = 'opacity 300ms';
      document.body.appendChild(probe);
      const duration = getComputedStyle(probe).transitionDuration;
      probe.remove();
      return duration;
    });
    note(motion === '0.001s' || motion === '1ms', `reduced motion duration is ${motion}`);

    const usage = q("select count(*) from events where type = 'llm_usage'");
    const usageReal = sql(REAL_DB, "select count(*) from events where type = 'llm_usage'");
    note(usage === usageReal, `copy llm_usage ${usage} equals the real db ${usageReal} (no model)`);
    note(
      q('select count(*) from applications') === appsBefore,
      'copy application count unchanged except the status edit',
    );
    // The status edit is on an existing row, so the count matches appsBefore.
    note(errors.length === 0, `console errors: ${errors.length}`);
    for (const err of errors) console.log('console', err);
    await page.close();
  } catch (err) {
    console.log('server log tail:\n', serverLog.slice(-3000));
    throw err;
  } finally {
    await browser.close();
    dedicated?.kill('SIGTERM');
    server.kill('SIGTERM');
    fixture.close();
    await new Promise((r) => setTimeout(r, 1500));
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${COPY}${suffix}`, { force: true });
    rmSync(TMP, { recursive: true, force: true });
    const countsAfter = sql(
      REAL_DB,
      'select (select count(*) from applications), (select count(*) from jobs)',
    );
    const stray = sql(
      REAL_DB,
      `select count(*) from events where id > ${realEventMax} and type != 'llm_usage'`,
    );
    note(
      countsAfter === realCounts.split('|').slice(0, 2).join('|') && stray === '0',
      `real db applications and jobs unchanged (${countsAfter}); non-score events added: ${stray}`,
    );
    const after = configHashes(join(ROOT, 'config'));
    note(
      [...realConfig].every(([name, hash]) => after.get(name) === hash),
      'real config/ unchanged',
    );
    note(!existsSync(COPY), 'deleted data/j8-walkthrough.db');
  }

  if (problems.length) {
    console.log(`FAILED ${problems.length}`);
    process.exit(1);
  }
  console.log('keyboard walkthrough passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
