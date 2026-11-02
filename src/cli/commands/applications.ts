import { writeFileSync } from 'node:fs';
import { createDb } from '../../core/db/client.js';
import type { ApplicationListRow } from '../../core/db/repo/applications.js';
import {
  TrackerError,
  applicationsToCsv,
  changeApplicationStatus,
  followUpsDue,
  listApplications,
} from '../../core/pipeline/tracker.js';
import { systemClock } from '../../core/util/clock.js';

/**
 * Tracker CLI (FR-9). `applications:list` / `:due` print the pipeline, `:status`
 * moves an application, and `:export` writes the whole list as CSV (to a file or
 * stdout). These are DB-only; no browser, no network.
 */

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return iso.slice(0, 10);
}

function printRows(rows: ApplicationListRow[]): void {
  if (rows.length === 0) {
    console.log('  (none)');
    return;
  }
  for (const r of rows) {
    const bits = [`#${r.jobId}`, r.status.padEnd(12), r.company, '—', r.title];
    console.log(`  ${bits.join('  ')}`);
    const meta = [`submitted ${fmtDate(r.submittedAt)}`, `follow-up ${fmtDate(r.followUpAt)}`];
    console.log(`      ${meta.join(' · ')}`);
  }
}

/** `applications:list` — every application, newest-updated first. */
export function applicationsList(): void {
  const { db, sqlite } = createDb();
  try {
    const rows = listApplications(db, systemClock);
    console.log(`applications: ${rows.length}`);
    printRows(rows);
  } finally {
    sqlite.close();
  }
}

/** `applications:due` — applications whose follow-up is due now (non-terminal). */
export function applicationsDue(): void {
  const { db, sqlite } = createDb();
  try {
    const rows = followUpsDue(db, systemClock);
    console.log(`follow-ups due: ${rows.length}`);
    printRows(rows);
  } finally {
    sqlite.close();
  }
}

/** `applications:status <jobId> <status>` — move an application's status. */
export function applicationsStatus(jobIdArg: string, status: string): void {
  const jobId = Number(jobIdArg);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    console.error('applications:status FAILED\n\n<jobId> must be a positive integer');
    process.exitCode = 1;
    return;
  }
  const { db, sqlite } = createDb();
  try {
    const result = changeApplicationStatus(db, systemClock, { jobId, status });
    const followUpLine = result.followUpAt ? `\n  follow-up: ${fmtDate(result.followUpAt)}` : '';
    console.log(
      `application ${result.applicationId} (job ${jobId}): ${result.from} → ${result.to}${followUpLine}`,
    );
  } catch (err) {
    if (err instanceof TrackerError) {
      console.error(`applications:status FAILED\n\n${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  } finally {
    sqlite.close();
  }
}

/** `applications:export [file]` — write all applications as CSV (file or stdout). */
export function applicationsExport(file?: string): void {
  const { db, sqlite } = createDb();
  try {
    const csv = applicationsToCsv(listApplications(db, systemClock));
    if (file) {
      writeFileSync(file, csv, 'utf8');
      console.log(`wrote ${file}`);
    } else {
      process.stdout.write(csv);
    }
  } finally {
    sqlite.close();
  }
}
