/**
 * How long the triage detail takes to show a job after J, on one server (J25 fix).
 *
 *   pnpm exec tsx tests/e2e/detail-latency.run.ts <origin> [--path /matches] [--presses 20] [--gap 1500]
 *     [--size 1728x964] [--dpr 1] [--logo-delay 0] [--api-delay 0] [--timeline 30,250,1000] [--shot <png>]
 *
 * It presses J, then records, in ms from the keydown: when the selection moved, when the header
 * showed the new job, when the job's description appeared (not its placeholder), whether the
 * loading placeholder showed, how long each /api/job request took, and the longest main-thread
 * task. Prints the median and worst of each. `--api-delay` holds every /api/job answer back, like
 * a slow server. `--timeline` screenshots one press at those times, and `--shot` the detail as the
 * page first loads, both to `--out` (default /tmp/jh-latency). Keep screenshots out of the repo
 * while `pnpm dev` runs: a file written there sets off Fast Refresh in the open page, which can
 * reset the view mid-run.
 */
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { resolveChrome } from '../../src/core/apply/browser.js';
import { installBrandfetchStandIns } from './brandfetch.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    path: { type: 'string', default: '/matches' },
    presses: { type: 'string', default: '20' },
    gap: { type: 'string', default: '1500' },
    'logo-delay': { type: 'string', default: '0' },
    timeline: { type: 'string' },
    out: { type: 'string', default: '/tmp/jh-latency' },
    size: { type: 'string', default: '1728x964' },
    dpr: { type: 'string', default: '1' },
    'api-delay': { type: 'string', default: '0' },
    shot: { type: 'string' },
  },
});
const [width, height] = (values.size ?? '').split('x').map(Number);
const [origin] = positionals;
if (!origin) throw new Error('pass the origin');
const chrome = resolveChrome();
if (!chrome) throw new Error('Chrome is not installed');

const WATCH = `(() => {
  const w = window;
  w.__lat = [];
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (w.__cur) w.__cur.longest = Math.max(w.__cur.longest, e.duration);
  }).observe({ type: 'longtask', buffered: false });
  document.addEventListener('keydown', () => {
    if (w.__cur) w.__lat.push(w.__cur);
    const sel = document.querySelector('[role="option"][aria-selected="true"]');
    w.__cur = { t0: performance.now(), from: sel ? sel.id : '', row: null, title: null, desc: null, busy: false, longest: 0 };
  }, true);
  const tick = () => {
    const c = w.__cur;
    if (c) {
      const dt = Math.round(performance.now() - c.t0);
      const sel = document.querySelector('[role="option"][aria-selected="true"]');
      const pane = document.querySelector('[data-detail-scroll]');
      const title = pane?.querySelector('.glitch-text[data-text]')?.getAttribute('data-text') || '';
      const moved = !!sel && sel.id !== c.from;
      if (c.row == null && moved) c.row = dt;
      const shows = moved && title !== '' && (sel.textContent || '').includes(title);
      if (c.title == null && shows) c.title = dt;
      const busy = pane?.getAttribute('aria-busy') === 'true';
      if (shows && busy) c.busy = true;
      const desc = [...(pane?.querySelectorAll('h3') ?? [])].some((h) => (h.textContent || '').startsWith('Description'));
      if (c.desc == null && shows && desc && !busy) c.desc = dt;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`;

const browser = await chromium.launch({ executablePath: chrome, headless: true });
const ctx = await browser.newContext({
  viewport: { width: width ?? 1728, height: height ?? 964 },
  deviceScaleFactor: Number(values.dpr),
});
const page = await ctx.newPage();
await installBrandfetchStandIns(page, { delayMs: Number(values['logo-delay']) });
const apiDelay = Number(values['api-delay']);
if (apiDelay > 0) {
  // A slow server: each job's detail answers this much later.
  await page.route(/\/api\/job\/\d+$/, async (route) => {
    await new Promise((r) => setTimeout(r, apiDelay));
    await route.continue().catch(() => undefined);
  });
}
page.on('console', (m) => {
  if (m.type() === 'error' || /fast refresh|reload|hmr/i.test(m.text()))
    console.error(`console ${m.type()}: ${m.text().slice(0, 300)}`);
});
page.on('pageerror', (e) => console.error(`pageerror: ${e.message.slice(0, 300)}`));
page.on('response', (r) => {
  if (r.status() >= 400) console.error(`http ${r.status()} ${r.url().slice(0, 160)}`);
});
let navigations = 0;
page.on('framenavigated', (f) => {
  if (f === page.mainFrame()) navigations++;
});
await page.goto(`${origin}${values.path}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
try {
  await page.locator('[role="option"]').first().waitFor({ timeout: 120_000 });
} catch (e) {
  await page.screenshot({ path: `${values.out}/no-rows.png` });
  throw e;
}
if (values.shot) {
  // One frame of the detail as it first loads. On a phone, the first row opens it.
  if ((width ?? 1728) < 768) await page.locator('[role="option"]').first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: values.shot });
  await browser.close();
  process.exit(0);
}
await page.waitForTimeout(3000);

if (values.timeline) {
  // One press, with the window screenshotted at each of these ms after it.
  const at = values.timeline.split(',').map(Number);
  const before = navigations;
  await page.keyboard.press('j');
  const t0 = Date.now();
  for (const ms of at) {
    await page.waitForTimeout(Math.max(0, ms - (Date.now() - t0)));
    await page.screenshot({ path: `${values.out}/timeline-${String(ms).padStart(4, '0')}.png` });
  }
  console.log(`page loads after the press: ${navigations - before}`);
  await browser.close();
  process.exit(0);
}

await page.evaluate(WATCH);

const api: number[] = [];
page.on('requestfinished', (req) => {
  if (!req.url().includes('/api/job/')) return;
  const t = req.timing();
  api.push(Math.round(t.responseEnd));
});

for (let i = 0; i < Number(values.presses); i++) {
  await page.keyboard.press('j');
  await page.waitForTimeout(Number(values.gap));
}
await page.keyboard.press('Shift');
type Press = {
  row: number | null;
  title: number | null;
  desc: number | null;
  busy: boolean;
  longest: number;
};
const presses = (await page.evaluate('window.__lat')) as Press[];
await browser.close();

const stat = (xs: (number | null)[]) => {
  const missing = xs.filter((x) => x == null).length;
  const v = xs.filter((x): x is number => x != null).sort((a, b) => a - b);
  const med = v.length ? v[Math.floor(v.length / 2)] : null;
  return `median ${med} · worst ${v.at(-1) ?? null}${missing ? ` · never ${missing}` : ''}`;
};
console.log(`${origin}${values.path}, ${presses.length} presses, ${values.gap} ms apart`);
console.log(`selection moved      ${stat(presses.map((p) => p.row))}`);
console.log(`header shows the job ${stat(presses.map((p) => p.title))}`);
console.log(`description shown    ${stat(presses.map((p) => p.desc))}`);
console.log(
  `skeleton shown       ${presses.filter((p) => p.busy).length} of ${presses.length} presses`,
);
console.log(`/api/job response    ${stat(api)} (${api.length} requests)`);
console.log(`longest task         ${stat(presses.map((p) => Math.round(p.longest)))}`);
