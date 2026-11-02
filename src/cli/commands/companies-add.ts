import { ConfigError } from '../../core/config/load.js';
import { AddCompanyError, addCompany } from '../../core/sources/add-company.js';
import { createHttp } from '../../core/util/http.js';

/** `companies:add <url>` — detect the ATS, verify the board, append companies.yaml. */
export async function companiesAdd(url: string, options: { name?: string }): Promise<void> {
  try {
    const result = await addCompany({ url, http: createHttp(), name: options.name });
    const label = `${result.company.name} (${result.company.ats}/${result.company.token})`;
    if (result.already) {
      console.log(`${label} is already in ${result.file}`);
      return;
    }
    console.log(`added ${label} to ${result.file}`);
  } catch (err) {
    if (err instanceof AddCompanyError || err instanceof ConfigError) {
      console.error(err.message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}
