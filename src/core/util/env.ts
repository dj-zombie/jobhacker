import { readFileSync } from 'node:fs';

/**
 * Minimal `.env` loader (Known issue [2]). Core modules read secrets like
 * `ANTHROPIC_API_KEY` straight from `process.env`, but there was no loader, so a
 * key that lived only in a `.env` file was ignored by the CLI. Next.js loads
 * `.env` on its own, so this is wired at the CLI entry only.
 *
 * Deliberately tiny and dependency-free: `KEY=value` per line, `#` comments,
 * optional surrounding quotes. Existing `process.env` values are never
 * overwritten (the real environment wins). Invariant 4: this never logs values.
 */

/** Parse `.env` file contents into a key/value map (pure). */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Load `path` (default `.env`) into `process.env`, without overwriting existing
 * variables. Missing file is a no-op. Returns the keys that were set.
 */
export function loadEnv(path = '.env'): string[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const parsed = parseEnv(text);
  const set: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
      set.push(key);
    }
  }
  return set;
}
