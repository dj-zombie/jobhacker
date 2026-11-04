/**
 * J14 verify: the Start fresh dialog on a database copy, through Confirm.
 * Checks the dialog's counts against `planReset`, near-miss text, Escape,
 * Cancel, a live scout refusing Confirm, then Confirm and the after counts.
 * Refuses to run without a DATABASE_PATH copy and a JOBHACKER_BACKUP_DIR.
 *
 *   sqlite3 data/jobhacker.db ".backup /tmp/j14.db"
 *   NEXT_DIST_DIR=.next-shoot pnpm build
 *   DATABASE_PATH=/tmp/j14.db JOBHACKER_BACKUP_DIR=/tmp/j14-backups NEXT_DIST_DIR=.next-shoot \
 *     pnpm exec tsx tests/e2e/reset-confirm.run.ts
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { basename, join } from 'node:path';
import Database from 'better-sqlite3';
import { type Page, chromium } from 'playwright-core';
import { resolveChrome } from '../../src/core/apply/browser.js';
import { openExistingDb } from '../../src/core/db/client.js';
import { type ResetPlan, planReset } from '../../src/core/db/reset.js';
import { installBrandfetchStandIns, isBrandfetchLoadError } from './brandfetch.js';

const DB = process.env.DATABASE_PATH;
const BACKUPS = process.env.JOBHACKER_BACKUP_DIR;
if (!DB || basename(DB) === 'jobhacker.db' || !BACKUPS) {
  throw new Error('Set DATABASE_PATH to a copy (not jobhacker.db) and JOBHACKER_BACKUP_DIR.');
}
const dbPath = DB;
const backupDir = BACKUPS;

const VIEWPORTS = [
  { width: 1440, height: 900, size: '1440' },
  { width: 1024, height: 768, size: '1024' },
  { width: 390, height: 844, size: '390' },
] as const;
const OUT = process.env.J14_SHOTS_DIR ?? join('docs/testing/screenshots/J14/verify');
const TABLES = [
  'companies',
  'jobs',
  'job_areas',
  'job_scores',
  'applications',
  'events',
  'runs',
  'company_domains',
  'source_usage',
];

function counts(): Record<string, number> {
  const sqlite = new Database(dbPath, { readonly: true });
  try {
    return Object.fromEntries(
      TABLES.map((table) => [
        table,
        (sqlite.prepare(`select count(*) as n from "${table}"`).get() as { n: number }).n,
      ]),
    );
  } finally {
    sqlite.close();
  }
}

function plan(): ResetPlan {
  const { db, sqlite } = openExistingDb(dbPath);
  try {
    return planReset(db);
  } finally {
    sqlite.close();
  }
}

function backups(): string[] {
  return existsSync(backupDir) ? readdirSync(backupDir) : [];
}

function check(ok: boolean, message: string): void {
  if (!ok) throw new Error(message);
  console.log(`ok  ${message}`);
}

function same(a: Record<string, number>, b: Record<string, number>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The dialog's rows, as label → number, from its rendered text. */
async function dialogRows(page: Page): Promise<Record<string, number>> {
  const items = await page.getByRole('dialog').locator('li').allInnerTexts();
  return Object.fromEntries(
    items.map((text) => {
      const [label = '', value = ''] = text.split('\n').map((part) => part.trim());
      return [label, Number(value.replace(/,/g, ''))];
    }),
  );
}

