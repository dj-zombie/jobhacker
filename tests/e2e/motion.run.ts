/**
 * J17 acceptance 6, against a server that is already running:
 *
 *   pnpm exec tsx tests/e2e/motion.run.ts http://127.0.0.1:3000
 *
 * On `/` at 1440×900 it checks that the title decodes once and the h1's accessible text is the
 * real title throughout, that a row under a resting pointer drops its hover tick and wash after 12
 * J presses and gets them back when the pointer moves, that the list's target lock lets go during
 * those presses and is back 600 ms after them, that reduced motion shows no decode or beam and
 * keeps the lock, and that at most three infinite animations (live loops) run at rest, grouped by
 * the component that owns them. A running scout's indicator comes on top of those three (UI-KIT
 * § Motion). Point it at a server whose latest scout is unfinished to count the loops while a
 * scout runs.
 */
import { type Browser, chromium } from 'playwright-core';
import { resolveChrome } from '../../src/core/apply/browser.js';
import { installBrandfetchStandIns, isBrandfetchLoadError } from './brandfetch.js';

const base = process.argv[2];
if (!base) throw new Error('pass the server origin, e.g. http://127.0.0.1:3000');
const chrome = resolveChrome();
if (!chrome) throw new Error('Chrome is not installed');

interface DecodeLog {
  firstAt: number | null;
  lastAt: number | null;
  names: string[];
}
interface Hovered {
  pointer: boolean;
  selected: string | null;
  tick: string | null;
  wash: boolean | null;
}
interface Lock {
  on: boolean;
  opacity: string;
}
interface Loop {
  component: string;
  animation: string;
  element: string;
}

// Strings, so the runner's compiler doesn't inject helpers into the page.
const WATCH_H1 = `(() => {
  const log = { firstAt: null, lastAt: null, names: [] };
  window.__decode = log;
  const tick = () => {
    const h = document.querySelector('h1');
    if (h) {
      const now = performance.now();
      const overlay = h.querySelector('[aria-hidden]:not([hidden])');
      if (overlay && overlay.textContent) {
        if (log.firstAt === null) log.firstAt = now;
        log.lastAt = now;
      }
      const copy = h.cloneNode(true);
      for (const el of copy.querySelectorAll('[aria-hidden]')) el.remove();
      const name = (copy.textContent || '').trim();
      if (name && !log.names.includes(name)) log.names.push(name);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`;

const HOVERED = `(() => {
  const h = [...document.querySelectorAll('[role="option"]')].find((o) => o.matches(':hover'));
  if (!h) return null;
  const row = h.querySelector('.group');
  return {
    pointer: h.closest('[role="listbox"]').hasAttribute('data-pointer'),
    selected: h.getAttribute('aria-selected'),
    tick: row ? getComputedStyle(row, '::before').scale : null,
    wash: row ? getComputedStyle(row).backgroundImage !== 'none' : null,
  };
})()`;

const LIST_LOCK = `(() => {
  const l = document.querySelector('[role="listbox"] [data-corner]');
  return l ? { on: l.hasAttribute('data-on'), opacity: getComputedStyle(l).opacity } : null;
})()`;

const LOOPS = `document.getAnimations()
  .filter((a) => a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations === Infinity)
  .map((a) => {
    const el = a.effect.target;
    const name = a.animationName || '?';
    const inSidebar = !!el.closest('aside');
    const component =
      name === 'blink' && el.closest('svg') ? 'BrandMark caret'
      : name.startsWith('beam') ? 'CompanyHeader beam'
      : inSidebar && (name === 'blink' || name === 'spin' || name.startsWith('radar') || name === 'ping') ? 'ScoutCard'
      : name === 'blink' ? 'CompanyHeader REC'
      : name.startsWith('radar') || name === 'ping' ? 'EmptyState radar'
      : 'other';
    return { component, animation: name, element: (el.getAttribute('class') || el.tagName).slice(0, 60) };
  })`;

async function open(browser: Browser, reducedMotion: 'reduce' | 'no-preference') {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion });
  const page = await ctx.newPage();
  await installBrandfetchStandIns(page, { delayMs: 0 });
  await page.addInitScript(WATCH_H1);
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isBrandfetchLoadError(msg.text(), msg.location().url)) {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.locator('[role="option"]').first().waitFor({ timeout: 60_000 });
  return { ctx, page, errors };
}

const browser = await chromium.launch({ executablePath: chrome, headless: true });

const normal = await open(browser, 'no-preference');
const { page } = normal;
await page.waitForTimeout(1500);
const decode = (await page.evaluate('window.__decode')) as DecodeLog;
const decodeGone = await page.evaluate(`!document.querySelector('h1 [aria-hidden]:not([hidden])')`);
const scoutRunning = (await page.getByText('Scouting', { exact: true }).count()) > 0;
const loopsAtLoad = (await page.evaluate(LOOPS)) as Loop[];
await page.waitForTimeout(2500);
const loopsLater = (await page.evaluate(LOOPS)) as Loop[];

