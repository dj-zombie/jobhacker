/**
 * J18 acceptance 5, 6 and 7, against a server that is already running on copies:
 *
 *   JOBHACKER_CONFIG_DIR=<copy> DATABASE_PATH=<copy> \
 *     pnpm exec tsx tests/e2e/settings.run.ts http://127.0.0.1:3100 notice|scout|sentinel [sentinel]
 *
 * The env must name the same config folder and database as the server's, since this script reads
 * the profile's sha256 and, for `scout`, opens a scout run in that database. It refuses the real
 * `config/` folder and the built-in database path.
 *
 * - `notice`: edit the summary, read the re-score notice's stale count, Save, and check the file
 *   changed. Then a second edit, Cancel, and the sha256 is unchanged.
 * - `scout`: open a scout run, try a summary save, and print the refusal. The sha256 is unchanged.
 *   The run is closed afterwards.
 * - `sentinel`: set the four self-ID values to the sentinel and save, count the sentinel in the
 *   HTML of every Settings route, then decline all four and save again.
 * - `states <out>`: screenshot the re-score notice, a refused email and an open year-only entry
 *   at the three sizes. The notice is cancelled and the email discarded, so nothing is written.
 *
 * It prints counts, hashes and the app's own messages, never a profile value.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type Page, chromium } from 'playwright-core';
import { resolveChrome } from '../../src/core/apply/browser.js';
import { createDb } from '../../src/core/db/client.js';
import { runsRepo } from '../../src/core/db/repo/runs.js';
import { startScoutRun } from '../../src/core/pipeline/scout.js';
import { systemClock } from '../../src/core/util/clock.js';
import { installBrandfetchStandIns } from './brandfetch.js';

const [base, part, sentinelArg] = process.argv.slice(2);
if (!base || !part) throw new Error('pass the server origin and notice, scout or sentinel');
const configDir = process.env.JOBHACKER_CONFIG_DIR;
const dbPath = process.env.DATABASE_PATH;
if (!configDir || !dbPath) throw new Error('set JOBHACKER_CONFIG_DIR and DATABASE_PATH to copies');
if (resolve(configDir) === resolve('config') || resolve(dbPath) === resolve('data/jobhacker.db')) {
  throw new Error('this writes the files it points at: use copies');
}
const chrome = resolveChrome();
if (!chrome) throw new Error('Chrome is not installed');

const profileFile = join(configDir, 'profile.yaml');
const sha = () => createHash('sha256').update(readFileSync(profileFile)).digest('hex').slice(0, 12);

/**
 * Load a route and wait until React has swapped in its streamed content. Until then the page
 * holds a second, hidden copy of the form (`<div hidden id="S:0">`), so every id is there twice.
 */
