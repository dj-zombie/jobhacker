/**
 * J25 acceptance 3, against a server that is already running:
 *
 *   pnpm exec tsx tests/e2e/triage-layout.run.ts http://127.0.0.1:3000 [--long 51066,43962]
 *
 * On /matches at 1728×964 and 1024×768, comfortable density, it steps J through the first 20 jobs.
 * At each job it records the list and detail widths, every element in a visible row that is cut by
 * an ellipsis or a line clamp (or clipped by its row's box), the Show full description buttons in
 * the detail, the lock's corners against the selected row's box, the row heights that rendered,
 * and how long the step took until the job's detail arrived and painted. At 1728 it also scrolls
 * the detail and reads where the verdict sits, since it should stay put beside the description.
 *
 * `--long` takes job ids (the longest descriptions, say). Each is found in the list on
 * /matches?where=anywhere (then the weak segment), the row above it is clicked, and J steps onto
 * it, timed the same way. Clicking a row only selects it.
 */
import { parseArgs } from 'node:util';
import { type Page, chromium } from 'playwright-core';
import { resolveChrome } from '../../src/core/apply/browser.js';
import { installBrandfetchStandIns, isBrandfetchLoadError } from './brandfetch.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { long: { type: 'string', default: '' } },
});
const base = positionals[0];
if (!base) throw new Error('pass the server origin, e.g. http://127.0.0.1:3000');
const longIds = (values.long ?? '').split(',').filter(Boolean);
const chrome = resolveChrome();
if (!chrome) throw new Error('Chrome is not installed');

const SIZES = [
  { width: 1728, height: 964 },
  { width: 1024, height: 768 },
] as const;
const STEPS = 20;

interface Measure {
  title: string;
  list: number;
  pane: number;
  detail: number;
  lock: { top: number; bottom: number; on: boolean } | null;
  cutRows: string[];
  clippedRows: number;
  cutDetail: string[];
  showMore: number;
  heights: number[];
  selectedHeight: number | null;
  descLen: number;
  sections: Record<string, { x: number; y: number; w: number }>;
}

// Strings, so the runner's compiler doesn't inject helpers into the page.
const MEASURE = `(() => {
  const list = document.querySelector('[role="listbox"]');
  const detail = document.querySelector('[data-detail-scroll]');
  if (!list || !detail) return null;
  const lb = list.getBoundingClientRect();
  const opts = [...list.querySelectorAll('[role="option"]')];
  const sel = list.querySelector('[role="option"][aria-selected="true"]');
  const lockEl = list.querySelector('[data-corner]');
  let lock = null;
  if (sel && lockEl) {
    const s = sel.getBoundingClientRect();
    const a = lockEl.children[0].getBoundingClientRect();
    const b = lockEl.children[2].getBoundingClientRect();
    lock = { top: +(a.top - s.top).toFixed(1), bottom: +(s.bottom - b.bottom).toFixed(1), on: lockEl.hasAttribute('data-on') };
  }
  // Something at opacity 0, like the compact bar before the title scrolls away, can't be read.
  const unseen = (el) => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.opacity === '0' || cs.display === 'none' || cs.visibility === 'hidden') return true;
    }
    return false;
  };
  const isCut = (el) => {
    const cs = getComputedStyle(el);
    if (el.clientWidth === 0) return false;
    const ellipsis = cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1;
    const clamp = cs.webkitLineClamp;
    const clamped = !!clamp && clamp !== 'none' && el.scrollHeight > el.clientHeight + 1;
    return (ellipsis || clamped) && !unseen(el);
  };
  const text = (el) => (el.textContent || '').trim().slice(0, 70);
  const shown = opts.filter((o) => {
    const r = o.getBoundingClientRect();
    return r.bottom > lb.top && r.top < lb.bottom;
  });
  const cutRows = [];
  let clippedRows = 0;
  for (const o of shown) {
    for (const el of o.querySelectorAll('*')) if (isCut(el)) cutRows.push(text(el));
    const row = o.firstElementChild;
    if (row && row.scrollHeight > row.clientHeight + 1) clippedRows++;
  }
  const cutDetail = [];
  for (const el of detail.querySelectorAll('*')) if (isCut(el)) cutDetail.push(text(el));
  const showMore = [...detail.querySelectorAll('button')].filter((b) => /show (full|more)/i.test(b.textContent || '')).length;
  const titled = (name) => {
    const h = [...detail.querySelectorAll('h3')].find((x) => (x.textContent || '').trim().startsWith(name));
    return h ? h.closest('section') : null;
  };
  const desc = titled('Description');
  const dr = detail.getBoundingClientRect();
  const sections = {};
  const put = (name, el) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    sections[name] = { x: Math.round(r.left - dr.left), y: Math.round(r.top - dr.top), w: Math.round(r.width) };
  };
  put('verdict', detail.querySelector('section.surface-card'));
  put('redFlags', titled('Red flags'));
  put('description', desc);
  put('why', titled("Why it's here"));
  const title = detail.querySelector('.glitch-text[data-text]')?.getAttribute('data-text') || '';
  const pane = list.closest('.border-r');
  return {
    title,
    list: Math.round(lb.width),
    pane: pane ? Math.round(pane.getBoundingClientRect().width) : 0,
    detail: Math.round(dr.width),
    lock,
    cutRows,
    clippedRows,
    cutDetail,
    showMore,
    heights: opts.map((o) => Math.round(o.getBoundingClientRect().height)),
    selectedHeight: sel ? Math.round(sel.getBoundingClientRect().height) : null,
    descLen: desc ? (desc.textContent || '').length : 0,
    sections,
  };
})()`;

