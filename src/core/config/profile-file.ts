import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { ConfigError } from './errors.js';
import { formatIssues } from './load.js';
import {
  DECLINE,
  type ProfileSection,
  SELF_ID_KEYS,
  type SectionInputs,
  sectionInputSchemas,
  toSectionInputs,
} from './profile-sections.js';
import { type Profile, configFiles, profileSchema } from './schemas.js';
import { type ConfigWriteDeps, backupConfigFile, writeFileAtomic } from './write.js';
import { editYamlText, sameYaml } from './yaml-edit.js';

export interface ProfileEdit {
  file: string;
  /** The file's text when the edit was planned. `commitProfileEdit` refuses if it has changed since. */
  original: string;
  /** The text to write. Equal to `original` when `changed` is false. */
  text: string;
  changed: boolean;
  /** The profile as stored, and as it will be after the write. */
  current: Profile;
  next: Profile;
}

export interface SavedProfileSection {
  changed: boolean;
  profile: Profile;
  /** The section as saved, in the shape Settings edits, with any new ids filled in. */
  saved: SectionInputs[ProfileSection];
  /** Where the previous file was copied, or null when nothing was written. */
  backup: string | null;
}

/**
 * Save one section of `profile.yaml` (J18): plan the edit, then back up the file and write it.
 * Throws `ConfigError` with `section.path: message` lines when the input or the edited file
 * doesn't validate, and leaves the file as it was. A save that changes nothing writes nothing.
 */
export function saveProfileSection(
  dir: string,
  section: ProfileSection,
  value: unknown,
  deps: ConfigWriteDeps,
): SavedProfileSection {
  const edit = planProfileSection(dir, section, value);
  const backup = edit.changed ? commitProfileEdit(edit, deps) : null;
  return {
    changed: edit.changed,
    profile: edit.next,
    saved: toSectionInputs(edit.next)[section],
    backup,
  };
}

/**
 * Work out what saving `value` into `section` would write, without writing it.
 *
 * The section is rebuilt from the input, keeping the file's key order, any optional key the
 * file already had, and each kept bullet's `sources`. The whole edited document must pass
 * `profileSchema`. The text is a line-preserving splice of the original (`editYamlText`); when
 * the file isn't laid out for that, it falls back to `parseDocument` and `setIn`, like
 * `saveRanking`. Either way the text is parsed back and must equal the edited document.
 */
export function planProfileSection(
  dir: string,
  section: ProfileSection,
  value: unknown,
): ProfileEdit {
  const file = join(dir, configFiles.profile.file);
  const original = readProfileText(file);
  const doc = parseDocument(original);
  if (doc.errors.length > 0) {
    throw new ConfigError(
      file,
      doc.errors.map((e) => `YAML parse error: ${e.message}`),
    );
  }
  const raw: unknown = doc.toJS();
  if (!isRecord(raw)) throw new ConfigError(file, ['(root): must be a mapping of sections']);
  const stored = profileSchema.safeParse(raw);
  if (!stored.success) throw new ConfigError(file, formatIssues(stored.error));

  const input = sectionInputSchemas[section].safeParse(value);
  if (!input.success) throw new ConfigError(file, formatIssues(input.error, section));

  const built = buildSection(section, input.data, stored.data, raw);
  if (built.issues.length > 0) throw new ConfigError(file, built.issues);

  const nextRaw: Record<string, unknown> = { ...raw };
  if (built.value === undefined) delete nextRaw[section];
  else nextRaw[section] = built.value;
  const plain = JSON.parse(JSON.stringify(nextRaw)) as Record<string, unknown>;

  const next = profileSchema.safeParse(plain);
  if (!next.success) throw new ConfigError(file, formatIssues(next.error));

  const changed =
    JSON.stringify(sectionOf(stored.data, section)) !==
    JSON.stringify(sectionOf(next.data, section));
  if (!changed) {
    return { file, original, text: original, changed, current: stored.data, next: stored.data };
  }

  let text = editYamlText(original, plain);
  if (text === null) {
    if (plain[section] === undefined) doc.deleteIn([section]);
    else doc.setIn([section], doc.createNode(plain[section]));
    const rewritten = doc.toString();
    text = sameYaml(rewritten, plain) ? rewritten : null;
  }
  if (text === null) {
    throw new ConfigError(file, [
      `${section}: the edit could not be written without changing other sections`,
    ]);
  }
  return { file, original, text, changed, current: stored.data, next: next.data };
}

