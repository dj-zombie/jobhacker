/**
 * J11 acceptance, against a copy of the database. Run after
 * `NEXT_DIST_DIR=.next-shoot pnpm build`.
 *
 *   pnpm exec tsx tests/e2e/company-header.run.ts
 *   pnpm exec tsx tests/e2e/company-header.run.ts --speed    only the 20 J presses
 *   pnpm exec tsx tests/e2e/company-header.run.ts --shots    no J presses
 *   … --runs 5 --css '<rules>'    repeat the presses, with CSS switched off for a comparison
 *
 * Shoots the header in triage (a company with a logo, one with none, scrolled past
 * the art, the phone sheet) and on /job/[id] for the three fallbacks, measures 20 J
 * presses, and lists the header's image sources with the client id redacted.
 * Screenshots land in docs/testing/screenshots/J11/. Does not touch data/jobhacker.db.
 * Its only inputs are J, selecting a row, and scrolling: it never acts on a job.
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
const COPY = join(tmpdir(), `j11-header-${process.pid}.db`);
const SHOTS = join(ROOT, 'docs/testing/screenshots/J11');
const chrome = resolveChrome();
if (!chrome) throw new Error('Chrome is not installed');

const SIZES = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

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

function query<T>(sql: string): T[] {
  const raw = execFileSync('sqlite3', ['-json', COPY, sql], { encoding: 'utf8' }).trim();
  return raw ? (JSON.parse(raw) as T[]) : [];
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

const redact = (s: string) => s.replace(/([?&]c=)[^&\s"]+/g, '$1REDACTED');

function listen(page: Page, errors: string[]): void {
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (isBrandfetchLoadError(msg.text(), msg.location().url)) return;
    errors.push(redact(msg.text()));
  });
  page.on('pageerror', (err) => errors.push(redact(String(err))));
}

/** Waits until every image in the header has loaded or failed, and the crossfade is over. */
async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const pane = document.querySelector('[data-detail-scroll]');
      if (!pane) return false;
      const imgs = [...pane.querySelectorAll('img')];
      return imgs.every((img) => img.complete) && !pane.querySelector('.animate-header-art');
    },
    null,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(350);
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(SHOTS, name) });
  console.log('shot', name);
}

/** The header's image sources, by kind, with the client id redacted. */
async function headerImages(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const pane = document.querySelector('[data-detail-scroll]');
    const out: Record<string, string> = {};
    for (const img of pane ? [...pane.querySelectorAll('img')] : []) {
      const src = img.currentSrc || img.src;
      const kind = /\/type\/symbol/.test(src)
        ? 'symbol'
        : /\/type\/logo/.test(src)
          ? 'wordmark'
          : /\/w\/256\//.test(src)
            ? 'cover 256'
            : /\/w\/128\//.test(src)
              ? 'art 128'
              : 'other';
      const state = img.complete && img.naturalWidth > 0 ? 'loaded' : 'failed';
      out[`${kind} (${state})`] = src;
    }
    const line = pane?.querySelector('h2')?.parentElement?.previousElementSibling;
    out['company line'] = line?.querySelector('img')
      ? `wordmark img, alt "${line.querySelector('img')?.getAttribute('alt') ?? ''}"`
      : `text "${line?.textContent?.trim() ?? ''}"`;
    return out;
  });
}

function printImages(label: string, imgs: Record<string, string>): void {
  console.log(`--- ${label} ---`);
  for (const [k, v] of Object.entries(imgs)) console.log(`  ${k}: ${redact(v)}`);
}

/** Selects the first list row that matches, by pressing J, so nothing is clicked on desktop. */
async function selectRow(page: Page, withLogo: boolean): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const hit = await page.evaluate((want) => {
      const row = document.querySelector('[role=option][aria-selected=true]');
      const img = row?.querySelector('img');
      const has = !!img && img.complete && img.naturalWidth > 0;
      return has === want ? (row?.textContent ?? '').slice(0, 80) : null;
    }, withLogo);
    if (hit) return hit;
    await page.keyboard.press('j');
    await page.waitForTimeout(withLogo ? 900 : 150);
  }
  throw new Error(`no row ${withLogo ? 'with' : 'without'} a logo in the first 60`);
}

