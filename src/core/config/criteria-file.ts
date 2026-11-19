import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument, parse as parseYaml } from 'yaml';
import { normalizeCompanyName } from '../util/hash.js';
import { ConfigError } from './errors.js';
import {
  type Bands,
  DIMENSIONS,
  type Weights,
  bandsSchema,
  criteriaSchema,
  weightsSchema,
} from './schemas.js';
import { type ConfigWriteDeps, backupConfigFile, writeFileAtomic } from './write.js';
import { editYamlText, sameYaml } from './yaml-edit.js';

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

/** Far more names than a personal list. A guard against a runaway paste. */
const MAX_TARGET_COMPANIES = 200;
const MAX_TARGET_NAME = 200;

export interface SavedTargetCompanies {
  names: string[];
  changed: boolean;
  /** Where the previous file was copied, or null when nothing was written. */
  backup: string | null;
}

/**
 * One company per line. Blank lines are dropped. The same name after
 * normalization is kept once, in the spelling of its first line.
 */
export function parseTargetCompanies(text: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const name = raw.trim();
    if (!name) continue;
    if (name.length > MAX_TARGET_NAME) {
      throw new ConfigError('criteria.yaml', [
        `companies: "${name.slice(0, 40)}" is longer than ${MAX_TARGET_NAME} characters`,
      ]);
    }
    const key = normalizeCompanyName(name);
    if (!key) {
      throw new ConfigError('criteria.yaml', [`companies: "${name}" is not a company name`]);
    }
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  if (names.length > MAX_TARGET_COMPANIES) {
    throw new ConfigError('criteria.yaml', [`companies: at most ${MAX_TARGET_COMPANIES} names`]);
  }
  return names;
}

function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

/**
 * Write `target_companies` into `criteria.yaml` (J27). Comments and the other
 * keys stay. The same list writes nothing. Nothing is written until the result
 * parses and validates.
 */
export function saveTargetCompanies(
  dir: string,
  names: readonly string[],
  deps: ConfigWriteDeps,
): SavedTargetCompanies {
  const file = join(dir, 'criteria.yaml');
  const original = readFileSync(file, 'utf8');
  const doc = parseDocument(original);
  if (doc.errors.length > 0) {
    throw new ConfigError(
      file,
      doc.errors.map((e) => `YAML parse error: ${e.message}`),
    );
  }
  const current = criteriaSchema.safeParse(doc.toJS());
  if (!current.success) {
    throw new ConfigError(
      file,
      current.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  const stored = current.data.target_companies ?? [];
  if (sameNames(stored, names)) return { names: stored, changed: false, backup: null };

  const plain = { ...(doc.toJS() as Record<string, unknown>), target_companies: [...names] };
  const check = criteriaSchema.safeParse(plain);
  if (!check.success) {
    throw new ConfigError(
      file,
      check.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }

  let text = editYamlText(original, plain);
  if (text === null) {
    doc.setIn(['target_companies'], [...names]);
    const rewritten = doc.toString();
    text = sameYaml(rewritten, plain) ? rewritten : null;
  }
  if (text === null) {
    throw new ConfigError(file, ['target_companies: the file could not be edited in place']);
  }
  const written = criteriaSchema.safeParse(parseYamlSafe(text));
  if (!written.success || !sameNames(written.data.target_companies ?? [], names)) {
    throw new ConfigError(file, ['target_companies: the edited file did not validate']);
  }

  const backup = backupConfigFile(file, deps);
  writeFileAtomic(file, text);
  return { names: [...names], changed: true, backup };
}
