import type BetterSqlite3 from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import type { Clock } from '../util/clock.js';
import { backupDatabase } from './backup.js';
import type { Db } from './client.js';
import { companies, jobScores, jobs, runs } from './schema.js';

/**
 * Loaded on use, not at import. A static import of the score-run module from here
 * cycles through the server actions and the page fails to render.
 */
async function liveRun(): Promise<
  Pick<typeof import('../pipeline/score-run.js'), 'liveScoringRun' | 'ScoreBusyError'>
> {
  return import('../pipeline/score-run.js');
}

/**
 * What a reset would change, read from the database. The CLI and the dialog both
 * show this, so the numbers cannot drift (J14).
 */
export interface ResetPlan {
  jobs: number;
  jobsWithApplication: number;
  jobsWithoutApplication: number;
  jobScores: number;
  applications: number;
  companyDomains: number;
  sourceUsage: number;
  /** Search companies (`hn`, `jsearch`, `jobspipe`) that would have no jobs left. */
  companiesRemoved: number;
  runs: number;
  /** Events whose job would be deleted, so the row cascades with it. */
  eventsRemoved: number;
}

const PLAN_LINES: [string, (plan: ResetPlan) => number][] = [
  ['jobs', (plan) => plan.jobs],
  ['with an application', (plan) => plan.jobsWithApplication],
  ['without an application', (plan) => plan.jobsWithoutApplication],
  ['scores', (plan) => plan.jobScores],
  ['applications', (plan) => plan.applications],
  ['company logos', (plan) => plan.companyDomains],
  ['source budget rows', (plan) => plan.sourceUsage],
  ['search companies removed', (plan) => plan.companiesRemoved],
  ['runs', (plan) => plan.runs],
  ['events removed', (plan) => plan.eventsRemoved],
];

/** The same lines the CLI prints and the dialog lists. */
export function formatResetPlan(plan: ResetPlan): string {
  const width = Math.max(...PLAN_LINES.map(([label]) => label.length));
  return PLAN_LINES.map(([label, value]) => `  ${label.padEnd(width)}  ${value(plan)}`).join('\n');
}

function one(db: Db, query: ReturnType<typeof sql>): number {
  const rows = db.all<{ n: number }>(query);
  return Number(rows[0]?.n ?? 0);
}

/** Read the plan. Writes nothing. */
export function planReset(db: Db): ResetPlan {
  const jobsN = one(db, sql`select count(*) as n from jobs`);
  const withApplication = one(
    db,
    sql`select count(*) as n from jobs j inner join applications a on a.job_id = j.id`,
  );
  return {
    jobs: jobsN,
    jobsWithApplication: withApplication,
    jobsWithoutApplication: jobsN - withApplication,
    jobScores: one(db, sql`select count(*) as n from job_scores`),
    applications: one(db, sql`select count(*) as n from applications`),
    companyDomains: one(db, sql`select count(*) as n from company_domains`),
    sourceUsage: one(db, sql`select count(*) as n from source_usage`),
    companiesRemoved: one(
      db,
      sql`select count(*) as n from companies c
          where c.ats in ('hn', 'jsearch', 'jobspipe')
          and not exists (
            select 1 from jobs j
            inner join applications a on a.job_id = j.id
            where j.company_id = c.id
          )`,
    ),
    runs: one(db, sql`select count(*) as n from runs`),
    eventsRemoved: one(
      db,
      sql`select count(*) as n from events e
          where exists (
            select 1 from jobs j
            where j.id = e.job_id
            and not exists (select 1 from applications a where a.job_id = j.id)
          )`,
    ),
  };
}

/** Refuse while a scout or a score run is live, the same rule as `startScoutRun`. */
export async function assertResetIdle(db: Db, clock: Clock): Promise<void> {
  const { liveScoringRun, ScoreBusyError } = await liveRun();
  const live = liveScoringRun(db, clock);
  if (live) throw new ScoreBusyError(live.kind);
}

export interface ResetResult {
  before: ResetPlan;
  after: ResetPlan;
  backupPath: string;
}

/**
 * Back up, then apply `planReset`. Refuses before the backup and before any
 * row changes while a scout or score run is live.
 *
 * Deletes jobs that have no application (never a blanket delete: applications
 * cascade with their job). Clears every score. A kept automated job becomes
 * unscored and pending; a human status stays. Search companies with no jobs
 * left go; board companies stay. Every run goes, so the scout card does not
 * describe a queue that is gone. `company_domains`, `source_usage` and
 * applications stay.
 */
export async function applyReset(options: {
  db: Db;
  sqlite: BetterSqlite3.Database;
  destDir: string;
  clock: Clock;
}): Promise<ResetResult> {
  const { db, sqlite, destDir, clock } = options;
  const { liveScoringRun, ScoreBusyError } = await liveRun();
  const refuse = () => {
    const live = liveScoringRun(db, clock);
    if (live) throw new ScoreBusyError(live.kind);
  };
  refuse();
  const before = planReset(db);
  const { path } = await backupDatabase({ sqlite, destDir, clock });
  const write = db.$client.transaction(() => {
    refuse();
    db.delete(jobScores).run();
    db.update(jobs)
      .set({ status: 'unscored', scoreState: 'pending' })
      .where(sql`${jobs.status} in ('new', 'filtered_out', 'unscored', 'scored')`)
      .run();
    db.delete(jobs)
      .where(sql`not exists (select 1 from applications where applications.job_id = ${jobs.id})`)
      .run();
    db.delete(companies)
      .where(
        sql`${companies.ats} in ('hn', 'jsearch', 'jobspipe')
            and not exists (select 1 from jobs where jobs.company_id = ${companies.id})`,
      )
      .run();
    db.delete(runs).run();
  });
  write.immediate();
  return { before, after: planReset(db), backupPath: path };
}