const PAINT = 'new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))';

/** Runs `step`, then waits for the detail GET it causes and two frames. Returns the milliseconds. */
async function timed(page: Page, step: () => Promise<void>): Promise<number | null> {
  const t0 = Date.now();
  const arrived = page
    .waitForResponse((r) => new URL(r.url()).pathname.startsWith('/api/job/'), { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  await step();
  const ok = await arrived;
  await page.evaluate(PAINT);
  return ok ? Date.now() - t0 : null;
}

async function measure(page: Page): Promise<Measure> {
  const m = (await page.evaluate(MEASURE)) as Measure | null;
  if (!m) throw new Error('no list or detail on the page');
  return m;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.floor(s.length / 2)] ?? 0) : 0;
};

/** Scrolls the list until the row for `id` renders. Returns its index, or -1. */
async function findRow(page: Page, id: string): Promise<number> {
  return (await page.evaluate(`(async () => {
    const list = document.querySelector('[role="listbox"]');
    if (!list) return -1;
    list.scrollTop = 0;
    for (let i = 0; i < 2000; i++) {
      const row = document.getElementById('job-${id}');
      if (row) {
        row.scrollIntoView({ block: 'center' });
        await new Promise((r) => setTimeout(r, 300));
        return Number(row.dataset.index);
      }
      if (list.scrollTop + list.clientHeight >= list.scrollHeight - 1) return -1;
      list.scrollTop += list.clientHeight * 0.8;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    return -1;
  })()`)) as number;
}

const browser = await chromium.launch({ executablePath: chrome, headless: true });
const errors: string[] = [];
const report: Record<string, unknown> = {};
const failures: string[] = [];

