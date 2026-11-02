import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards for the kit's design system (J4; UI-KIT § Checks 1, 3 and 9): color comes only from the
 * tokens in globals.css, nothing references the earlier design system, kit components never
 * fetch, and no client module imports server code directly.
 *
 * Patterns are assembled from parts so the UI-KIT greps never match this file.
 */

const ROOT = process.cwd();
const UI_DIRS = ['src/app', 'src/components', 'src/lib'];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

const files = UI_DIRS.flatMap((d) => walk(join(ROOT, d)))
  .filter((f) => /\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => ({ path: relative(ROOT, f), source: readFileSync(f, 'utf8') }));

const TOKEN_FILE = 'src/app/globals.css';
const withoutCssComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const code = (f: { path: string; source: string }) =>
  f.path.endsWith('.css') ? withoutCssComments(f.source) : f.source;

const SHADES = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
].join('|');
const UTILITIES =
  'bg|text|border|ring|from|via|to|fill|stroke|outline|divide|shadow|accent|caret|decoration|placeholder';
const DEFAULT_PALETTE = new RegExp(`\\b(?:${UTILITIES})-(?:${SHADES})-\\d{2,3}\\b`, 'g');
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const OLD_SYSTEM = new RegExp(
  [
    'surface-(?:sunken|base|raised)',
    'ink-(?:primary|secondary|muted)',
    'signal-(?:high|mid|low)',
    'status-(?:critical|good|warn)',
    `IBM ${'Plex'}`,
  ].join('|'),
  'g',
);
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const OLD_TOKENS = readFileSync(join(ROOT, 'docs/testing/old-tokens.txt'), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean);
const OLD_TOKEN = new RegExp(
  `(?:${OLD_TOKENS.map(escapeRegExp).join('|')})(?=[^a-zA-Z0-9-]|$)`,
  'gm',
);
const FETCHES = /@\/core|better-sqlite3|use server|fetch\(/g;
const SERVER_IMPORT = /core\/db|better-sqlite3|node:fs|config\/load/g;
const USE_CLIENT = /^\s*['"]use client['"];?/m;

const hits = (re: RegExp, source: string) => [...source.matchAll(re)].map((m) => m[0]);
const offenders = (re: RegExp, list: typeof files) =>
  list.flatMap((f) => hits(re, code(f)).map((h) => `${f.path}: ${h}`));

describe('design tokens (UI-KIT § Checks)', () => {
  it('reads a non-empty old-token list', () => {
    expect(OLD_TOKENS.length).toBeGreaterThan(40);
  });

  it("uses no class from Tailwind's default palette", () => {
    expect(offenders(DEFAULT_PALETTE, files)).toEqual([]);
  });

  it('has no hex color outside the token file', () => {
    expect(
      offenders(
        HEX,
        files.filter((f) => f.path !== TOKEN_FILE),
      ),
    ).toEqual([]);
  });

  it("names none of the earlier design system's tokens or its font", () => {
    expect(offenders(OLD_SYSTEM, files)).toEqual([]);
    expect(offenders(OLD_TOKEN, files)).toEqual([]);
  });

  it('keeps kit components presentational (Check 3)', () => {
    const kit = files.filter((f) => f.path.startsWith('src/components/jobhacker/'));
    expect(kit.length).toBeGreaterThan(20);
    expect(offenders(FETCHES, kit)).toEqual([]);
  });

  it('keeps server code out of client modules (Check 9, direct imports)', () => {
    const client = files.filter((f) => USE_CLIENT.test(f.source));
    expect(client.length).toBeGreaterThan(10);
    expect(offenders(SERVER_IMPORT, client)).toEqual([]);
  });

  it('catches the patterns it claims to', () => {
    const shade = (u: string, s: string) => `${u}-${s}-${800}`;
    expect(hits(DEFAULT_PALETTE, `${shade('bg', 'neutral')} text-fg bg-surface-2`)).toEqual([
      shade('bg', 'neutral'),
    ]);
    expect(hits(HEX, `color: ${'#'}1d2024;`)).toEqual([`${'#'}1d2024`]);
    expect(hits(HEX, 'href={`#${id}`}')).toEqual([]);
    expect(hits(OLD_SYSTEM, `bg-${'surface'}-base text-fg`)).toEqual([`${'surface'}-base`]);
    const radius = OLD_TOKENS.find((t) => t === `--${'radius'}`);
    expect(radius).toBeDefined();
    expect(hits(OLD_TOKEN, `${radius}: 4px; ${radius}-xs: 4px;`)).toEqual([radius]);
    const directive = ['use', 'client'].join(' ');
    expect(USE_CLIENT.test(`'${directive}';\nimport x`)).toBe(true);
    expect(USE_CLIENT.test(`"${directive}";\nimport x`)).toBe(true);
    expect(withoutCssComments(`/* ${shade('bg', 'zinc')} */ .x{}`)).toBe(' .x{}');
  });
});
