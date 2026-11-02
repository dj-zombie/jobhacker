import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSeq, parseDocument } from 'yaml';
import { ConfigError, loadConfigFile } from './load.js';
import { type CompanyConfig, companiesSchema } from './schemas.js';

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
    const duplicate = current.companies.some(
      (entry) => entry.ats === company.ats && entry.token === company.token,
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
