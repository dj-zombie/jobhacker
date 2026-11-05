import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ZodType, ZodTypeDef, z } from 'zod';
import { ConfigError } from './errors.js';
import { isLegacyCriteria } from './migrate.js';
import {
  type Companies,
  type ConfigName,
  type Criteria,
  PREFERENCES_FILE,
  type Profile,
  configFiles,
} from './schemas.js';

export { ConfigError };

export const DEFAULT_CONFIG_DIR = process.env.JOBHACKER_CONFIG_DIR ?? 'config';

/**
 * Load and validate one config file, returning the typed value or throwing a
 * `ConfigError` that names the file, the dotted path and the message.
 */
export function loadConfigFile<T>(
  name: ConfigName,
  schema: ZodType<T, ZodTypeDef, unknown>,
  dir: string = DEFAULT_CONFIG_DIR,
): T {
  const file = configFiles[name].file;
  const path = join(dir, file);

  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new ConfigError(path, [
      `file not found. Copy config/${name}.example.yaml to config/${file} and edit it.`,
    ]);
  }

  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigError(path, [`YAML parse error: ${message}`]);
  }

  if (name === 'criteria' && isLegacyCriteria(raw)) {
    throw new ConfigError(path, [
      'this is the v1 keyword-list format (titles/locations/interests). Run `pnpm cli config:migrate` to convert it to gates + weights and draft config/preferences.md.',
    ]);
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(path, formatIssues(result.error));
  }
  return result.data;
}

/** Turn a ZodError into `path: message` lines. */
export function formatIssues(error: z.ZodError, prefix = ''): string[] {
  return error.issues.map((issue) => {
    const path = [prefix, ...issue.path].filter((p) => p !== '').join('.') || '(root)';
    const blank = issue.code === 'too_small' && issue.type === 'string' && issue.minimum === 1;
    return `${path}: ${blank ? "can't be blank" : issue.message}`;
  });
}

/** What `loadPreferences` says about a blank `preferences.md`, and why `savePreferences` refuses one. */
export const EMPTY_PREFERENCES = 'file is empty. Describe the roles you want in prose.';

/**
 * Load `preferences.md`, the prose taste document (FR-12). Returned as text;
 * the scorer and prescore read it. Missing or blank is a config error.
 */
export function loadPreferences(dir: string = DEFAULT_CONFIG_DIR): string {
  const path = join(dir, PREFERENCES_FILE);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new ConfigError(path, [
      'file not found. Run `pnpm cli config:migrate` to draft it from a v1 criteria.yaml, or copy config/preferences.example.md to config/preferences.md and edit it.',
    ]);
  }
  if (text.trim().length === 0) {
    throw new ConfigError(path, [EMPTY_PREFERENCES]);
  }
  return text;
}

export interface AppConfig {
  criteria: Criteria;
  profile: Profile;
  companies: Companies;
  /** `preferences.md` as written (FR-12). */
  preferences: string;
}

/**
 * Load every config file. Collects errors across files so `config:check`
 * can report every problem at once instead of failing on the first.
 */
export function loadAllConfig(dir: string = DEFAULT_CONFIG_DIR): AppConfig {
  const errors: ConfigError[] = [];
  const results: Partial<AppConfig> = {};

  for (const name of Object.keys(configFiles) as ConfigName[]) {
    try {
      // The registry guarantees the schema matches the key's type.
      const value = loadConfigFile(name, configFiles[name].schema as ZodType<unknown>, dir);
      (results as Record<string, unknown>)[name] = value;
    } catch (err) {
      if (err instanceof ConfigError) {
        errors.push(err);
      } else {
        throw err;
      }
    }
  }
  try {
    results.preferences = loadPreferences(dir);
  } catch (err) {
    if (err instanceof ConfigError) errors.push(err);
    else throw err;
  }

  if (errors.length > 0) {
    const file = errors.map((e) => e.file).join(', ');
    const issues = errors.flatMap((e) => e.issues.map((i) => `${e.file} → ${i}`));
    throw new ConfigError(file, issues);
  }

  return results as AppConfig;
}
