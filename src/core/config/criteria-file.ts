import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument, parse as parseYaml } from 'yaml';
import { ConfigError } from './errors.js';
import {
  type Bands,
  DIMENSIONS,
  type Weights,
  bandsSchema,
  criteriaSchema,
  weightsSchema,
} from './schemas.js';

export interface SavedRanking {
  weights: Weights;
  bands: Bands;
}

/**
 * Write ranking weights into `criteria.yaml`, leaving the bands as they are.
 * `saveRanking` does the edit.
 */
export function saveWeights(dir: string, weights: Weights): Weights {
  const file = join(dir, 'criteria.yaml');
  const current = criteriaSchema.safeParse(parseYaml(readFileSync(file, 'utf8')));
  if (!current.success) {
    throw new ConfigError(
      file,
      current.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return saveRanking(dir, { weights, bands: current.data.bands }).weights;
}

/**
 * Write `weights` and `bands` into `criteria.yaml` (J6).
 *
 * The edit goes through the YAML document API (`parseDocument`, `setIn`): that
 * is what decides the new file. `Document.toString()` in yaml 2.7 reflows the
 * whole file, which would rewrite comments' columns and unfold the place
 * lists. When replacing the numbers on their own lines reproduces that
 * document, those lines are what get written, so a block-style file changes
 * only its weight and band lines and keeps every comment. A file that isn't
 * laid out that way (a flow map) is written with `toString()`, which keeps
 * the comments and the key order. Nothing is written until the result parses
 * and validates.
 */
export function saveRanking(dir: string, ranking: SavedRanking): SavedRanking {
  const file = join(dir, 'criteria.yaml');
  const parsedWeights = weightsSchema.safeParse(ranking.weights);
  const parsedBands = bandsSchema.safeParse(ranking.bands);
  const issues = [
    ...(parsedWeights.success
      ? []
      : parsedWeights.error.issues.map((i) => `weights.${i.path.join('.')}: ${i.message}`)),
    ...(parsedBands.success
      ? []
      : parsedBands.error.issues.map((i) => `bands.${i.path.join('.')}: ${i.message}`)),
  ];
  if (!parsedWeights.success || !parsedBands.success) throw new ConfigError(file, issues);
  const nextWeights = parsedWeights.data;
  const nextBands = parsedBands.data;

  const original = readFileSync(file, 'utf8');
  const doc = parseDocument(original);
  if (doc.errors.length > 0) {
    throw new ConfigError(
      file,
      doc.errors.map((e) => `YAML parse error: ${e.message}`),
    );
  }
  for (const d of DIMENSIONS) doc.setIn(['weights', d], nextWeights[d]);
  doc.setIn(['bands', 'strong'], nextBands.strong);
  doc.setIn(['bands', 'maybe'], nextBands.maybe);

  const expected = criteriaSchema.safeParse(doc.toJS());
  if (!expected.success) {
    throw new ConfigError(
      file,
      expected.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }

  let text = original;
  for (const d of DIMENSIONS) text = replaceScalar(text, d, nextWeights[d]);
  text = replaceScalar(text, 'strong', nextBands.strong);
  text = replaceScalar(text, 'maybe', nextBands.maybe);
  const line = criteriaSchema.safeParse(parseYamlSafe(text));
  const lineMatches = line.success && JSON.stringify(line.data) === JSON.stringify(expected.data);

  const out = lineMatches ? text : doc.toString();
  const check = lineMatches ? line : criteriaSchema.safeParse(parseYamlSafe(out));
  if (!check.success) {
    throw new ConfigError(
      file,
      check.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  writeFileSync(file, out);
  return { weights: check.data.weights, bands: check.data.bands };
}

/** Replace the number on a `key:` line. A flow map has no such line and is left unchanged. */
function replaceScalar(text: string, key: string, value: number): string {
  return text.replace(
    new RegExp(`^([ \\t]+${key}:[ \\t]*)[-+]?\\d+(?:\\.\\d+)?`, 'm'),
    `$1${value}`,
  );
}

function parseYamlSafe(text: string): unknown {
  try {
    return parseYaml(text);
  } catch {
    return undefined;
  }
}
