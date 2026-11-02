/**
 * J7 acceptance, against data/j7-walkthrough.db (a `.backup` copy) and a copy of config/.
 * Run after `NEXT_DIST_DIR=.next-shoot pnpm build`, with nothing listening on port 9222:
 *
 *   pnpm exec tsx tests/e2e/applications.run.ts
 *
 * Screenshots the lists and the workspace at three sizes (and the prototype where a view
 * has no frame), then times one application from the list to Mark submitted: Open & fill
 * against the saved Ashby form served locally, Looks good on each draft, Mark submitted.
 * Then checks that approvals, edits, a status change, a note and a follow-up date survive
 * a reload and show in Activity, that CSV export opens, and that the form saw no submit.
 *
 * In the copy only, the Ashby job's apply URL points at the local form, and its resume
 * path at a temp copy, so the fill writes nothing under output/. No model is called: the
 * server starts with an empty ANTHROPIC_API_KEY, and llm_usage is counted before and after.
 * Deletes the copy at the end. Never writes data/jobhacker.db, config/ or output/.
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
const COPY = join(ROOT, 'data/j7-walkthrough.db');
const TMP = mkdtempSync(join(tmpdir(), 'j7-walkthrough-'));
const CONFIG = join(TMP, 'config');
const WORK = join(TMP, 'output');
const CHROME_DIR = join(TMP, 'chrome');
const SHOTS = join(ROOT, 'docs/testing/screenshots/J7');
const PROTOTYPE = `file://${join(ROOT, 'ui-reference/prototype.html')}`;
const FIXTURE = join(ROOT, 'tests/fixtures/forms/ashby-application.html');
const CDP = 'http://127.0.0.1:9222';
const chrome = resolveChrome();
if (!chrome) throw new Error('Chrome is not installed');

const SIZES = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

/** Event names and paths that must never reach the page (UI-KIT § Checks 5, J7 acceptance 6). */
const PLUMBING = /llm_usage|draft_answers|\/Users\/|data\/(?:jobhacker|logs|seeds)|jobhacker\.db/g;
const INTERNAL_NAMES =
  /\b(?:llm_usage|draft_answers|answer_approved|follow_up(?:_at)?|submitted_at|value_hash|fill_report|unfilled_required|skipped_eeo|self_identification|resume_html|resume_pdf_path|apply_url)\b/;

/** Counts every way the page could be submitted; the fill must leave all of them at zero. */
const SUBMIT_COUNTER = `<script>
  window.__submits = 0;
  document.addEventListener('submit', function (e) { window.__submits += 1; e.preventDefault(); }, true);
  HTMLFormElement.prototype.submit = function () { window.__submits += 1; };
  HTMLFormElement.prototype.requestSubmit = function () { window.__submits += 1; };
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

async function noSideways(page: Page, label: string): Promise<void> {
  const wide = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  note(!wide, `no sideways scroll: ${label}`);
}

function toast(page: Page, text: string) {
  return page.locator('[data-sonner-toast]', { hasText: text }).first();
}

async function internalNamesIn(page: Page, label: string): Promise<void> {
  const text = await page.evaluate(() => document.body.innerText);
  const match = text.match(INTERNAL_NAMES);
  note(!match, `no internal event names in the DOM text: ${label}${match ? ` (${match[0]})` : ''}`);
}

async function openWorkspace(page: Page, base: string, id: number): Promise<void> {
  await page.goto(`${base}/applications/${id}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByRole('tab', { name: /^Apply/ }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);
}

async function tab(page: Page, name: string | RegExp): Promise<void> {
  await page.getByRole('tab', { name }).click();
  await page.waitForTimeout(500);
}

async function newPage(
  browser: Browser,
  size: { width: number; height: number },
  errors: string[],
) {
  const page = await browser.newPage({ viewport: size });
  listen(page, errors);
  await installBrandfetchStandIns(page, { delayMs: 0 });
  return page;
}