function planRows(p: ResetPlan): Record<string, number> {
  return {
    jobs: p.jobs,
    'with an application': p.jobsWithApplication,
    'without an application': p.jobsWithoutApplication,
    scores: p.jobScores,
    applications: p.applications,
    'company logos': p.companyDomains,
    'source budget rows': p.sourceUsage,
    'search companies removed': p.companiesRemoved,
    runs: p.runs,
    'events removed': p.eventsRemoved,
  };
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

async function openDialog(page: Page, mobile: boolean): Promise<void> {
  if (mobile) await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Start fresh' }).click();
  await page.getByRole('heading', { name: 'Start fresh' }).waitFor();
  await page.getByText('with an application', { exact: true }).waitFor();
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(backupDir, { recursive: true });
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child: ChildProcess = spawn('pnpm', ['exec', 'next', 'start', '-p', String(port)], {
    stdio: 'ignore',
    detached: true,
  });
  const errors: { viewport: string; kind: string; text: string }[] = [];
  try {
    await waitFor(base);
    const html = await fetch(base).then((res) => res.text());
    const leaked = html.match(
      /llm_usage|draft_answers|\/Users\/|data\/(?:jobhacker|logs|seeds)|jobhacker\.db/g,
    );
    console.log(`check 5 matches on /: ${leaked ? leaked.join(', ') : 0}`);

    const executablePath = resolveChrome();
    if (!executablePath) throw new Error('No Chrome found (set JOBHACKER_CHROME_PATH).');
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
      const start = counts();
      const expected = planRows(plan());
      for (const vp of VIEWPORTS) {
        const mobile = vp.size === '390';
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

        if (vp.size === '1440') {
          const logos = await page.getByRole('link', { name: 'Company logos' }).boundingBox();
          const fresh = await page.getByRole('button', { name: 'Start fresh' }).boundingBox();
          console.log(
            `sidebar ${vp.size}: Company logos x ${logos?.x} width ${logos?.width} · Start fresh x ${fresh?.x} width ${fresh?.width}`,
          );
          const clip = { x: 0, y: (logos?.y ?? 0) - 40, width: 260, height: 110 };
          await page.getByRole('link', { name: 'Company logos' }).hover();
          await page.screenshot({ path: join(OUT, `sidebar-hover-logos-${vp.size}.png`), clip });
          await page.getByRole('button', { name: 'Start fresh' }).hover();
          await page.screenshot({ path: join(OUT, `sidebar-hover-${vp.size}.png`), clip });
          await page.mouse.move(800, 450);
          await page.getByRole('link', { name: 'Company logos' }).focus();
          await page.keyboard.press('Tab');
          await page.screenshot({ path: join(OUT, `sidebar-focus-${vp.size}.png`), clip });
        }

        await openDialog(page, mobile);
        const confirm = page.getByRole('button', { name: 'Confirm' });
        const field = page.getByLabel('Type RESET to confirm');
        const shown = await dialogRows(page);
        check(
          same(shown, expected),
          `${vp.size}: dialog counts equal planReset ${JSON.stringify(shown)}`,
        );
        check(await confirm.isDisabled(), `${vp.size}: Confirm disabled with the field empty`);
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(OUT, `39-reset-${vp.size}.png`) });
        for (const near of ['reset', 'RESET ', ' RESET', 'RESE', 'RESETT']) {
          await field.fill(near);
          check(
            await confirm.isDisabled(),
            `${vp.size}: Confirm disabled for ${JSON.stringify(near)}`,
          );
        }
        await field.fill('RESET');
        check(!(await confirm.isDisabled()), `${vp.size}: Confirm enabled for "RESET"`);
        await page.waitForTimeout(200);
        await page.screenshot({ path: join(OUT, `39-reset-typed-${vp.size}.png`) });
        await page.getByRole('button', { name: 'Cancel' }).click();
        await page.getByRole('heading', { name: 'Start fresh' }).waitFor({ state: 'hidden' });

        await openDialog(page, mobile);
        check(
          (await field.inputValue()) === '',
          `${vp.size}: the field is empty when the dialog reopens`,
        );
        await page.keyboard.press('Escape');
        await page.getByRole('heading', { name: 'Start fresh' }).waitFor({ state: 'hidden' });
        check(true, `${vp.size}: Escape closes the dialog`);
        check(same(counts(), start), `${vp.size}: counts unchanged after Cancel and Escape`);
        check(backups().length === 0, `${vp.size}: no backup after Cancel and Escape`);
        await context.close();
      }

      const context = await browser.newContext({ viewport: VIEWPORTS[0], deviceScaleFactor: 1 });
      const page = await context.newPage();
      await installBrandfetchStandIns(page);
      page.on('console', (msg) => {
        if (msg.type() === 'error' && !isBrandfetchLoadError(msg.text(), msg.location().url)) {
          errors.push({ viewport: 'confirm', kind: 'console', text: msg.text() });
        }
      });
      page.on('pageerror', (err) =>
        errors.push({ viewport: 'confirm', kind: 'pageerror', text: err.message }),
      );
      await page.goto(`${base}/`, { waitUntil: 'networkidle' });

      const writer = new Database(dbPath);
      const live = writer
        .prepare(`insert into runs (kind, started_at) values ('scout', ?)`)
        .run(new Date().toISOString()).lastInsertRowid;
      writer.close();
      const withLive = counts();
      await openDialog(page, false);
      await page.getByLabel('Type RESET to confirm').fill('RESET');
      await page.getByRole('button', { name: 'Confirm' }).click();
      await page.getByText('A scout is running').waitFor();
      await page.screenshot({ path: join(OUT, '39-reset-refused-1440.png') });
      check(same(counts(), withLive), 'live scout: Confirm changed no row');
      check(backups().length === 0, 'live scout: Confirm wrote no backup');
      await page.getByRole('button', { name: 'Cancel' }).click();
      const cleaner = new Database(dbPath);
      cleaner.prepare('delete from runs where id = ?').run(live);
      cleaner.close();

      const before = plan();
      await openDialog(page, false);
      await page.getByLabel('Type RESET to confirm').fill('RESET');
      const clicked = Date.now();
      await page.getByRole('button', { name: 'Confirm' }).click();
      await page.getByRole('heading', { name: 'Queue cleared' }).waitFor({ timeout: 120_000 });
      console.log(`confirm took ${((Date.now() - clicked) / 1000).toFixed(1)}s`);
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(OUT, '39-reset-done-1440.png') });
      const after = plan();
      const done = await dialogRows(page);
      check(
        same(done, planRows(after)),
        `done: dialog shows the after counts ${JSON.stringify(done)}`,
      );
      check(
        after.jobs === before.jobsWithApplication,
        'done: jobs left are the ones with an application',
      );
      check(after.applications === before.applications, 'done: applications unchanged');
      check(after.companyDomains === before.companyDomains, 'done: company logos unchanged');
      check(after.sourceUsage === before.sourceUsage, 'done: source budget rows unchanged');
      check(after.jobScores === 0 && after.runs === 0, 'done: scores 0, runs 0');
      const files = backups();
      check(files.length === 1, `done: one backup written (${files.join(', ')})`);
      await page.getByRole('button', { name: 'Close' }).last().click();
      await page.getByRole('heading', { name: 'Queue cleared' }).waitFor({ state: 'hidden' });
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(OUT, 'after-reset-1440.png') });
      await context.close();
    } finally {
      await browser.close();
    }
  } finally {
    if (child.pid) process.kill(-child.pid, 'SIGTERM');
  }
  writeFileSync(join(OUT, 'console-errors.json'), `${JSON.stringify(errors, null, 2)}\n`);
  console.log(`console errors: ${errors.length} on / with the dialog open, 3 sizes and Confirm`);
  for (const error of errors) console.log(`  ${error.viewport} [${error.kind}] ${error.text}`);
  if (errors.length > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