async function open(page: Page, route: string): Promise<void> {
  await page.goto(`${base}${route}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.querySelector('div[hidden][id^="S:"]'));
}

const section = (page: Page, id: string) => page.locator(`section[aria-labelledby="${id}-title"]`);

async function saveSummary(page: Page, suffix: string): Promise<void> {
  const box = page.locator('#settings-summary');
  await box.fill(`${await box.inputValue()}${suffix}`);
  await section(page, 'summary').getByRole('button', { name: 'Save', exact: true }).click();
}

async function notice(page: Page): Promise<void> {
  await open(page, '/settings/profile');
  const before = sha();
  await saveSummary(page, ' A test edit.');
  const dialog = page.getByRole('dialog', { name: 'This edit re-scores your jobs' });
  await dialog.waitFor();
  const text = (await dialog.innerText()).replace(/\s+/g, ' ');
  const stale = /Current scores that go stale ([\d,]+)/.exec(text)?.[1];
  const cost = /Estimated cost to re-score them (\S+)/.exec(text)?.[1];
  const perRun = /re-scores up to ([\d,]+)/.exec(text)?.[1];
  console.log(`notice: stale ${stale} · cost ${cost} · per run ${perRun}`);
  console.log(`notice: sha before confirming ${before} · after opening the notice ${sha()}`);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await section(page, 'summary')
    .getByText('Saved. The previous file was backed up first.')
    .waitFor();
  const saved = sha();
  console.log(
    `confirmed: sha ${before} → ${saved} (${saved === before ? 'unchanged' : 'changed'})`,
  );

  await saveSummary(page, ' A second edit.');
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForTimeout(500);
  const after = sha();
  console.log(`cancelled: sha ${saved} → ${after} (${after === saved ? 'unchanged' : 'CHANGED'})`);
}

async function scout(page: Page): Promise<void> {
  const { db, sqlite } = createDb(dbPath);
  const runId = startScoutRun(db, systemClock);
  console.log(`scout: opened run ${runId}`);
  try {
    await open(page, '/settings/profile');
    const before = sha();
    await saveSummary(page, ' A test edit during a scout.');
    const refusal = section(page, 'summary').getByText(/A scout is running/);
    await refusal.waitFor();
    console.log(`refused: "${await refusal.innerText()}"`);
    const dialogs = await page.getByRole('dialog').count();
    const after = sha();
    console.log(
      `scout: dialogs open ${dialogs} · sha ${before} → ${after} (${after === before ? 'unchanged' : 'CHANGED'})`,
    );
  } finally {
    runsRepo(db, systemClock).finish(runId, { ok: false, error: 'J18 acceptance 6 test run' });
    sqlite.close();
    console.log(`scout: closed run ${runId}`);
  }
}

const SELF_ID = ['gender', 'race_ethnicity', 'veteran_status', 'disability_status'] as const;
const ROUTES = [
  '/settings/profile',
  '/settings/answers',
  '/settings/preferences',
  '/settings/self-id',
];

async function sentinel(page: Page, value: string): Promise<void> {
  await open(page, '/settings/self-id');
  const before = sha();
  for (const key of SELF_ID) await page.locator(`#settings-self_identification-${key}`).fill(value);
  const self = section(page, 'self-id');
  await self.getByRole('button', { name: 'Save', exact: true }).click();
  await self.getByText('Saved. The previous file was backed up first.').waitFor();
  const written = readFileSync(profileFile, 'utf8').split(value).length - 1;
  console.log(`sentinel: saved · sha ${before} → ${sha()} · sentinel in profile.yaml ${written}`);

  for (const route of ROUTES) {
    const html = await (await fetch(`${base}${route}`)).text();
    console.log(`${route.padEnd(22)} ${html.split(value).length - 1}`);
  }

  for (const key of SELF_ID) {
    await self.getByRole('button', { name: `Decline ${labelOf(key)}` }).click();
  }
  await self.getByRole('button', { name: 'Save', exact: true }).click();
  await self.getByText('Saved. The previous file was backed up first.').waitFor();
  const restored = sha();
  console.log(
    `declined: sha ${restored} (${restored === before ? 'byte-identical to before' : 'differs from before'})`,
  );
}

const SIZES = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

/** Open a route for a screenshot, after the page title has finished decoding (J17). */
async function openStill(page: Page, route: string): Promise<void> {
  await open(page, route);
  await page.waitForTimeout(1500);
}

async function states(page: Page, out: string): Promise<void> {
  mkdirSync(out, { recursive: true });
  const before = sha();
  for (const size of SIZES) {
    await page.setViewportSize(size);
    const tag = `${size.width}x${size.height}`;

    await openStill(page, '/settings/preferences');
    const prefs = page.locator('#settings-preferences');
    await prefs.fill(`${await prefs.inputValue()}\nAlso games.`);
    await section(page, 'preferences').getByRole('button', { name: 'Save', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'This edit re-scores your jobs' });
    await dialog.waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, `notice-${tag}.png`) });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });

    await openStill(page, '/settings/profile');
    await page.locator('#settings-contact-email').fill('kris@example');
    const contact = section(page, 'contact');
    await contact.getByRole('button', { name: 'Save', exact: true }).click();
    await contact.getByText('must be an email address', { exact: false }).waitFor();
    await page.screenshot({ path: join(out, `invalid-email-${tag}.png`) });
    await contact.getByRole('button', { name: 'Discard', exact: true }).click();

    const entry = section(page, 'experience').locator('details').first();
    await entry.locator('summary').click();
    await entry.getByText('Year only.', { exact: false }).first().waitFor();
    await entry.evaluate((el) => {
      const pane = el.closest('.overflow-y-auto');
      if (pane)
        pane.scrollTop += el.getBoundingClientRect().top - pane.getBoundingClientRect().top - 12;
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(out, `year-only-${tag}.png`) });
    console.log(`states: ${tag} shot`);
  }
  const after = sha();
  console.log(`states: sha ${before} → ${after} (${after === before ? 'unchanged' : 'CHANGED'})`);
}

function labelOf(key: (typeof SELF_ID)[number]): string {
  return {
    gender: 'gender',
    race_ethnicity: 'race or ethnicity',
    veteran_status: 'veteran status',
    disability_status: 'disability status',
  }[key];
}

const browser = await chromium.launch({ executablePath: chrome });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await installBrandfetchStandIns(page);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  try {
    await run(page);
  } catch (err) {
    await page.screenshot({ path: '/tmp/jh-j18-settings-fail.png' }).catch(() => undefined);
    console.log(`failed on ${page.url()}; screenshot in /tmp/jh-j18-settings-fail.png`);
    throw err;
  }
  console.log(`page and console errors: ${errors.length}`);
  for (const error of errors) console.log(`  ${error.slice(0, 160)}`);
} finally {
  await browser.close();
}

async function run(page: Page): Promise<void> {
  if (part === 'notice') await notice(page);
  else if (part === 'scout') await scout(page);
  else if (part === 'sentinel') await sentinel(page, sentinelArg ?? 'J18-SENTINEL-7Q4Z');
  else if (part === 'states')
    await states(page, sentinelArg ?? 'docs/testing/screenshots/J18/states');
  else throw new Error(`unknown part "${part}"`);
}