/** Applications: the lists and the workspace's tabs at every size, before anything changes. */
async function screens(
  browser: Browser,
  base: string,
  ids: { linear: number; fallback: number | null },
  errors: string[],
): Promise<void> {
  for (const size of SIZES) {
    const w = size.width;
    const page = await newPage(browser, size, errors);
    for (const [route, name] of [
      ['/applications', `10-applications-${w}`],
      ['/applications/submitted', `applications-submitted-${w}`],
      ['/applications/follow-ups', `applications-follow-ups-${w}`],
    ] as const) {
      await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.locator('h1').first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(500);
      await shot(page, name);
      await noSideways(page, `${route} at ${w}`);
      if (w === 1440 && route === '/applications') {
        const logos = await page.locator('img[src*="cdn.brandfetch.io"]').count();
        note(logos > 0, `Brandfetch logo imgs on /applications: ${logos}`);
      }
    }

    await openWorkspace(page, base, ids.linear);
    await shot(page, `11-workspace-apply-${w}`);
    if (w !== 1024) await shot(page, `33-workspace-header-${w}`);
    await noSideways(page, `workspace apply at ${w}`);
    if (w === 1440) {
      const logos = await page.locator('img[src*="cdn.brandfetch.io"]').count();
      note(logos > 0, `Brandfetch logo imgs on the workspace: ${logos}`);
      await page.mouse.move(800, 500);
      await page.mouse.wheel(0, 700);
      await page.waitForTimeout(600);
      await shot(page, '12-workspace-apply-scrolled-1440');
      await page.mouse.wheel(0, -3000);
      await page.waitForTimeout(400);
    }
    await internalNamesIn(page, `Apply tab at ${w}`);
    for (const [name, frame] of [
      ['Resume', '14-workspace-resume'],
      ['Cover note', 'workspace-cover'],
      ['Answers', '15a-workspace-answers'],
      ['Activity', '15-workspace-activity'],
    ] as const) {
      await tab(page, name);
      if (name === 'Resume') await page.waitForTimeout(1200);
      await shot(page, `${frame}-${w}`);
      await noSideways(page, `workspace ${name} at ${w}`);
      await internalNamesIn(page, `${name} tab at ${w}`);
    }

    if (ids.fallback !== null) {
      await openWorkspace(page, base, ids.fallback);
      await shot(page, `workspace-no-filler-${w}`);
      await noSideways(page, `workspace with no filler at ${w}`);
      const open = await page
        .getByRole('button', { name: /Answers to copy and paste/ })
        .getAttribute('aria-expanded');
      note(open === 'true', `copy-paste fallback opens itself when the site has no filler (${w})`);
    }

    await page.goto(`${base}/applications/999999`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Application not found' }).waitFor({ timeout: 30_000 });
    await shot(page, `workspace-not-found-${w}`);
    await page.close();
  }
}

/** The prototype in the same view, for screens the reference has no frame of. */
async function prototypeRefs(browser: Browser, errors: string[]): Promise<void> {
  for (const size of SIZES) {
    const w = size.width;
    const mobile = w < 768;
    const page = await newPage(browser, size, errors);
    await page.goto(PROTOTYPE);
    await page.waitForTimeout(1400);
    const nav = async (name: RegExp) => {
      if (mobile) {
        await page.getByRole('button', { name: 'Open navigation' }).first().click();
        await page.waitForTimeout(600);
      }
      await page.getByRole('link', { name }).first().click();
      await page.waitForTimeout(1000);
    };
    await nav(/Submitted/);
    await page.screenshot({ path: join(SHOTS, `applications-submitted-${w}.ref.png`) });
    await nav(/Follow-ups/);
    await page.screenshot({ path: join(SHOTS, `applications-follow-ups-${w}.ref.png`) });
    await nav(/In progress/);
    await page.getByRole('button', { name: /Senior \/ Staff Fullstack Engineer/ }).click();
    await page.waitForTimeout(900);
    await page.getByRole('tab', { name: 'Cover note' }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(SHOTS, `workspace-cover-${w}.ref.png`) });
    console.log('ref', w);
    await page.close();
  }
}

/** Plumbing in the server-rendered HTML of every touched route (UI-KIT § Checks 5). */
async function plumbing(base: string, routes: string[]): Promise<void> {
  for (const route of routes) {
    const html = await (await fetch(`${base}${route}`)).text();
    const found = html.match(PLUMBING) ?? [];
    note(
      found.length === 0,
      `Check 5 ${route}: ${found.length}${found.length ? ` (${[...new Set(found)].join(',')})` : ''}`,
    );
  }
}

async function submitsOnForm(): Promise<number | null> {
  const cdp = await chromium.connectOverCDP(CDP);
  try {
    const form = cdp
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => p.url().includes('/ashby'));
    if (!form) return null;
    return await form.evaluate(() => {
      const w = window as unknown as { __submits?: number; __ashbySubmits?: number };
      return (w.__submits ?? 0) + (w.__ashbySubmits ?? 0);
    });
  } finally {
    await cdp.close();
  }
}