async function triage(browser: Browser, base: string, errors: string[]): Promise<void> {
  const page = await browser.newPage({ viewport: SIZES[0] });
  page.setDefaultTimeout(60_000);
  listen(page, errors);
  await installBrandfetchStandIns(page);
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.locator('[role=option]').first().waitFor();
  await page.waitForTimeout(1200);

  console.log('logo row:', await selectRow(page, true));
  await settle(page);
  printImages('triage, company with a logo', await headerImages(page));
  for (const size of SIZES.slice(0, 2)) {
    await page.setViewportSize(size);
    await settle(page);
    await shot(page, `30-header-${size.width}.png`);
  }
  await page.setViewportSize(SIZES[0]);
  const card = await page.evaluate(`(() => {
    const el = document.querySelector('[data-detail-scroll] section.surface-card');
    const box = el ? el.getBoundingClientRect() : null;
    return box ? { top: Math.round(box.top), bottom: Math.round(box.bottom) } : null;
  })()`);
  console.log('score card at 1440x900:', card, 'viewport bottom 900');
  await page.evaluate(() => {
    const el = document.querySelector('[data-detail-scroll]');
    if (el) el.scrollTop = 420;
  });
  await page.waitForTimeout(400);
  const bar = await page.evaluate(() => {
    const bar = document.querySelector('[data-detail-scroll] .sticky > div');
    return bar
      ? { hidden: bar.getAttribute('aria-hidden'), text: bar.textContent?.trim().slice(0, 90) }
      : null;
  });
  console.log('compact bar after scrolling 420 px:', bar);
  await shot(page, '32-header-scrolled-1440.png');
  await page.evaluate(() => {
    const el = document.querySelector('[data-detail-scroll]');
    if (el) el.scrollTop = 0;
  });

  console.log('monogram row:', await selectRow(page, false));
  await settle(page);
  printImages('triage, company with no logo', await headerImages(page));
  await shot(page, '31-header-monogram-1440.png');
  await page.close();

  const phone = await browser.newPage({ viewport: SIZES[2], isMobile: true, hasTouch: true });
  phone.setDefaultTimeout(60_000);
  listen(phone, errors);
  await installBrandfetchStandIns(phone);
  await phone.goto(`${base}/`, { waitUntil: 'networkidle' });
  await phone.waitForTimeout(1500);
  const rowIndex = await phone.evaluate(() =>
    [...document.querySelectorAll('[role=option]')].findIndex((row) => {
      const img = row.querySelector('img');
      return !!img && img.complete && img.naturalWidth > 0;
    }),
  );
  await phone.locator('[role=option]').nth(Math.max(0, rowIndex)).click();
  await settle(phone);
  await phone.waitForTimeout(1200);
  await shot(phone, '30-header-390.png');
  await phone.close();
}

async function speed(browser: Browser, base: string, errors: string[], css = ''): Promise<number> {
  const page = await browser.newPage({ viewport: SIZES[0] });
  page.setDefaultTimeout(60_000);
  listen(page, errors);
  await installBrandfetchStandIns(page);
  if (css)
    await page.addInitScript(`document.addEventListener('DOMContentLoaded', () => {
    const s = document.createElement('style'); s.textContent = ${JSON.stringify(css)}; document.head.append(s);
  });`);
  await page.addInitScript(`
    window.__shifts = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const pane = document.querySelector('[data-detail-scroll]');
        const inPane = (e.sources || []).some((s) => !!s.node && !!pane && pane.contains(s.node));
        window.__shifts.push({ value: e.value, recent: e.hadRecentInput, inPane, at: Math.round(e.startTime) });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  `);
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.locator('[role=option]').first().waitFor();
  await page.waitForTimeout(1500);
  await page.evaluate(`(() => {
    window.__shifts = [];
    window.__gaps = [];
    window.__long = [];
    window.__run = true;
    let lastKey = 0;
    let presses = 0;
    window.addEventListener('keydown', () => { lastKey = performance.now(); presses += 1; }, true);
    let last = performance.now();
    function tick(t) {
      const gap = t - last;
      window.__gaps.push(gap);
      if (gap > 50) window.__long.push({ gap: Math.round(gap), press: presses, sinceKey: Math.round(last - lastKey) });
      last = t;
      if (window.__run) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  })()`);
  const started = Date.now();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('j');
    await page.waitForTimeout(120);
  }
  const pressMs = Date.now() - started;
  await page.waitForTimeout(1500);
  const result = (await page.evaluate(`(() => {
    window.__run = false;
    const gaps = window.__gaps.slice(1).sort((a, b) => a - b);
    const at = (q) => Number((gaps[Math.floor(gaps.length * q)] ?? 0).toFixed(1));
    const selected = document.querySelector('[role=option][aria-selected=true]')?.textContent ?? '';
    return {
      frames: gaps.length,
      p50: at(0.5),
      p95: at(0.95),
      max: Number((gaps[gaps.length - 1] ?? 0).toFixed(1)),
      shifts: window.__shifts,
      long: window.__long,
      selected: selected.slice(0, 60),
    };
  })()`)) as {
    long: { gap: number; press: number; sinceKey: number }[];
    frames: number;
    p50: number;
    p95: number;
    max: number;
    shifts: { value: number; recent: boolean; inPane: boolean }[];
    selected: string;
  };
  console.log('--- speed: 20 J presses in Top matches, stand-ins at 700 ms ---');
  console.log(
    `20 presses in ${pressMs} ms, then 1.5 s for late images; now on: ${result.selected}`,
  );
  console.log(
    `frames ${result.frames} · p50 ${result.p50} ms · p95 ${result.p95} ms · max ${result.max} ms`,
  );
  console.log(
    `frames over 50 ms: ${result.long.length ? result.long.map((l) => `${l.gap} ms after press ${l.press} (+${l.sinceKey} ms)`).join(' · ') : 'none'}`,
  );
  const unexpected = result.shifts.filter((s) => !s.recent);
  console.log(
    `layout shifts: ${result.shifts.length} in all · ${unexpected.length} with hadRecentInput false · ${
      unexpected.filter((s) => s.inPane).length
    } of those in the detail pane`,
  );
  for (const s of unexpected) console.log('  shift', s);
  await page.close();
  return result.p95;
}