/**
 * Write a planned edit: refuse if the file changed since it was planned, copy the file to the
 * backup folder, then write through a temporary file and a rename. Returns the backup's path.
 */
export function commitProfileEdit(edit: ProfileEdit, deps: ConfigWriteDeps): string {
  if (readProfileText(edit.file) !== edit.original) {
    throw new ConfigError(edit.file, [
      '(root): profile.yaml changed on disk since this page loaded. Reload Settings and make the edit again.',
    ]);
  }
  const backup = backupConfigFile(edit.file, deps);
  writeFileAtomic(edit.file, edit.text);
  return backup;
}

function readProfileText(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    throw new ConfigError(file, [
      'file not found. Copy config/profile.example.yaml to config/profile.yaml and edit it.',
    ]);
  }
}

/** A section with its schema default applied, so a missing block compares equal to an empty one. */
function sectionOf(profile: Profile, section: ProfileSection): unknown {
  if (section === 'self_identification') {
    const self = profile.self_identification;
    return {
      gender: self?.gender ?? DECLINE,
      race_ethnicity: self?.race_ethnicity ?? DECLINE,
      veteran_status: self?.veteran_status ?? DECLINE,
      disability_status: self?.disability_status ?? DECLINE,
      overrides: self?.overrides ?? {},
    };
  }
  return profile[section];
}

interface Built {
  /** The section's new raw value, or undefined to leave the key out of the file. */
  value: unknown;
  issues: string[];
}

function buildSection(
  section: ProfileSection,
  input: SectionInputs[ProfileSection],
  stored: Profile,
  raw: Record<string, unknown>,
): Built {
  const rawSection = raw[section];
  switch (section) {
    case 'contact': {
      const v = input as SectionInputs['contact'];
      return { value: ordered(rawSection, { ...v }), issues: [] };
    }
    case 'links': {
      const v = input as SectionInputs['links'];
      const rawLinks = isRecord(rawSection) ? rawSection : {};
      const links = ordered(rawSection, {
        linkedin: optional(v.linkedin, rawLinks.linkedin),
        github: optional(v.github, rawLinks.github),
        portfolio: optional(v.portfolio, rawLinks.portfolio),
      });
      return { value: rawSection === undefined && isEmpty(links) ? undefined : links, issues: [] };
    }
    case 'summary':
      return { value: input as SectionInputs['summary'], issues: [] };
    case 'skills': {
      const rows = input as SectionInputs['skills'];
      const issues: string[] = [];
      const entries = keyedEntries(
        rows.map((r) => ({ key: r.group, value: r.items })),
        'skills',
        'group',
        'skill group',
        issues,
      );
      return { value: ordered(rawSection, Object.fromEntries(entries)), issues };
    }
    case 'experience':
      return buildExperience(input as SectionInputs['experience'], stored, rawSection);
    case 'education':
      return buildEducation(input as SectionInputs['education'], stored, rawSection);
    case 'standard_answers': {
      const issues: string[] = [];
      const entries = keyedEntries(
        input as SectionInputs['standard_answers'],
        'standard_answers',
        'key',
        'answer',
        issues,
      );
      const answers = ordered(rawSection, Object.fromEntries(entries));
      return { value: rawSection === undefined && isEmpty(answers) ? undefined : answers, issues };
    }
    case 'self_identification':
      return buildSelfId(input as SectionInputs['self_identification'], rawSection);
  }
}

function buildExperience(
  rows: SectionInputs['experience'],
  stored: Profile,
  rawSection: unknown,
): Built {
  const rawEntries = recordsOf(rawSection);
  const rawById = new Map(rawEntries.map((e) => [e.id, e]));
  const rawBullets = new Map(rawEntries.flatMap((e) => recordsOf(e.bullets)).map((b) => [b.id, b]));

  const entryIds = new Set(rows.map((r) => r.id?.trim()).filter(isNonEmpty));
  const bulletIds = new Set([
    ...stored.experience.flatMap((e) => e.bullets.map((b) => b.id)),
    ...stored.projects.flatMap((p) => p.bullets.map((b) => b.id)),
    ...rows.flatMap((r) => r.bullets.map((b) => b.id?.trim())).filter(isNonEmpty),
  ]);

  const value = rows.map((row) => {
    const id = row.id?.trim() || freeSlug(row.company || row.title, 'role', entryIds);
    const rawEntry = rawById.get(id);
    const bullets = row.bullets.map((bullet) => {
      const bulletId = bullet.id?.trim() || nextBulletId(id, bulletIds);
      const rawBullet = rawBullets.get(bulletId);
      return ordered(rawBullet, {
        id: bulletId,
        text: bullet.text,
        sources: rawBullet?.sources,
      });
    });
    return ordered(rawEntry, {
      id,
      company: row.company,
      title: row.title,
      start: row.start,
      end: row.end,
      location: optional(row.location, rawEntry?.location),
      bullets: bullets.length === 0 && rawEntry?.bullets === undefined ? undefined : bullets,
    });
  });
  return { value, issues: [] };
}