function eventCount(type: string, appId: number): number {
  return Number(q(`select count(*) from events where type='${type}' and application_id=${appId}`));
}

async function main(): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(WORK, { recursive: true });
  if (await reachable(`${CDP}/json/version`)) {
    throw new Error(
      'Something already listens on 9222 (your Chrome?). Quit it and run this again.',
    );
  }
  const realConfig = configHashes(join(ROOT, 'config'));
  const realCounts = sql(
    REAL_DB,
    'select (select count(*) from applications), (select count(*) from events), (select max(id) from events)',
  );
  console.log('real db applications|events|max event id before:', realCounts);

  rmSync(COPY, { force: true });
  execFileSync('sqlite3', ['data/jobhacker.db', '.backup data/j7-walkthrough.db'], { cwd: ROOT });
  cpSync(join(ROOT, 'config'), CONFIG, { recursive: true });

  const [linear, linearJob, resumePath] = q(
    `select a.id, a.job_id, a.resume_pdf_path from applications a join jobs j on j.id = a.job_id
     where a.status = 'prepped' and j.ats = 'ashby' and a.fill_report is not null order by a.id limit 1`,
  ).split('|');
  const appId = Number(linear);
  const jobId = Number(linearJob);
  if (!appId || !resumePath)
    throw new Error('No prepped Ashby application with a fill report in the copy');
  const fallbackRaw = q(
    `select a.id from applications a join jobs j on j.id = a.job_id
     where j.ats not in ('greenhouse', 'lever', 'ashby', 'smartrecruiters') order by a.id limit 1`,
  );
  const fallback = fallbackRaw ? Number(fallbackRaw) : null;
  console.log(`walkthrough application ${appId} (job ${jobId}); no-filler application ${fallback}`);

  const fixtureHtml = readFileSync(FIXTURE, 'utf8').replace('<head>', `<head>${SUBMIT_COUNTER}`);
  const fixture = createHttpServer((req, res) => {
    if (req.url?.startsWith('/ashby')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(fixtureHtml);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  const fixturePort = await freePort();
  await new Promise<void>((resolve) => fixture.listen(fixturePort, '127.0.0.1', resolve));
  const fixtureUrl = `http://127.0.0.1:${fixturePort}/ashby`;

  cpSync(resumePath, join(WORK, 'resume.pdf'));
  console.log(
    'copy rows before:',
    q('select count(*) from applications; select count(*) from jobs').replace(
      '\n',
      ' applications, ',
    ),
    'jobs',
  );
  const changed = q(
    `update jobs set apply_url = '${fixtureUrl}' where id = ${jobId}; select changes();
     update applications set resume_pdf_path = '${join(WORK, 'resume.pdf')}' where id = ${appId}; select changes();`,
  );
  console.log('copy rows changed (apply_url, resume path):', changed.replace('\n', ', '));
  console.log(
    'copy rows after:',
    q('select count(*) from applications; select count(*) from jobs').replace(
      '\n',
      ' applications, ',
    ),
    'jobs',
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
  let dedicated: ReturnType<typeof spawn> | undefined;
  const errors: string[] = [];
  try {
    await waitFor(async () => {
      try {
        return (await fetch(base, { redirect: 'manual' })).status < 500;
      } catch {
        return false;
      }
    }, 'next start');
    const usageBefore = Number(q("select count(*) from events where type = 'llm_usage'"));

    // 1. Every touched route at three sizes, plus the prototype where there's no frame.
    await screens(browser, base, { linear: appId, fallback }, errors);
    await prototypeRefs(browser, []);
    await plumbing(base, [
      '/applications',
      '/applications/submitted',
      '/applications/follow-ups',
      `/applications/${appId}`,
      ...(fallback !== null ? [`/applications/${fallback}`] : []),
      `/job/${jobId}`,
    ]);

    const page = await newPage(browser, SIZES[0], errors);

    // 2. Chrome isn't running yet: Open & fill says how to start it.
    await openWorkspace(page, base, appId);
    await page.getByRole('button', { name: 'Open & fill' }).click();
    await page.getByText("Chrome isn't running with remote debugging").waitFor({ timeout: 30_000 });
    note(true, 'Open & fill with Chrome down shows the launch command');
    await page.waitForTimeout(400);
    await shot(page, 'workspace-chrome-down-1440');

    // 3. Approval, cover note and answer edits survive a reload.
    await openWorkspace(page, base, appId);
    const reviewBefore = await page.getByRole('button', { name: 'Looks good' }).count();
    const approvedBefore = eventCount('answer_approved', appId);
    await page.getByRole('button', { name: 'Looks good' }).first().click();
    await page.waitForTimeout(1200);
    await page.mouse.move(800, 500);
    await page.mouse.wheel(0, -3000);
    await page.waitForTimeout(300);
    await shot(page, '13-workspace-approved-1440');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: /^Apply/ }).waitFor();
    await page.waitForTimeout(600);
    const reviewAfter = await page.getByRole('button', { name: 'Looks good' }).count();
    note(
      reviewAfter === reviewBefore - 1 &&
        eventCount('answer_approved', appId) === approvedBefore + 1,
      `Looks good persists across a reload (drafts to check ${reviewBefore} → ${reviewAfter})`,
    );

    const marker = `Walkthrough edit ${Date.now()}.`;
    await tab(page, 'Cover note');
    const cover = page.locator('#cover-note');
    await cover.fill(`${await cover.inputValue()}\n\n${marker}`);
    await page.getByText('Unsaved changes').first().waitFor();
    note(true, 'cover note edit is marked "Unsaved changes"');
    await page.getByRole('tabpanel').getByRole('button', { name: 'Save', exact: true }).click();
    await toast(page, 'Saved cover note').waitFor({ timeout: 15_000 });
    await shot(page, 'workspace-cover-saved-1440');

    await tab(page, 'Answers');
    const questions = page
      .locator('section', { hasText: "Questions on this job's form" })
      .locator('textarea');
    const firstQuestion = questions.first();
    const answerBefore = await firstQuestion.inputValue();
    await firstQuestion.fill(`${answerBefore} ${marker}`);
    await page.getByRole('tabpanel').getByRole('button', { name: 'Save', exact: true }).click();
    await toast(page, 'Saved answers').waitFor({ timeout: 15_000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: /^Apply/ }).waitFor();
    await page.waitForTimeout(600);
    await tab(page, 'Cover note');
    note(
      (await page.locator('#cover-note').inputValue()).endsWith(marker),
      'cover note edit survives a reload',
    );
    await tab(page, 'Answers');
    note((await questions.first().inputValue()).endsWith(marker), 'answer edit survives a reload');
    const edited = Number(
      q(
        `select count(*) from events where type='answer_approved' and application_id=${appId} and json_extract(payload, '$.edited') = 1`,
      ),
    );
    console.log('edited-answer approvals recorded:', edited);
    await page.close();

    // 4. Timed: list → workspace → Open & fill → Looks good on each draft → Mark submitted.
    dedicated = spawn(
      chrome,
      [
        '--headless=new',
        '--remote-debugging-port=9222',
        `--user-data-dir=${CHROME_DIR}`,
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    await waitFor(() => reachable(`${CDP}/json/version`), 'the stand-in dedicated Chrome');
    const fillsBefore = eventCount('fill', appId);
    const timed = await newPage(browser, SIZES[0], errors);
    // The readiness card and the sidebar's In progress count, as the page shows them now.
    const viewOf = async (page: Page) => {
      const [card, sidebar] = await page.evaluate(() => {
        const label = [...document.querySelectorAll('div')].find(
          (el) => el.textContent?.trim() === 'fields filled',
        );
        const link = [...document.querySelectorAll('a[href="/applications"]')].find((a) =>
          a.textContent?.includes('In progress'),
        );
        return [label?.closest('.surface-card')?.textContent ?? '', link?.textContent ?? ''];
      });
      const squash = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
      return `${squash(card) || 'no readiness card'} | sidebar ${squash(sidebar) || 'none'}`;
    };
    // Polls until the page shows `until` (or anything but `from`); returns the ms it took, or null.
    const settle = async (page: Page, want: { until?: string; from?: string }, ms = 15_000) => {
      const start = Date.now();
      while (Date.now() - start < ms) {
        const now = await viewOf(page);
        if (want.until !== undefined ? now === want.until : now !== want.from) {
          return Date.now() - start;
        }
        await page.waitForTimeout(100);
      }
      return null;
    };

    const t0 = Date.now();
    await timed.goto(`${base}/applications`, { waitUntil: 'domcontentloaded' });
    await timed.locator(`a[href="/applications/${appId}"]`).first().click();
    await timed.getByRole('button', { name: 'Open & fill' }).waitFor();
    await timed.waitForTimeout(300);
    const beforeFill = await viewOf(timed);
    const tFill = Date.now();
    await timed.getByRole('button', { name: 'Open & fill' }).click();
    await timed.getByRole('button', { name: 'Filling in Chrome' }).waitFor({ timeout: 5_000 });
    note(true, 'Open & fill shows "Filling in Chrome" while it runs');
    await toast(timed, 'Filled the application in Chrome').waitFor({ timeout: 120_000 });
    const fillMs = Date.now() - tFill;
    const reportMs = await settle(timed, { from: beforeFill });
    note(reportMs !== null, `the fill report refreshed ${reportMs}ms after the fill toast`);
    await shot(timed, 'workspace-after-fill-1440');
    let approvals = 0;
    for (let i = 0; i < 12; i++) {
      const button = timed.getByRole('button', { name: 'Looks good' });
      if ((await button.count()) === 0) break;
      await button.first().click();
      approvals += 1;
      await timed.waitForTimeout(400);
    }
    await timed.getByRole('button', { name: 'Mark submitted' }).click();
    await toast(timed, 'Marked submitted').waitFor({ timeout: 15_000 });
    const elapsed = Date.now() - t0;
    try {
      await timed
        .getByRole('button', { name: 'Submitted', exact: true })
        .waitFor({ timeout: 15_000 });
      note(true, `the header reads Submitted ${Date.now() - t0 - elapsed}ms after the toast`);
    } catch {
      note(false, 'the header reads Submitted after Mark submitted');
    }
    const freshPage = await newPage(browser, SIZES[0], errors);
    await freshPage.goto(`${base}/applications/${appId}`, { waitUntil: 'domcontentloaded' });
    await freshPage.getByRole('button', { name: 'Submitted', exact: true }).waitFor();
    const fresh = await viewOf(freshPage);
    await freshPage.close();
    const caughtUp = await settle(timed, { until: fresh });
    console.log(`after Mark submitted, no reload: ${await viewOf(timed)}`);
    console.log(`a fresh load:                    ${fresh}`);
    note(
      caughtUp !== null,
      `with no reload, the readiness card and sidebar match a fresh load within ${Date.now() - t0 - elapsed}ms of the toast`,
    );
    await shot(timed, 'workspace-submitted-1440');
    console.log(
      `TIMED prepped → submitted: ${(elapsed / 1000).toFixed(1)}s (Open & fill ${(fillMs / 1000).toFixed(1)}s, ${approvals} Looks good)`,
    );

    const report = JSON.parse(q(`select fill_report from applications where id = ${appId}`)) as {
      filled: { via: string }[];
      unfilled: unknown[];
      self_identification?: unknown[];
      skipped_eeo?: unknown[];
    };
    console.log(
      `fill report: ${report.filled.length} filled (${report.filled.filter((f) => f.via === 'draft').length} drafted), ${report.unfilled.length} blank, self-id ${report.self_identification?.length ?? 0} set, ${report.skipped_eeo?.length ?? 0} skipped`,
    );
    note(eventCount('fill', appId) === fillsBefore + 1, 'the fill wrote one fill event');
    const submits = await submitsOnForm();
    note(submits === 0, `submits recorded on the filled form: ${submits}`);
    const [status, submittedAt, followUpAt] = q(
      `select status, submitted_at, follow_up_at from applications where id = ${appId}`,
    ).split('|');
    const days = (Date.parse(followUpAt ?? '') - Date.parse(submittedAt ?? '')) / 86_400_000;
    note(
      status === 'submitted' && days === 7,
      `marked submitted: status ${status}, follow-up +${days} days`,
    );
    note(eventCount('submitted', appId) === 1, 'one submitted event');

    // 5. Status change, note and follow-up edit persist and show in Activity.
    await timed.getByRole('button', { name: 'Change status' }).click();
    await timed.getByRole('menuitemradio', { name: 'Interviewing' }).click();
    await toast(timed, 'Moved to Interviewing').waitFor({ timeout: 15_000 });
    await timed.waitForTimeout(600);
    await tab(timed, 'Activity');
    const today = new Date();
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const followUp = timed.locator('section', { has: timed.locator('#follow-up') });
    await timed.locator('#follow-up').fill(iso(today));
    await followUp.getByRole('button', { name: 'Save' }).click();
    await toast(timed, 'Saved follow-up date').waitFor({ timeout: 15_000 });
    const notes = timed.locator('section', { has: timed.locator('#notes') });
    await timed.locator('#notes').fill('Recruiter call on Thursday.');
    await notes.getByRole('button', { name: 'Save' }).click();
    await toast(timed, 'Saved notes').waitFor({ timeout: 15_000 });
    await timed.reload({ waitUntil: 'domcontentloaded' });
    await timed.getByRole('tab', { name: /^Apply/ }).waitFor();
    await timed.waitForTimeout(600);
    await tab(timed, 'Activity');
    const titles = await timed.locator('ol li').allInnerTexts();
    const flat = titles.map((t) => t.split('\n')[0]?.trim() ?? '');
    console.log('activity titles after reload:', JSON.stringify(flat));
    const shortToday = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    for (const want of [
      'Moved to Interviewing',
      `Follow-up set for ${shortToday}`,
      'Saved notes',
      'Marked submitted',
      'Filled the application in Chrome',
      'Approved a drafted answer',
    ]) {
      note(
        flat.some((t) => t.startsWith(want)),
        `Activity shows "${want}" after a reload`,
      );
    }
    note(
      (await timed.locator('#follow-up').inputValue()) === iso(today),
      'follow-up date survives a reload',
    );
    note(
      (await timed.locator('#notes').inputValue()) === 'Recruiter call on Thursday.',
      'notes survive a reload',
    );
    note(
      (await timed.getByText('Interviewing', { exact: true }).count()) > 0,
      'status chip reads Interviewing after a reload',
    );
    await internalNamesIn(timed, 'Activity after the walkthrough');
    await timed.mouse.move(800, 500);
    await timed.mouse.wheel(0, 500);
    await timed.waitForTimeout(400);
    await shot(timed, 'workspace-activity-after-1440');

    await timed.goto(`${base}/applications/follow-ups`, { waitUntil: 'domcontentloaded' });
    await timed.locator('h1').first().waitFor();
    await timed.waitForTimeout(500);
    note(
      (await timed.locator(`a[href="/applications/${appId}"]`).count()) === 1,
      'a follow-up dated today lists under Follow-ups',
    );
    await shot(timed, 'applications-follow-ups-due-1440');
    await timed.goto(`${base}/applications/submitted`, { waitUntil: 'domcontentloaded' });
    await timed.locator('h1').first().waitFor();
    await timed.waitForTimeout(500);
    note(
      (await timed.locator(`a[href="/applications/${appId}"]`).count()) === 1,
      'the submitted application lists under Submitted',
    );
    await shot(timed, 'applications-submitted-after-1440');
    await timed.close();

    const csv = await fetch(`${base}/applications/export`);
    const body = await csv.text();
    const lines = body.trim().split('\n').length;
    const apps = Number(q('select count(*) from applications'));
    console.log(
      'CSV',
      csv.status,
      csv.headers.get('content-type'),
      `${lines} lines`,
      `header: ${body.split('\n')[0]}`,
    );
    note(
      csv.status === 200 &&
        (csv.headers.get('content-type') ?? '').includes('text/csv') &&
        lines >= apps + 1,
      `CSV export opens (${lines} lines for ${apps} applications)`,
    );

    const usageAfter = Number(q("select count(*) from events where type = 'llm_usage'"));
    note(usageAfter === usageBefore, `llm_usage unchanged (${usageBefore} → ${usageAfter})`);
    note(errors.length === 0, `console errors on touched routes: ${errors.length}`);
    for (const err of errors) console.log('console', err);
  } catch (err) {
    console.log('server log tail:\n', serverLog.slice(-4000));
    throw err;
  } finally {
    await browser.close();
    dedicated?.kill('SIGTERM');
    server.kill('SIGTERM');
    fixture.close();
    await new Promise((r) => setTimeout(r, 1500));
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${COPY}${suffix}`, { force: true });
    rmSync(TMP, { recursive: true, force: true });
    note(!existsSync(COPY), 'deleted data/j7-walkthrough.db');
    const after = configHashes(join(ROOT, 'config'));
    note(
      [...realConfig].every(([name, hash]) => after.get(name) === hash),
      'real config/ files unchanged',
    );
    const countsAfter = sql(
      REAL_DB,
      'select (select count(*) from applications), (select count(*) from events), (select max(id) from events)',
    );
    console.log('real db applications|events|max event id after: ', countsAfter);
  }
  if (problems.length) {
    console.log(`\n${problems.length} problem(s)`);
    for (const p of problems) console.log(' -', p);
    process.exitCode = 1;
  } else {
    console.log('\nall checks passed');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
