import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_WARNS,
  CVD,
  KNOWN_FAILS,
  contrast,
  deltaE2000,
  paletteChecks,
  parseHex,
  readThemeColors,
  simulate,
} from './palette.js';

describe('palette math', () => {
  it('matches WCAG contrast reference values', () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrast([119, 119, 119], [255, 255, 255])).toBeCloseTo(4.48, 2);
    expect(contrast([255, 255, 255], [255, 255, 255])).toBe(1);
  });

  it('matches Sharma, Wu & Dalal (2005) CIEDE2000 test pairs', () => {
    const pairs: Array<[[number, number, number], [number, number, number], number]> = [
      [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
      [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
      [[50, 0, 0], [50, -1, 2], 2.3669],
      [[50, 2.5, 0], [73, 25, -18], 27.1492],
      [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
      [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
    ];
    for (const [[L1, a1, b1], [L2, a2, b2], want] of pairs) {
      expect(deltaE2000({ L: L1, a: a1, b: b1 }, { L: L2, a: a2, b: b2 })).toBeCloseTo(want, 3);
    }
  });

  it('simulates color-vision deficiency without moving grays', () => {
    const gray = parseHex('808080');
    for (const m of Object.values(CVD)) {
      const [r, g, b] = simulate(gray, m);
      expect(Math.abs(r - 128) + Math.abs(g - 128) + Math.abs(b - 128)).toBeLessThanOrEqual(3);
    }
  });

  it('reads --color tokens only from @theme blocks', () => {
    const hash = '#';
    const css = `@theme static {\n  --color-a: ${hash}101214;\n}\n.x { --color-b: ${hash}ffffff; }\n`;
    expect(Object.keys(readThemeColors(css))).toEqual(['a']);
  });
});

describe('kit color tokens in globals.css', () => {
  const colors = readThemeColors(readFileSync('src/app/globals.css', 'utf8'));
  const rows = paletteChecks(colors);

  it('defines every color the validator reads', () => {
    const needed = [
      'canvas',
      'panel',
      'surface-1',
      'surface-2',
      'surface-3',
      'fg',
      'fg-2',
      'fg-3',
      'fg-4',
      'brand',
      'brand-hi',
      'brand-lo',
      'strong',
      'maybe',
      'no',
      'danger',
      'info',
      'white',
      'paper',
      'paper-ink',
      'paper-ink-2',
    ];
    expect(needed.filter((n) => !(n in colors))).toEqual([]);
  });

  it('has no FAIL outside the known list (D86)', () => {
    expect(rows.filter((r) => r.result === 'FAIL')).toEqual([]);
  });

  it('has no WARN without a recorded resolution', () => {
    expect(rows.filter((r) => r.result === 'WARN')).toEqual([]);
  });

  it('keeps every known FAIL attached to a row that still fails', () => {
    const raw = paletteChecks(colors, [], []);
    for (const k of KNOWN_FAILS) {
      const row = raw.find((r) => r.check === k.check && r.pair === k.pair);
      expect(row?.result, `${k.check} ${k.pair} (${k.decision})`).toBe('FAIL');
      expect(k.decision).toMatch(/^D\d+$/);
      expect(k.obligation.length).toBeGreaterThan(0);
    }
  });

  it('keeps every recorded WARN resolution attached to a row that is still a WARN', () => {
    const raw = paletteChecks(colors, [], []);
    for (const a of ACCEPTED_WARNS) {
      const row = raw.find((r) => r.check === a.check && r.pair === a.pair);
      expect(row?.result, `${a.check} ${a.pair} (${a.decision})`).toBe('WARN');
    }
  });

  it('never turns a FAIL into ACCEPTED, or a WARN into KNOWN', () => {
    const failing = { ...colors, danger: colors.maybe ?? [0, 0, 0] };
    const entry = {
      check: 'status vs band',
      pair: 'danger / maybe',
      decision: 'D0',
      obligation: 'x',
    };
    const asAccepted = paletteChecks(failing, [entry], []).find(
      (r) => r.check === entry.check && r.pair === entry.pair,
    );
    expect(asAccepted?.result).toBe('FAIL');
    const warning = { ...colors, danger: parseHex('f5a544') }; // ΔE 6.5 from maybe
    const warnRow = paletteChecks(warning, [], []).find(
      (r) => r.check === entry.check && r.pair === entry.pair,
    );
    expect(warnRow?.result).toBe('WARN');
    const asKnown = paletteChecks(warning, [], [entry]).find(
      (r) => r.check === entry.check && r.pair === entry.pair,
    );
    expect(asKnown?.result).toBe('WARN');
  });
});
