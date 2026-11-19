/**
 * J25 acceptance 6: frames dropped after a job change, two servers interleaved.
 *
 *   pnpm exec tsx tests/e2e/job-change-frames.run.ts <before origin> <after origin> [--rounds 2]
 *
 * At 1728×964 on /matches it makes 60 real job changes (21 J, 21 K, 18 J), times 1.2 s after each,
 * and counts the frames whose gap is over 17 ms, as the D170 and D171 reference entries did. Runs
 * alternate before, after, before, after, and the load average is printed with each. It exits 1
 * unless every press moved the selection to a new row and the detail shows that row's job.
 */
import { loadavg } from 'node:os';
import { parseArgs } from 'node:util';
import { type Browser, chromium } from 'playwright-core';
import { resolveChrome } from '../../src/core/apply/browser.js';
import { installBrandfetchStandIns } from './brandfetch.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { rounds: { type: 'string', default: '2' } },
});
const [before, after] = positionals;
if (!before || !after) throw new Error('pass the before and after origins');
const rounds = Number(values.rounds);
const chrome = resolveChrome();
if (!chrome) throw new Error('Chrome is not installed');

const KEYS = [...Array(21).fill('j'), ...Array(21).fill('k'), ...Array(18).fill('j')] as string[];

const COUNT = `new Promise((res) => {
  let n = 0;
  let last = performance.now();
  const end = last + 1200;
  const tick = (now) => {
    if (now - last > 17) n++;
    last = now;
    if (now < end) requestAnimationFrame(tick);
    else res(n);
  };
  requestAnimationFrame(tick);
})`;

// The selected row's id, and whether the detail shows that row's job (two jobs can share a title).
const SELECTED = `(() => {
  const sel = document.querySelector('[role="option"][aria-selected="true"]');
  const title = document.querySelector('[data-detail-scroll] .glitch-text[data-text]')?.getAttribute('data-text') || '';
  return (sel ? sel.id : '') + '|' + (title !== '' && (sel?.textContent || '').includes(title));
})()`;

/** Dropped frames, and how many presses moved the selection to a row whose job the detail shows. */
async function run(browser: Browser, base: string): Promise<{ dropped: number; changed: number }> {
  const ctx = await browser.newContext({ viewport: { width: 1728, height: 964 } });
  const page = await ctx.newPage();
  await installBrandfetchStandIns(page, { delayMs: 0 });
  await page.goto(`${base}/matches`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.locator('[role="option"]').first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  let dropped = 0;
  let changed = 0;
  let last = (await page.evaluate(SELECTED)) as string;
  for (const key of KEYS) {
    await page.keyboard.press(key);
    dropped += (await page.evaluate(COUNT)) as number;
    const now = (await page.evaluate(SELECTED)) as string;
    const [lastRow] = last.split('|');
    const [nowRow, shown] = now.split('|');
    if (nowRow !== lastRow && shown === 'true') changed++;
    last = now;
  }
  await ctx.close();
  return { dropped, changed };
}

const load = () =>
  loadavg()
    .map((n) => n.toFixed(2))
    .join(' ');
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const result: { before: number[]; after: number[]; changed: string[]; load: string[] } = {
  before: [],
  after: [],
  changed: [],
  load: [load()],
};
for (let i = 0; i < rounds; i++) {
  for (const [name, base] of [
    ['before', before],
    ['after', after],
  ] as const) {
    const r = await run(browser, base);
    result[name].push(r.dropped);
    result.changed.push(`${name} ${r.changed}/${KEYS.length}`);
    result.load.push(load());
  }
}
await browser.close();
console.log(JSON.stringify(result, null, 2));
// A press that didn't change the job drops no frames, so a short count would look like a pass.
if (result.changed.some((c) => !c.endsWith(` ${KEYS.length}/${KEYS.length}`))) {
  console.error('some presses did not change the job');
  process.exit(1);
}
