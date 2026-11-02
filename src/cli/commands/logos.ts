import { findEveryDomain } from '../../core/brand/apply.js';
import {
  type LogoCounts,
  allCompanyKeys,
  countDomains,
  logoSetKeys,
} from '../../core/brand/logo-set.js';
import { loadAllConfig } from '../../core/config/load.js';
import { createDb, migrateDb, openDbReadonly } from '../../core/db/client.js';
import { domainsRepo } from '../../core/db/repo/domains.js';
import { systemClock } from '../../core/util/clock.js';
import { reportCliError } from '../errors.js';

function line(label: string, counts: LogoCounts): string {
  return [
    `  ${label}`,
    `    confirmed ${counts.confirmed}`,
    `    found ${counts.found}`,
    `    none ${counts.none}`,
    `    no domain yet ${counts.noDomainYet}`,
  ].join('\n');
}

/** `logos` — domain counts. `--find` runs the finder over every company. */
export function logosCommand(opts: { find?: boolean }): void {
  const opened = opts.find ? createDb() : openDbReadonly();
  try {
    if (opts.find) migrateDb(opened.db);
    const repo = domainsRepo(opened.db, systemClock);
    if (opts.find) {
      const before = repo.count();
      console.log(`company_domains before  ${before}`);
      const wrote = findEveryDomain(opened.db, systemClock);
      const after = repo.count();
      console.log(
        `company_domains after   ${after} (${wrote.written} written, ${wrote.cleared} cleared, ${wrote.kept} kept, ${wrote.ms}ms)`,
      );
    }
    const config = loadAllConfig();
    const records = repo.all();
    const set = countDomains(logoSetKeys(opened.db, systemClock, config.criteria), records);
    const all = countDomains(allCompanyKeys(opened.db), records);
    console.log(line(`logo set (${set.total} companies)`, set));
    console.log(line(`all companies (${all.total})`, all));
  } catch (err) {
    reportCliError('logos', err);
  } finally {
    opened.sqlite.close();
  }
}
