import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSeq, parseDocument } from 'yaml';
import type { Db } from '../db/client.js';
import { companiesRepo } from '../db/repo/companies.js';
import { runsRepo } from '../db/repo/runs.js';
import type { Clock } from '../util/clock.js';
import { ConfigError, loadConfigFile } from './load.js';
import { type Ats, type CompanyConfig, companiesSchema } from './schemas.js';

/**
 * Append one board to `companies.yaml`, preserving comments already in the
 * file. Rewrites nothing when the ats + token is already present.
 * If the rewritten file fails validation, the previous contents are restored.
 */
export function appendCompany(
  dir: string,
  company: CompanyConfig,
): { already: boolean; file: string } {
  const file = join(dir, 'companies.yaml');
  let existed = true;
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    existed = false;
    text = 'companies: []\n';
  }

  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    throw new ConfigError(
      file,
      doc.errors.map((error) => error.message),
    );
  }
  const seq = doc.get('companies');
  if (!isSeq(seq)) {
    throw new ConfigError(file, ['companies: expected a list']);
  }
  // `companies: []` is a flow sequence. Keep added boards in block style.
  seq.flow = false;

  if (existed) {
    const current = loadConfigFile('companies', companiesSchema, dir);
    // Board tokens are case-insensitive on the ATS APIs, so two casings would fetch one board twice.
    const duplicate = current.companies.some(
      (entry) =>
        entry.ats === company.ats && entry.token.toLowerCase() === company.token.toLowerCase(),
    );
    if (duplicate) return { already: true, file };
  }

  seq.add({
    name: company.name,
    ats: company.ats,
    token: company.token,
    active: company.active,
    tags: [...company.tags],
  });

  const next = String(doc);
  writeFileSync(file, next.endsWith('\n') ? next : `${next}\n`);
  try {
    loadConfigFile('companies', companiesSchema, dir);
  } catch (err) {
    if (existed) writeFileSync(file, text);
    else unlinkSync(file);
    throw err;
  }
  return { already: false, file };
}

/**
 * Set `active` on one board in `companies.yaml`.
 * Only that board's `active` line changes, so comments and the other boards stay.
 * Nothing is written when the value is already what was asked, or when the
 * rewritten file would not validate.
 */
export function setCompanyActive(
  dir: string,
  ats: string,
  token: string,
  active: boolean,
): { name: string; changed: boolean } {
  const file = join(dir, 'companies.yaml');
  const current = loadConfigFile('companies', companiesSchema, dir);
  const matches = current.companies.filter((entry) => entry.ats === ats && entry.token === token);
  if (matches.length !== 1) {
    throw new ConfigError(file, [
      matches.length === 0
        ? `no board with ats ${ats} and token ${token}`
        : `more than one board with ats ${ats} and token ${token}`,
    ]);
  }
  const company = matches[0];
  if (!company) throw new ConfigError(file, [`no board with ats ${ats} and token ${token}`]);
  if (company.active === active) return { name: company.name, changed: false };

  const original = readFileSync(file, 'utf8');
  const next = replaceActiveLine(original, ats, token, active);
  if (next == null) {
    throw new ConfigError(file, [
      `could not update active for ${ats}/${token} without rewriting the file`,
    ]);
  }
  writeFileSync(file, next);
  try {
    const loaded = loadConfigFile('companies', companiesSchema, dir);
    const updated = loaded.companies.find((entry) => entry.ats === ats && entry.token === token);
    if (!updated || updated.active !== active) {
      throw new ConfigError(file, ['active did not change']);
    }
    if (loaded.companies.length !== current.companies.length) {
      throw new ConfigError(file, ['the company list changed length']);
    }
    return { name: updated.name, changed: true };
  } catch (err) {
    writeFileSync(file, original);
    throw err;
  }
}

export class MoveError extends Error {
  override readonly name = 'MoveError';
}

export interface MoveResult {
  from: CompanyConfig;
  to: CompanyConfig;
  /** `appended`: a new entry. `reactivated`: listed and off, now on. `listed`: already on. */
  how: 'appended' | 'reactivated' | 'listed';
  file: string;
}

/**
 * Move a board (J15): `to` goes into companies.yaml active, and `from` is set
 * inactive there and on its companies row. Nothing is deleted. Postings that
 * keep their ATS and id follow on the next scout, because `upsert` reassigns
 * `company_id`, with their scores and triage. Refused while a scout is live,
 * like Turn off (D136), because that run would write `from` back.
 */
export function moveBoard(
  deps: { dir: string; db: Db; clock: Clock },
  from: { ats: Ats; token: string },
  to: { ats: Ats; token: string; name: string },
): MoveResult {
  const file = join(deps.dir, 'companies.yaml');
  if (runsRepo(deps.db, deps.clock).liveScout()) {
    throw new MoveError('A scout is running. Move this board after it finishes.');
  }
  const current = loadConfigFile('companies', companiesSchema, deps.dir).companies;
  const source = current.find((entry) => entry.ats === from.ats && entry.token === from.token);
  if (!source) throw new MoveError(`${from.ats}/${from.token} is not in ${file}.`);
  const same = (entry: { ats: string; token: string }) =>
    entry.ats === to.ats && entry.token.toLowerCase() === to.token.toLowerCase();
  if (same(source)) throw new MoveError('That is the board that failed. Nothing changed.');

  const existing = current.find(same);
  let target: CompanyConfig;
  let how: MoveResult['how'];
  if (existing) {
    how = existing.active ? 'listed' : 'reactivated';
    if (!existing.active) setCompanyActive(deps.dir, existing.ats, existing.token, true);
    target = { ...existing, active: true };
  } else {
    target = { name: to.name, ats: to.ats, token: to.token, active: true, tags: [...source.tags] };
    appendCompany(deps.dir, target);
    how = 'appended';
  }

  const retired = setCompanyActive(deps.dir, source.ats, source.token, false);
  try {
    companiesRepo(deps.db, deps.clock).setActive(source.ats, source.token, false);
  } catch (err) {
    if (retired.changed) {
      try {
        setCompanyActive(deps.dir, source.ats, source.token, true);
      } catch {
        // The file already says inactive. The next scout reads that.
      }
    }
    throw err;
  }
  return { from: { ...source, active: false }, to: target, how, file };
}

function replaceActiveLine(
  text: string,
  ats: string,
  token: string,
  active: boolean,
): string | null {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const blocks: { start: number; end: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*-\s+name:/.test(lines[i] ?? '')) {
      const previous = blocks[blocks.length - 1];
      if (previous) previous.end = i;
      blocks.push({ start: i, end: lines.length });
    }
  }
  const hits = blocks.filter((block) => {
    const slice = lines.slice(block.start, block.end);
    return (
      slice.some((line) => fieldEquals(line, 'ats', ats)) &&
      slice.some((line) => fieldEquals(line, 'token', token))
    );
  });
  if (hits.length !== 1) return null;
  const block = hits[0];
  if (!block) return null;
  const activeLine = /^(\s*)active:\s*(true|false)\b(.*)$/;
  for (let i = block.start; i < block.end; i++) {
    const match = activeLine.exec(lines[i] ?? '');
    if (!match) continue;
    lines[i] = `${match[1]}active: ${active}${match[3] ?? ''}`;
    return lines.join(newline);
  }
  return null;
}

function fieldEquals(line: string, key: string, value: string): boolean {
  const match = new RegExp(`^\\s*${key}:\\s*(.+?)\\s*(?:#.*)?$`).exec(line);
  const raw = match?.[1]?.trim();
  if (!raw) return false;
  return raw.replace(/^['"]|['"]$/g, '') === value;
}
