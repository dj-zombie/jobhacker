/**
 * Print the palette validator table for the kit's tokens in src/app/globals.css.
 *
 *   pnpm palette
 *
 * Exits 1 on any FAIL that isn't a known one (KNOWN_FAILS) or on a WARN with no recorded
 * resolution. The same checks run inside `pnpm check` (src/app/lib/palette.test.ts).
 */
import { readFileSync } from 'node:fs';
import { formatRows, paletteChecks, readThemeColors } from '../src/app/lib/palette.js';

const rows = paletteChecks(readThemeColors(readFileSync('src/app/globals.css', 'utf8')));
console.log(formatRows(rows));
const count = (r: string) => rows.filter((row) => row.result === r).length;
console.log(
  `\n${rows.length} checks: ${count('PASS')} PASS, ${count('KNOWN')} KNOWN, ${count('ACCEPTED')} ACCEPTED, ${count('WARN')} WARN, ${count('FAIL')} FAIL, ${count('INFO')} INFO`,
);
const obligations = new Map<string, string>();
for (const row of rows) {
  if (row.resolution) {
    obligations.set(`${row.result} ${row.resolution.decision}`, row.resolution.obligation);
  }
}
for (const [label, obligation] of obligations) {
  console.log(`\n${label} obliges: ${obligation}`);
}
if (count('FAIL') > 0 || count('WARN') > 0) process.exit(1);