for (const size of SIZES) {
  const ctx = await browser.newContext({ viewport: size });
  const page = await ctx.newPage();
  await installBrandfetchStandIns(page, { delayMs: 0 });
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isBrandfetchLoadError(msg.text(), msg.location().url)) {
      errors.push(`${size.width}: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => errors.push(`${size.width}: ${String(err)}`));

  const firstMs = await timed(page, async () => {
    await page.goto(`${base}/matches`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  });
  await page.locator('[role="option"]').first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  const steps: (Measure & { ms: number | null })[] = [];
  steps.push({ ...(await measure(page)), ms: firstMs });
  for (let i = 1; i < STEPS; i++) {
    const ms = await timed(page, () => page.keyboard.press('j'));
    // Past the burst rule (300 ms) and the lock's glide.
    await page.waitForTimeout(800);
    steps.push({ ...(await measure(page)), ms });
  }

  let sticky: { before: number | undefined; after: number | undefined; scrolled: number } | null =
    null;
  if (size.width === 1728) {
    const before = steps.at(-1)?.sections.verdict?.y;
    const scrolled = (await page.evaluate(`(() => {
      const d = document.querySelector('[data-detail-scroll]');
      d.scrollTop = 1500;
      return d.scrollTop;
    })()`)) as number;
    await page.waitForTimeout(400);
    sticky = { before, after: (await measure(page)).sections.verdict?.y, scrolled };
    await page.evaluate(`document.querySelector('[data-detail-scroll]').scrollTop = 0`);
  }

  const longs: { id: string; found: string; ms: number | null; m: Measure }[] = [];
  for (const id of longIds) {
    let found = '';
    for (const q of ['?where=anywhere', '?where=anywhere&segment=weak']) {
      await page.goto(`${base}/matches${q}`, { waitUntil: 'domcontentloaded' });
      await page.locator('[role="option"]').first().waitFor({ timeout: 60_000 });
      await page.waitForTimeout(800);
      const index = await findRow(page, id);
      if (index < 0) continue;
      found = q;
      const above = page.locator(`[role="option"][data-index="${index - 1}"]`);
      if (index > 0 && (await above.count()) > 0) {
        await timed(page, () => above.click({ position: { x: 60, y: 14 } }));
        await page.waitForTimeout(800);
        const ms = await timed(page, () => page.keyboard.press('j'));
        await page.waitForTimeout(800);
        longs.push({ id, found, ms, m: await measure(page) });
      } else {
        const row = page.locator(`#job-${id}`);
        const ms = await timed(page, () => row.click({ position: { x: 60, y: 14 } }));
        await page.waitForTimeout(800);
        longs.push({ id, found, ms, m: await measure(page) });
      }
      break;
    }
    if (!found) longs.push({ id, found: 'not in /matches', ms: null, m: await measure(page) });
  }
  await ctx.close();

  const first = steps[0];
  const lockTops = steps.flatMap((s) => (s.lock ? [s.lock.top] : []));
  const lockBottoms = steps.flatMap((s) => (s.lock ? [s.lock.bottom] : []));
  const heights = [...new Set(steps.flatMap((s) => s.heights))].sort((a, b) => a - b);
  const stepMs = steps.slice(1).flatMap((s) => (s.ms == null ? [] : [s.ms]));
  const summary = {
    widths: first ? { list: first.list, pane: first.pane, detail: first.detail } : null,
    sections: first?.sections,
    jobs: steps.length,
    cutInRows: steps.reduce((n, s) => n + s.cutRows.length, 0),
    cutRowTexts: [...new Set(steps.flatMap((s) => s.cutRows))],
    clippedRows: steps.reduce((n, s) => n + s.clippedRows, 0),
    cutInDetail: [...new Set(steps.flatMap((s) => s.cutDetail))],
    showFullButtons: steps.reduce((n, s) => n + s.showMore, 0),
    lockInset: {
      top: [Math.min(...lockTops), Math.max(...lockTops)],
      bottom: [Math.min(...lockBottoms), Math.max(...lockBottoms)],
      locked: steps.filter((s) => s.lock?.on).length,
    },
    rowHeights: heights,
    selectedHeights: steps.map((s) => s.selectedHeight),
    stepMs: { median: median(stepMs), max: Math.max(...stepMs) },
    descLen: {
      median: median(steps.map((s) => s.descLen)),
      max: Math.max(...steps.map((s) => s.descLen)),
    },
    perStep: steps.map(
      (s) => `${s.ms ?? '-'}ms ${s.descLen}ch row ${s.selectedHeight}px ${s.title.slice(0, 48)}`,
    ),
    sticky,
    longs: longs.map((l) => ({
      id: l.id,
      found: l.found,
      ms: l.ms,
      descLen: l.m.descLen,
      row: l.m.selectedHeight,
      showFull: l.m.showMore,
      cutInRows: l.m.cutRows.length,
      lock: l.m.lock,
      title: l.m.title.slice(0, 60),
    })),
  };
  report[`${size.width}x${size.height}`] = summary;

  const tag = `${size.width}:`;
  if (size.width === 1728 && first && (first.list > 440 || first.detail < 896)) {
    failures.push(`${tag} list ${first.list}px, detail ${first.detail}px`);
  }
  if (summary.cutInRows > 0) failures.push(`${tag} ${summary.cutInRows} cut elements in rows`);
  if (summary.clippedRows > 0)
    failures.push(`${tag} ${summary.clippedRows} rows clip their content`);
  if (summary.showFullButtons > 0) failures.push(`${tag} Show full description buttons`);
  const off = [...lockTops, ...lockBottoms].filter((v) => Math.abs(v) > 2);
  if (lockTops.length < steps.length || off.length)
    failures.push(`${tag} lock off the row: ${off}`);
  if (heights.length < 2) failures.push(`${tag} every row has the same height`);
  for (const l of summary.longs) {
    if (l.showFull > 0 || l.cutInRows > 0) failures.push(`${tag} long ${l.id} cut or collapsed`);
  }
}
await browser.close();

console.log(JSON.stringify({ ...report, errors }, null, 2));
if (errors.length) failures.push('console errors');
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
