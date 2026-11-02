import { Command } from 'commander';
import { loadEnv } from '../core/util/env.js';
import { ensureDailyLogPath, pruneOldLogs } from '../core/util/logs.js';
import {
  applicationsDue,
  applicationsExport,
  applicationsList,
  applicationsStatus,
} from './commands/applications.js';
import { applyCommand } from './commands/apply.js';
import { backupCommand } from './commands/backup.js';
import { boardsDiscover } from './commands/boards-discover.js';
import { chromeCommand } from './commands/chrome.js';
import { companiesAdd } from './commands/companies-add.js';
import { configCheck } from './commands/config-check.js';
import { configMigrateCommand } from './commands/config-migrate.js';
import { dbInfo, dbMigrate } from './commands/db.js';
import { funnelCommand } from './commands/funnel.js';
import { logosCommand } from './commands/logos.js';
import { placesReclassifyCommand } from './commands/places.js';
import { prepCommand } from './commands/prep.js';
import { profileBuildCommand, profileCheckCommand } from './commands/profile.js';
import { rankCommand } from './commands/rank.js';
import { scoreCommand } from './commands/score.js';
import { scoutCommand } from './commands/scout.js';
import { statsCommand } from './commands/stats.js';
import { whyCommand } from './commands/why.js';

// Load `.env` so a key that lives only there is picked up (Known issue [2]), and
// route logs to a daily file in data/logs with 14-day rotation (FR-10) so
// scheduled runs leave an inspectable log. The real environment always wins.
loadEnv();
if (!process.env.JOBHACKER_LOG_FILE) {
  try {
    process.env.JOBHACKER_LOG_FILE = ensureDailyLogPath();
    pruneOldLogs();
  } catch {
    // Logging to a file is best-effort; fall back to stdout-only.
  }
}

const program = new Command();

program
  .name('jobhacker')
  .description('JobHacker: a local-first job-search assistant')
  .version('0.0.1');

program
  .command('config:check')
  .description('validate config/*.yaml and preferences.md, then exit')
  .action(configCheck);

program
  .command('config:migrate')
  .description('convert a v1 keyword criteria.yaml to v2 and draft preferences.md from it')
  .option('--force', 'overwrite an existing preferences.md')
  .action(configMigrateCommand);

program.command('db:migrate').description('apply pending database migrations').action(dbMigrate);

program.command('db:info').description('print table row counts').action(dbInfo);

program
  .command('companies:add')
  .description('detect an ATS careers URL, verify the board, and append it to companies.yaml')
  .argument('<url>', 'careers page URL')
  .option('-n, --name <name>', 'company name (default: the board name, or the token)')
  .action(companiesAdd);

program
  .command('boards:discover')
  .description('slug-probe seed companies against the enabled ATS boards and append hits')
  .requiredOption('--seed <file>', 'newline-delimited company names or ats/token lines')
  .action(boardsDiscover);

program
  .command('scout')
  .description('fetch active boards, upsert jobs, gate, prescore, and score')
  .option('--no-score', 'skip LLM scoring (discovery, gates and prescore only)')
  .action(scoutCommand);

program
  .command('score')
  .description('gate, prescore and LLM-score jobs already in the database (no board fetch)')
  .option('-l, --limit <n>', 'cap the number of new scores this run (0 = no LLM calls)')
  .action(scoreCommand);

program
  .command('funnel')
  .description('show where every job is: gated, scored by band, or not scored yet')
  .action(funnelCommand);

program
  .command('places:reclassify')
  .description("classify every job's places (Portland, Phoenix, Remote) and print counts per area")
  .action(placesReclassifyCommand);

program
  .command('stats')
  .description('print the usefulness snapshot (read-only: no network, model or Chrome)')
  .action(statsCommand);

program
  .command('logos')
  .description('company domain counts for the logo set and for every company')
  .option('--find', 'run the domain finder over every company and update found rows')
  .action(logosCommand);

program
  .command('rank')
  .alias('jobs:top')
  .description('print the ranked list with the current weights (no LLM calls)')
  .option('-n, --n <n>', 'how many rows to show', '30')
  .option('--verdict <verdict>', 'only strong, maybe, or no')
  .option(
    '--where <areas>',
    'comma-separated places (portland,phoenix,remote) or anywhere; defaults to where_default',
  )
  .action(rankCommand);

program
  .command('why')
  .description('explain one job: gate, prescore, and each dimension with weight and reason')
  .argument('<jobId>', 'job id')
  .action(whyCommand);

program
  .command('prep')
  .description('generate tailored resume, cover note, and answers for one shortlisted job')
  .argument('<jobId>', 'job id to prep')
  .action(prepCommand);

program
  .command('profile:build')
  .description('build a sourced draft profile locally from input/resume.* and input/linkedin/')
  .option('--input-dir <dir>', 'private input directory', 'input')
  .option('--config-dir <dir>', 'config output directory', 'config')
  .option('--resume <file>', 'resume PDF or DOCX (default: input/resume.pdf or .docx)')
  .option('--linkedin <dir>', 'unzipped LinkedIn archive directory')
  .option('--force', 'overwrite an existing profile draft and source report')
  .action(profileBuildCommand);

program
  .command('profile:check')
  .description('check a draft profile for sourced bullets, conflicts, and NEEDS INPUT markers')
  .option('--profile <file>', 'draft/adopted profile to check', 'config/profile.draft.yaml')
  .option(
    '--sources <file>',
    'source report generated by profile:build',
    'config/profile.draft.sources.yaml',
  )
  .action(profileCheckCommand);

program
  .command('chrome')
  .description('launch the dedicated Chrome profile with remote debugging for apply-assist')
  .action(chromeCommand);

program
  .command('apply')
  .description('open a job application form in Chrome and fill it (never submits)')
  .argument('<jobId>', 'job id to fill the application for')
  .action(applyCommand);

program
  .command('applications:list')
  .description('list every application with its status and follow-up date')
  .action(applicationsList);

program
  .command('applications:due')
  .description('list applications whose follow-up is due now')
  .action(applicationsDue);

program
  .command('applications:status')
  .description(
    'change an application status (prepped|submitted|interviewing|offer|rejected|withdrawn|ghosted)',
  )
  .argument('<jobId>', 'job id of the application')
  .argument('<status>', 'the new status')
  .action(applicationsStatus);

program
  .command('applications:export')
  .description('export all applications as CSV (to a file, or stdout if omitted)')
  .argument('[file]', 'output CSV path')
  .action(applicationsExport);

program
  .command('backup')
  .description('copy the database to a timestamped file under data/backups/')
  .action(backupCommand);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