async function fallbacks(browser: Browser, base: string, errors: string[]): Promise<void> {
  const open = `j.closed_at is null and j.duplicate_of is null and j.status not in ('skipped','archived')`;
  const withDomain = query<{ id: number; company: string; domain: string }>(
    `select j.id, c.name as company, d.domain from jobs j join companies c on c.id = j.company_id
     join company_domains d on d.name = c.name
     where ${open} and d.domain is not null and d.source not in ('typed') and d.state != 'none'
     group by c.name order by j.id desc limit 2`,
  );
  const noDomain = query<{ id: number; company: string }>(
    `select j.id, c.name as company from jobs j join companies c on c.id = j.company_id
     where ${open} and not exists (select 1 from company_domains d where d.name = c.name and d.domain is not null)
     order by j.id desc limit 1`,
  );
  const [miss, iconOnly] = withDomain;
  const [bare] = noDomain;
  if (!miss || !iconOnly || !bare) throw new Error('could not pick the three fallback jobs');
  process.env.BRANDFETCH_404 = miss.domain;
  process.env.BRANDFETCH_404_ASSETS = iconOnly.domain;
  const cases = [
    { name: 'fallback-404', job: miss, note: `domain ${miss.domain}, every asset 404` },
    { name: 'fallback-no-domain', job: bare, note: 'no domain' },
    {
      name: 'fallback-icon-only',
      job: iconOnly,
      note: `domain ${iconOnly.domain}, symbol and wordmark 404`,
    },
  ];
  for (const c of cases) {
    const page = await browser.newPage({ viewport: SIZES[0] });
    page.setDefaultTimeout(60_000);
    listen(page, errors);
    await installBrandfetchStandIns(page);
    await page.goto(`${base}/job/${c.job.id}`, { waitUntil: 'networkidle' });
    await settle(page);
    const art = await page.evaluate(() => {
      const art = document.querySelector('[data-detail-scroll] [class*="-z-10"]');
      const letter = art?.querySelector('span')?.textContent ?? null;
      const imgs = [...(art?.querySelectorAll('img') ?? [])].filter(
        (img) => img.complete && img.naturalWidth > 0 && getComputedStyle(img).opacity !== '0',
      );
      return { letter, artImages: imgs.length };
    });
    printImages(`/job/${c.job.id} · ${c.job.company} · ${c.note}`, await headerImages(page));
    console.log('  art:', art);
    await shot(page, `${c.name}-1440.png`);
    await page.close();
  }
  process.env.BRANDFETCH_404 = '';
  process.env.BRANDFETCH_404_ASSETS = '';
}

async function main(): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  execFileSync('sqlite3', [join(ROOT, 'data/jobhacker.db'), `.backup ${COPY}`], {
    stdio: 'inherit',
  });
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
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const errors: string[] = [];
  try {
    await waitReady(base);
    const speedOnly = process.argv.includes('--speed');
    const arg = (name: string) => {
      const at = process.argv.indexOf(name);
      return at >= 0 ? process.argv[at + 1] : undefined;
    };
    const runs = Number(arg('--runs') ?? (process.argv.includes('--shots') ? 0 : 1));
    if (!speedOnly) await triage(browser, base, errors);
    const p95s: number[] = [];
    for (let i = 0; i < runs; i++) p95s.push(await speed(browser, base, errors, arg('--css')));
    if (runs > 1) console.log(`p95 over ${runs} runs: ${p95s.join(' · ')} ms`);
    if (!speedOnly) await fallbacks(browser, base, errors);
    console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'console errors: none');
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
