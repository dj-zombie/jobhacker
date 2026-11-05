/**
 * J8 acceptance 5, the J5 11k-row check, against a server that is already running. J17 adds the
 * hover sweep and the time for 200 J presses.
 *
 *   pnpm exec tsx tests/e2e/stress.run.ts http://127.0.0.1:3000
 *
 * Opens /unscored?where=anywhere, counts [role=option], and scrolls the list for 2 seconds. Then it
 * sweeps the pointer across 30 row boundaries in about 2 seconds, and presses J 200 times with the
 * pointer resting on the list.
 */
import { chromium } from 'playwright-core';
import { resolveChrome } from '../../src/core/apply/browser.js';
import { installBrandfetchStandIns, isBrandfetchLoadError } from './brandfetch.js';

const base = process.argv[2];
if (!base) throw new Error('pass the server origin, e.g. http://127.0.0.1:3000');
const chrome = resolveChrome();
if (!chrome) throw new Error('Chrome is not installed');

const browser = await chromium.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await installBrandfetchStandIns(page, { delayMs: 0 });
const errors: string[] = [];
page.on('console', (msg) => {
  if (msg.type() !== 'error') return;
  if (isBrandfetchLoadError(msg.text(), msg.location().url)) return;
  errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(String(err)));
const t0 = Date.now();
await page.goto(`${base}/unscored?where=anywhere`, {
  waitUntil: 'domcontentloaded',
  timeout: 120_000,
});
await page.locator('[role="option"]').first().waitFor({ timeout: 60_000 });
const loadMs = Date.now() - t0;
const atRest = await page.locator('[role="option"]').count();
const label = await page.locator('[role="listbox"]').getAttribute('aria-label');
// Strings, so the runner's compiler doesn't inject helpers into the page.
const frames = await page.evaluate(`(async () => {
  const el = document.querySelector('[role="listbox"]');
  if (!el) return null;
  const gaps = [];
  let last = performance.now();
  const end = last + 2000;
  let most = document.querySelectorAll('[role="option"]').length;
  await new Promise((res) => {
    const tick = (now) => {
      gaps.push(now - last);
      last = now;
      el.scrollTop += 120;
      most = Math.max(most, document.querySelectorAll('[role="option"]').length);
      if (now < end) requestAnimationFrame(tick);
      else res();
    };
    requestAnimationFrame(tick);
  });
  gaps.sort((a, b) => a - b);
  const at = (p) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] ?? 0;
  return { frames: gaps.length, p50: at(0.5), p95: at(0.95), max: at(1), most, scrollTop: el.scrollTop };
})()`);

const recordFrames = (ms: number) =>
  page.evaluate(`new Promise((res) => {
    const gaps = [];
    let last = performance.now();
    const end = last + ${ms};
    const tick = (now) => {
      gaps.push(now - last);
      last = now;
      if (now < end) requestAnimationFrame(tick);
      else {
        gaps.sort((a, b) => a - b);
        const at = (p) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] ?? 0;
        res({ frames: gaps.length, p50: at(0.5), p95: at(0.95), max: at(1) });
      }
    };
    requestAnimationFrame(tick);
  })`) as Promise<{ frames: number; p50: number; p95: number; max: number }>;

await page.evaluate(`(() => {
  const el = document.querySelector('[role="listbox"]');
  if (el) el.scrollTop = 0;
})()`);
await page.waitForTimeout(400);
const box = await page.locator('[role="listbox"]').boundingBox();
const rowBox = await page.locator('[role="option"]').first().boundingBox();
let hover: Awaited<ReturnType<typeof recordFrames>> | null = null;
let keyMs: number | null = null;
if (box && rowBox) {
  const rowH = rowBox.height;
  const x = box.x + box.width * 0.4;
  const top = rowBox.y;
  const visible = Math.max(1, Math.floor((box.y + box.height - top) / rowH) - 1);
  const sweeps = Math.min(30, visible * 2);
  await page.mouse.move(x, top + 4);
  const hoverRec = recordFrames(2200);
  for (let i = 0; i < sweeps; i++) {
    const idx = i < visible ? i : 2 * visible - i - 1;
    await page.mouse.move(x, top + idx * rowH + rowH / 2, { steps: 4 });
    await page.waitForTimeout(2000 / sweeps - 8);
  }
  hover = await hoverRec;

  const k0 = Date.now();
  for (let i = 0; i < 200; i++) await page.keyboard.press('j');
  keyMs = Date.now() - k0;
}
const selected = await page.locator('[role="option"][aria-selected="true"]').count();

console.log(
  JSON.stringify({ loadMs, label, atRest, frames, hover, keyMs, selected, errors }, null, 2),
);
await browser.close();
if (
  !frames ||
  atRest >= 60 ||
  frames.most >= 60 ||
  frames.p95 >= 20 ||
  !hover ||
  hover.p95 >= 20 ||
  errors.length > 0
)
  process.exit(1);