const option = await page.locator('[role="option"]').nth(3).boundingBox();
let afterPointerMove: Hovered | null = null;
let afterTwelveJ: Hovered | null = null;
let afterMoveAgain: Hovered | null = null;
let lockDuringBurst: Lock | null = null;
let lockAfterBurst: Lock | null = null;
if (option) {
  await page.mouse.move(option.x + 200, option.y + option.height / 2);
  await page.waitForTimeout(500);
  afterPointerMove = (await page.evaluate(HOVERED)) as Hovered | null;
  for (let i = 0; i < 12; i++) await page.keyboard.press('j');
  lockDuringBurst = (await page.evaluate(LIST_LOCK)) as Lock | null;
  await page.waitForTimeout(600);
  afterTwelveJ = (await page.evaluate(HOVERED)) as Hovered | null;
  lockAfterBurst = (await page.evaluate(LIST_LOCK)) as Lock | null;
  await page.mouse.move(option.x + 210, option.y + option.height / 2 + 2);
  await page.waitForTimeout(500);
  afterMoveAgain = (await page.evaluate(HOVERED)) as Hovered | null;
}
await normal.ctx.close();

const quiet = await open(browser, 'reduce');
await quiet.page.waitForTimeout(1500);
const reducedDecode = (await quiet.page.evaluate('window.__decode')) as DecodeLog;
const reduced = {
  decodeSeen: reducedDecode.firstAt !== null,
  h1: reducedDecode.names,
  lock: (await quiet.page.evaluate(LIST_LOCK)) as Lock | null,
  beamShown: await quiet.page.evaluate(`(() => {
    const b = document.querySelector('.animate-beam');
    return b ? getComputedStyle(b).display !== 'none' : null;
  })()`),
  caret: await quiet.page.evaluate(`(() => {
    const el = document.querySelector('svg .animate-blink');
    const s = el && getComputedStyle(el);
    return s ? s.animationDuration + ' x' + s.animationIterationCount : null;
  })()`),
  loops: ((await quiet.page.evaluate(LOOPS)) as Loop[]).length,
};
await quiet.ctx.close();
await browser.close();

const components = (loops: Loop[]) => [...new Set(loops.map((l) => l.component))];
const atRest = (names: string[]) => names.filter((n) => n !== 'ScoutCard');
const result = {
  scoutRunning,
  decode: {
    seen: decode.firstAt !== null,
    ms:
      decode.firstAt !== null && decode.lastAt !== null
        ? Math.round(decode.lastAt - decode.firstAt)
        : null,
    goneBy1500ms: decodeGone,
    h1: decode.names,
  },
  hover: { afterPointerMove, afterTwelveJ, afterMoveAgain },
  listLock: { duringBurst: lockDuringBurst, afterBurst: lockAfterBurst },
  reduced,
  liveLoops: {
    atLoad: components(loopsAtLoad),
    later: components(loopsLater),
    elements: loopsLater,
  },
  errors: [...normal.errors, ...quiet.errors],
};
console.log(JSON.stringify(result, null, 2));

const failures = [
  !result.decode.seen && 'the title never decoded',
  (result.decode.ms ?? 0) >= 1200 && 'the decode ran 1.2 s or longer',
  !result.decode.goneBy1500ms && 'the decode overlay is still there',
  result.decode.h1.length !== 1 && 'the h1 text changed',
  !(afterPointerMove?.wash && afterPointerMove.tick === '1') &&
    'no tick or wash under a moving pointer',
  (afterTwelveJ?.wash !== false || afterTwelveJ.tick !== '1 0') &&
    'tick or wash stayed under a resting pointer after J',
  !(afterMoveAgain?.wash && afterMoveAgain.tick === '1') &&
    'tick or wash did not come back when the pointer moved',
  lockDuringBurst?.on !== false && 'the list lock held on during a burst of J',
  lockAfterBurst?.on !== true && 'the list lock did not come back after the burst',
  reduced.decodeSeen && 'reduced motion still decodes',
  reduced.h1.length !== 1 && 'reduced motion changed the h1 text',
  !(reduced.lock?.on && reduced.lock.opacity === '1') && 'reduced motion hides the list lock',
  reduced.beamShown !== false && 'reduced motion shows the beam',
  reduced.caret !== '0.001s x1' && 'reduced motion still loops the caret',
  reduced.loops !== 0 && 'reduced motion still runs loops',
  atRest(result.liveLoops.atLoad).length > 3 && 'more than three live loops at load',
  atRest(result.liveLoops.later).length > 3 && 'more than three live loops',
  !scoutRunning &&
    result.liveLoops.later.includes('ScoutCard') &&
    'the scout card loops with no scout running',
  result.errors.length > 0 && 'console errors',
].filter(Boolean);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
