/**
 * J8 acceptance 5, the J5 11k-row check, against a server that is already running.
 *
 *   pnpm exec tsx tests/e2e/stress.run.ts http://127.0.0.1:3000
 *
 * Opens /unscored?where=anywhere, counts [role=option], and scrolls the list for 2 seconds.
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
// A string, so the runner's compiler doesn't inject helpers into the page.
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
console.log(JSON.stringify({ loadMs, label, atRest, frames, errors }, null, 2));
await browser.close();
if (!frames || atRest >= 60 || frames.most >= 60 || frames.p95 >= 20) process.exit(1);
