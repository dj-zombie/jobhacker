import { appendCompany } from '../config/companies-file.js';
import { DEFAULT_CONFIG_DIR } from '../config/load.js';
import type { CompanyConfig } from '../config/schemas.js';
import type { Http } from '../util/http.js';
import { DetectError, detectBoard, humanizeToken } from './detect.js';
import { loadBoard } from './registry.js';

/**
 * `companies:add` (FR-2). Detect the board from the careers URL, confirm the
 * public JSON endpoint responds with a payload we can parse, and append it.
 */

export class AddCompanyError extends Error {
  override readonly name = 'AddCompanyError';
}

export interface AddCompanyResult {
  company: CompanyConfig;
  already: boolean;
  file: string;
}

export async function addCompany(options: {
  url: string;
  http: Http;
  dir?: string;
  name?: string;
}): Promise<AddCompanyResult> {
  let detected: { ats: CompanyConfig['ats']; token: string };
  try {
    detected = detectBoard(options.url);
  } catch (err) {
    if (err instanceof DetectError) throw new AddCompanyError(err.message);
    throw err;
  }

  const adapter = loadBoard(detected.ats);
  if (!adapter) {
    throw new AddCompanyError(`no board adapter for ${detected.ats}`);
  }
  let raw: unknown;
  try {
    raw = await adapter.fetchBoard(detected.token, options.http);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AddCompanyError(
      `${detected.ats} board "${detected.token}" did not respond: ${message}`,
    );
  }

  try {
    adapter.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AddCompanyError(
      `${detected.ats} board "${detected.token}" returned an unexpected payload: ${message}`,
    );
  }

  const override = options.name?.trim();
  const company: CompanyConfig = {
    name: override || adapter.companyName(raw) || humanizeToken(detected.token),
    ats: detected.ats,
    token: detected.token,
    active: true,
    tags: [],
  };
  const written = appendCompany(options.dir ?? DEFAULT_CONFIG_DIR, company);
  return { company, already: written.already, file: written.file };
}
