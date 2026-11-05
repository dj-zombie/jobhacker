/**
 * Palette validator for the kit's color tokens in globals.css (D71, retargeted by J4).
 *
 * Checks, all computed, none eyeballed:
 * - Text contrast, WCAG 2.x AA 4.5:1, for every text color on every surface text sits on, plus
 *   the primary button label (white on the brand gradient's two ends) and the resume paper.
 * - Mark contrast, WCAG 1.4.11 non-text 3:1, for the brand, band and status colors on every
 *   surface (score pills, band dots, meters, the focus ring).
 * - The three match bands (strong, maybe, no) are pairwise ΔE2000 ≥ 10 apart. Under
 *   color-vision-deficiency simulation (Machado 2009, severity 1) a pair below 10 is a WARN,
 *   not a FAIL, because a band always comes with its score number and label.
 * - Each status color (danger, info) is ΔE2000 ≥ 10 from every band, so a warning never reads
 *   as a band. Below 5 is a FAIL; 5–10 is a WARN. The two status colors are ≥ 10 apart.
 * - The brand and brand-hi are ΔE2000 ≥ 10 from each status color, with the same FAIL and WARN
 *   steps, so the red brand (D150) never reads as a warning.
 * The hairline `line` tokens are translucent, so they aren't read here: they're decorative.
 * A WARN listed in ACCEPTED_WARNS reports as ACCEPTED. A FAIL listed in KNOWN_FAILS reports as
 * KNOWN. J8 (D126) fixed the seven pairs J4 had listed, in the reference kit, so the list is empty.
 */

export type Rgb = readonly [number, number, number];
interface Lab {
  L: number;
  a: number;
  b: number;
}

export type Result = 'PASS' | 'WARN' | 'ACCEPTED' | 'FAIL' | 'KNOWN' | 'INFO';

export interface CheckRow {
  check: string;
  pair: string;
  value: string;
  need: string;
  result: Result;
  resolution?: Resolution;
}

/** A WARN accepted, or a FAIL deferred, on purpose: the decision and what it obliges later rounds to do. */
export interface Resolution {
  check: string;
  pair: string;
  decision: string;
  obligation: string;
}

/**
 * Every WARN must be listed here or `pnpm check` fails. An entry whose row is no longer a WARN
 * fails too, so the list cannot go stale. The kit's tokens produce no WARN.
 */
export const ACCEPTED_WARNS: readonly Resolution[] = [];

const SURFACES = ['canvas', 'panel', 'surface-1', 'surface-2', 'surface-3'] as const;

/**
 * Pairs below WCAG AA that stay listed on purpose. Empty since J8 (D126) lifted fg-3, fg-4 and
 * brand in the reference kit. A FAIL not listed here fails `pnpm check`, and so does a listed
 * pair that starts passing.
 */
export const KNOWN_FAILS: readonly Resolution[] = [];

export function parseHex(hex: string): Rgb {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`not a 6-digit hex color: ${hex}`);
  const channel = (i: number) => Number.parseInt(full.slice(i, i + 2), 16);
  return [channel(0), channel(2), channel(4)];
}

const toLinear = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c: number): number => {
  const v = Math.min(1, Math.max(0, c));
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(s * 255);
};