function buildEducation(
  rows: SectionInputs['education'],
  stored: Profile,
  rawSection: unknown,
): Built {
  const rawById = new Map(recordsOf(rawSection).map((e) => [e.id, e]));
  const ids = new Set([
    ...stored.education.map((e) => e.id),
    ...rows.map((r) => r.id?.trim()).filter(isNonEmpty),
  ]);
  const value = rows.map((row) => {
    const id = row.id?.trim() || freeSlug(row.school, 'school', ids);
    const rawEntry = rawById.get(id);
    return ordered(rawEntry, {
      id,
      school: row.school,
      credential: optional(row.credential, rawEntry?.credential),
      start: optional(row.start, rawEntry?.start),
      end: optional(row.end, rawEntry?.end),
    });
  });
  return { value, issues: [] };
}

function buildSelfId(input: SectionInputs['self_identification'], rawSection: unknown): Built {
  const issues: string[] = [];
  const rawSelf = isRecord(rawSection) ? rawSection : undefined;
  const overrides = Object.fromEntries(
    keyedEntries(input.overrides, 'self_identification.overrides', 'key', 'override', issues),
  );
  const fields: Record<string, unknown> = {};
  for (const key of SELF_ID_KEYS) {
    const v = input[key];
    // A key the file leaves out reads as decline; leaving it out again keeps the file as it was.
    fields[key] = rawSelf && rawSelf[key] === undefined && v === DECLINE ? undefined : v;
  }
  const self = ordered(rawSection, {
    ...fields,
    overrides: isEmpty(overrides) && rawSelf?.overrides === undefined ? undefined : overrides,
  });
  const allDecline = SELF_ID_KEYS.every((k) => input[k] === DECLINE) && isEmpty(overrides);
  return { value: rawSection === undefined && allDecline ? undefined : self, issues };
}

/**
 * Rows of `{ key, value }` as map entries, in order. Keys are trimmed; values are kept exactly
 * as typed. A blank or repeated key is an issue at `<path>.<row>.<field>`, worded without the value.
 */
function keyedEntries<V>(
  rows: { key: string; value: V }[],
  path: string,
  field: string,
  noun: string,
  issues: string[],
): [string, V][] {
  const seen = new Map<string, number>();
  const out: [string, V][] = [];
  rows.forEach((row, i) => {
    const key = row.key.trim();
    if (key === '') {
      issues.push(`${path}.${i}.${field}: give this ${noun} a name`);
      return;
    }
    const first = seen.get(key);
    if (first !== undefined) {
      issues.push(
        `${path}.${i}.${field}: the same name as ${noun} ${first + 1}. Names must be unique`,
      );
      return;
    }
    seen.set(key, i);
    out.push([key, row.value]);
  });
  return out;
}

/**
 * `value` with undefined keys dropped, its keys in the order `rawObject` had them, and keys
 * `rawObject` didn't have after those, in `value`'s order.
 */
function ordered(rawObject: unknown, value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const rawKeys = isRecord(rawObject) ? Object.keys(rawObject) : [];
  for (const key of [...rawKeys, ...Object.keys(value)]) {
    if (key in out || !(key in value) || value[key] === undefined) continue;
    out[key] = value[key];
  }
  return out;
}

/** An optional field: left out when blank, unless the file already had it blank. */
function optional(value: string, rawValue: unknown): string | undefined {
  if (value !== '') return value;
  return rawValue === '' ? '' : undefined;
}

/** `<base>-<n>` with the next number above every id already using that prefix. */
function nextBulletId(base: string, taken: Set<string>): string {
  const prefix = `${base}-`;
  let max = 0;
  for (const id of taken) {
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  const id = `${prefix}${max + 1}`;
  taken.add(id);
  return id;
}

/** A lowercase slug of `name`, with `-2`, `-3`… when it's taken. */
function freeSlug(name: string, fallback: string, taken: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || fallback;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

function recordsOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEmpty(value: Record<string, unknown>): boolean {
  return Object.keys(value).length === 0;
}

function isNonEmpty(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}
