import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Log file naming and rotation (FR-10). Logs are written to one file per day,
 * `data/logs/jobhacker-YYYY-MM-DD.log`. Rotation keeps the most recent N days and
 * deletes older daily files. The functions are pure except for the filesystem
 * read/delete in `pruneOldLogs`, so the naming and the cutoff are unit-testable.
 */

export const DEFAULT_LOG_DIR = process.env.JOBHACKER_LOG_DIR ?? './data/logs';
export const LOG_RETENTION_DAYS = 14;

const LOG_FILE_RE = /^jobhacker-(\d{4}-\d{2}-\d{2})\.log$/;

/** The `YYYY-MM-DD` (UTC) portion of an ISO timestamp. */
export function logDateStamp(iso: string): string {
  return iso.slice(0, 10);
}

/** The daily log file path for `now`, e.g. `data/logs/jobhacker-2026-10-23.log`. */
export function dailyLogPath(dir: string, nowIso: string): string {
  return join(dir, `jobhacker-${logDateStamp(nowIso)}.log`);
}

/** Decide which daily log files to keep vs. delete given a cutoff date (pure). */
export function partitionLogsByAge(
  fileNames: string[],
  keepDays: number,
  nowIso: string,
): { keep: string[]; remove: string[] } {
  const cutoffMs =
    new Date(`${logDateStamp(nowIso)}T00:00:00.000Z`).getTime() - keepDays * 86_400_000;
  const keep: string[] = [];
  const remove: string[] = [];
  for (const name of fileNames) {
    const match = LOG_FILE_RE.exec(name);
    if (!match) continue;
    const fileMs = new Date(`${match[1]}T00:00:00.000Z`).getTime();
    if (fileMs < cutoffMs) remove.push(name);
    else keep.push(name);
  }
  return { keep, remove };
}

/**
 * Delete daily log files older than `keepDays` in `dir`. Returns the names of the
 * files removed. A missing directory is treated as "nothing to prune".
 */
export function pruneOldLogs(
  dir: string = DEFAULT_LOG_DIR,
  keepDays: number = LOG_RETENTION_DAYS,
  nowIso: string = new Date().toISOString(),
): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const { remove } = partitionLogsByAge(entries, keepDays, nowIso);
  for (const name of remove) {
    try {
      const full = join(dir, name);
      if (statSync(full).isFile()) unlinkSync(full);
    } catch {
      // Best effort: a file that vanished or is locked is skipped.
    }
  }
  return remove;
}

/** Ensure the log directory exists and return the daily log path for `now`. */
export function ensureDailyLogPath(
  dir: string = DEFAULT_LOG_DIR,
  nowIso: string = new Date().toISOString(),
): string {
  mkdirSync(dir, { recursive: true });
  return dailyLogPath(dir, nowIso);
}