export function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(toLinear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export function toLab(rgb: Rgb): Lab {
  const [r, g, b] = rgb.map(toLinear) as [number, number, number];
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
  return { L: 116 * f(y) - 16, a: 500 * (f(x) - f(y)), b: 200 * (f(y) - f(z)) };
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** CIEDE2000 colour difference (Sharma, Wu & Dalal 2005). */
export function deltaE2000(p: Lab, q: Lab): number {
  const C1 = Math.hypot(p.a, p.b);
  const C2 = Math.hypot(q.a, q.b);
  const Cbar7 = ((C1 + C2) / 2) ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 25 ** 7)));
  const a1 = (1 + G) * p.a;
  const a2 = (1 + G) * q.a;
  const C1p = Math.hypot(a1, p.b);
  const C2p = Math.hypot(a2, q.b);
  const hue = (a: number, b: number) => {
    if (a === 0 && b === 0) return 0;
    const d = (Math.atan2(b, a) * 180) / Math.PI;
    return d >= 0 ? d : d + 360;
  };
  const h1 = hue(a1, p.b);
  const h2 = hue(a2, q.b);
  const dL = q.L - p.L;
  const dC = C2p - C1p;
  let dh = 0;
  if (C1p * C2p !== 0) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dh) / 2);
  const Lbar = (p.L + q.L) / 2;
  const Cbar = (C1p + C2p) / 2;
  let hbar = h1 + h2;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1 - h2) > 180) hbar = h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
    else hbar = (h1 + h2) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos(rad(hbar - 30)) +
    0.24 * Math.cos(rad(2 * hbar)) +
    0.32 * Math.cos(rad(3 * hbar + 6)) -
    0.2 * Math.cos(rad(4 * hbar - 63));
  const dTheta = 30 * Math.exp(-(((hbar - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2);
  const Sc = 1 + 0.045 * Cbar;
  const Sh = 1 + 0.015 * Cbar * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

export function deltaE(a: Rgb, b: Rgb): number {
  return deltaE2000(toLab(a), toLab(b));
}

type Matrix = readonly [Rgb, Rgb, Rgb];
/** Machado, Oliveira & Fernandes 2009, severity 1.0, applied in linear RGB. */
export const CVD: Record<'protan' | 'deutan' | 'tritan', Matrix> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

export function simulate(rgb: Rgb, m: Matrix): Rgb {
  const [r, g, b] = rgb.map(toLinear) as [number, number, number];
  const apply = (row: Rgb) => fromLinear(row[0] * r + row[1] * g + row[2] * b);
  return [apply(m[0]), apply(m[1]), apply(m[2])];
}

/** `--color-<name>: #hex` declarations inside the `@theme` blocks of globals.css. */
export function readThemeColors(css: string): Record<string, Rgb> {
  const out: Record<string, Rgb> = {};
  for (const block of css.matchAll(/@theme[^{]*\{([\s\S]*?)\n\}/g)) {
    for (const m of (block[1] ?? '').matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g)) {
      const [, name, hex] = m;
      if (name && hex) out[name] = parseHex(hex);
    }
  }
  return out;
}

const TEXT_COLORS = [
  'fg',
  'fg-2',
  'fg-3',
  'fg-4',
  'brand-hi',
  'strong',
  'maybe',
  'no',
  'danger',
  'info',
] as const;
const MARK_COLORS = ['brand', 'brand-hi', 'strong', 'maybe', 'no', 'danger', 'info'] as const;
const BANDS = ['strong', 'maybe', 'no'] as const;
const STATUS = ['danger', 'info'] as const;
const BRANDS = ['brand', 'brand-hi'] as const;

const ratio = (n: number) => `${n.toFixed(2)}:1`;
const de = (n: number) => `ΔE ${n.toFixed(1)}`;

export function paletteChecks(
  colors: Record<string, Rgb>,
  accepted: readonly Resolution[] = ACCEPTED_WARNS,
  known: readonly Resolution[] = KNOWN_FAILS,
): CheckRow[] {
  const find = (list: readonly Resolution[], row: CheckRow) =>
    list.find((a) => a.check === row.check && a.pair === row.pair);
  return rawChecks(colors).map((row): CheckRow => {
    if (row.result === 'WARN') {
      const resolution = find(accepted, row);
      return resolution ? { ...row, result: 'ACCEPTED', resolution } : row;
    }
    if (row.result === 'FAIL') {
      const resolution = find(known, row);
      return resolution ? { ...row, result: 'KNOWN', resolution } : row;
    }
    return row;
  });
}

function rawChecks(colors: Record<string, Rgb>): CheckRow[] {
  const get = (name: string): Rgb => {
    const c = colors[name];
    if (!c) throw new Error(`token --color-${name} is missing from @theme`);
    return c;
  };
  const rows: CheckRow[] = [];
  const push = (check: string, pair: string, value: string, need: string, result: Result) =>
    rows.push({ check, pair, value, need, result });
  const text = (fg: string, bg: string) => {
    const c = contrast(get(fg), get(bg));
    push('text 4.5:1', `${fg} on ${bg}`, ratio(c), '≥ 4.50', c >= 4.5 ? 'PASS' : 'FAIL');
  };

  for (const fg of TEXT_COLORS) {
    for (const bg of SURFACES) text(fg, bg);
  }
  text('white', 'brand');
  text('white', 'brand-lo');
  text('paper-ink', 'paper');
  text('paper-ink-2', 'paper');

  for (const fg of MARK_COLORS) {
    for (const bg of SURFACES) {
      const c = contrast(get(fg), get(bg));
      push('mark 3:1', `${fg} on ${bg}`, ratio(c), '≥ 3.00', c >= 3 ? 'PASS' : 'FAIL');
    }
  }

  const distinct = (check: string, a: string, b: string, cvdBelow: Result) => {
    const d = deltaE(get(a), get(b));
    push(check, `${a} / ${b}`, de(d), '≥ 10', d >= 10 ? 'PASS' : 'FAIL');
    for (const [kind, m] of Object.entries(CVD)) {
      const dc = deltaE(simulate(get(a), m), simulate(get(b), m));
      push(
        `${check} (${kind})`,
        `${a} / ${b}`,
        de(dc),
        '≥ 10 (label carries it below)',
        dc >= 10 ? 'PASS' : cvdBelow,
      );
    }
  };
  for (let i = 0; i < BANDS.length; i++) {
    for (let j = i + 1; j < BANDS.length; j++) {
      distinct('band distinct', BANDS[i] as string, BANDS[j] as string, 'WARN');
    }
  }
  distinct('status distinct', 'danger', 'info', 'WARN');

  for (const s of STATUS) {
    for (const b of BANDS) {
      const d = deltaE(get(s), get(b));
      push(
        'status vs band',
        `${s} / ${b}`,
        de(d),
        '≥ 10',
        d >= 10 ? 'PASS' : d >= 5 ? 'WARN' : 'FAIL',
      );
    }
  }

  for (const b of BRANDS) {
    for (const s of STATUS) {
      const d = deltaE(get(b), get(s));
      push(
        'brand vs status',
        `${b} / ${s}`,
        de(d),
        '≥ 10',
        d >= 10 ? 'PASS' : d >= 5 ? 'WARN' : 'FAIL',
      );
    }
  }
  return rows;
}

export function formatRows(rows: CheckRow[]): string {
  const widths = [28, 40, 12, 30];
  const line = (cols: string[]) => cols.map((c, i) => c.padEnd(widths[i] ?? 8)).join('  ');
  return [
    line(['check', 'pair', 'value', 'need', 'result']),
    ...rows.map((r) =>
      line([
        r.check,
        r.pair,
        r.value,
        r.need,
        r.resolution ? `${r.result} ${r.resolution.decision}` : r.result,
      ]),
    ),
  ].join('\n');
}
