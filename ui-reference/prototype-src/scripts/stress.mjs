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

/** Frame gaps from requestAnimationFrame over `ms`, while `step` runs once per frame. */
const recordFrames = (ms, scroll) =>
  p.evaluate(
    async ({ ms, scroll }) => {
      const el = document.querySelector('[role="listbox"]');
      const gaps = [];
      let last = performance.now();
      const end = last + ms;
      await new Promise((res) => {
        const tick = (now) => {
          gaps.push(now - last);
          last = now;
          if (scroll) el.scrollTop += 120;
          if (now < end) requestAnimationFrame(tick);
          else res();
        };
        requestAnimationFrame(tick);
      });
      gaps.sort((a, b) => a - b);
      return {
        frames: gaps.length,
        p50: gaps[Math.floor(gaps.length * 0.5)],
        p95: gaps[Math.floor(gaps.length * 0.95)],
        max: gaps[gaps.length - 1],
        scrollTop: el.scrollTop,
      };
    },
    { ms, scroll },
  );

// Scroll the list for ~2s and record frame gaps
const frames = await recordFrames(2000, true);
const domRowsAfter = await p.locator('[role="option"]').count();

// Hover sweep: back to the top, then move the pointer down across 30 rows in ~2s while recording.
await p.evaluate(() => {
  const el = document.querySelector('[role="listbox"]');
  if (el) el.scrollTop = 0;
});
await p.waitForTimeout(400);
const box = await p.locator('[role="listbox"]').boundingBox();
const rowH = 66;
const x = box.x + box.width * 0.4;
await p.mouse.move(x, box.y + 20);
const hoverRec = recordFrames(2200, false);
const rowsToSweep = Math.min(30, Math.floor((box.height - 40) / rowH) * 2);
for (let i = 0; i < rowsToSweep; i++) {
  // Down the visible rows, then back up, so the sweep crosses 30 row boundaries.
  const visible = Math.floor((box.height - 40) / rowH);
  const idx = i < visible ? i : 2 * visible - i - 1;
  await p.mouse.move(x, box.y + 20 + idx * rowH + rowH / 2, { steps: 4 });
  await p.waitForTimeout(2000 / rowsToSweep - 8);
}
const hover = await hoverRec;

// Keyboard: press j 200 times
const k0 = Date.now();
for (let i = 0; i < 200; i++) await p.keyboard.press("j");
const keyMs = Date.now() - k0;
await p.waitForTimeout(500);
const selected = await p.locator('[role="option"][aria-selected="true"]').count();
await p.screenshot({ path: "dist/stress-1440.png" });
console.log(
  JSON.stringify(
    {
      loadMs,
      listLabel: total,
      sidebarTopMatches: sidebarCount,
      domRows,
      domRowsAfter,
      frames,
      hover,
      keyPressesMs: keyMs,
      selectedVisible: selected,
      errors,
    },
    null,
    1,
  ),
);
await browser.close();
