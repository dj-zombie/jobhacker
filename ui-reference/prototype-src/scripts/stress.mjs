import { chromium } from "playwright";
import path from "node:path";
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
const t0 = Date.now();
await p.goto("file://" + path.resolve("dist/index.html") + "?stress");
await p.waitForSelector('[role="option"]');
const loadMs = Date.now() - t0;
const total = await p.evaluate(() => document.querySelector('[role="listbox"]')?.getAttribute("aria-label"));
const sidebarCount = await p.locator('a[aria-current="page"] span').last().textContent();
const domRows = await p.locator('[role="option"]').count();
// Scroll the list for ~2s and record frame gaps
const frames = await p.evaluate(async () => {
  const el = document.querySelector('[role="listbox"]');
  const gaps = [];
  let last = performance.now();
  const end = last + 2000;
  await new Promise((res) => {
    const tick = (now) => {
      gaps.push(now - last);
      last = now;
      el.scrollTop += 120;
      if (now < end) requestAnimationFrame(tick);
      else res();
    };
    requestAnimationFrame(tick);
  });
  gaps.sort((a, b) => a - b);
  return { frames: gaps.length, p50: gaps[Math.floor(gaps.length * 0.5)], p95: gaps[Math.floor(gaps.length * 0.95)], max: gaps[gaps.length - 1], scrollTop: el.scrollTop };
});
const domRowsAfter = await p.locator('[role="option"]').count();
// Keyboard: press j 200 times
const k0 = Date.now();
for (let i = 0; i < 200; i++) await p.keyboard.press("j");
const keyMs = Date.now() - k0;
await p.waitForTimeout(500);
const selected = await p.locator('[role="option"][aria-selected="true"]').count();
await p.screenshot({ path: "../shots/22-stress-1440.png" });
console.log(JSON.stringify({ loadMs, sidebarTopMatches: sidebarCount, domRows, domRowsAfter, frames, keyPressesMs: keyMs, selectedVisible: selected, errors }, null, 1));
await browser.close();
