import type { Db } from '../db/client.js';
import { applicationsRepo } from '../db/repo/applications.js';
import { eventsRepo } from '../db/repo/events.js';
import { aggregatorFor } from '../sources/aggregators.js';
import type { Clock } from '../util/clock.js';
import { urlHost } from '../util/host.js';

/**
 * The employer's own application link, set by Kris on one application (J29,
 * D187). Open & fill opens it ahead of the job's apply URL. JobHacker never
 * requests it: it is only opened in his Chrome. It is not fed to harvest or
 * companies.yaml.
 */

export const APPLY_LINK_MAX_CHARS = 2_000;
export const JOB_BOARD_REFUSAL =
  "That's a job board too. Paste the employer's own application link.";

export type ApplyLinkFrom = 'pasted' | 'option';

export type SetApplyLinkResult =
  | { ok: true; applyUrl: string | null; changed: boolean }
  | { ok: false; error: string };

/** Why a link can't be the employer's link, or null when it can. */
export function applyLinkError(value: string): string | null {
  if (value.length > APPLY_LINK_MAX_CHARS) {
    return `That link is longer than ${APPLY_LINK_MAX_CHARS.toLocaleString('en-US')} characters.`;
  }
  const host = urlHost(value);
  if (!host) return 'Paste a link that starts with https:// or http://.';
  if (aggregatorFor(host)) return JOB_BOARD_REFUSAL;
  return null;
}

/**
 * Set or clear (`null` or blank) the link. A refused link changes nothing.
 * Each change appends one `apply_link` event with the host and where it came from.
 */
export function setApplyLink(
  db: Db,
  clock: Clock,
  applicationId: number,
  value: string | null,
  from: ApplyLinkFrom = 'pasted',
): SetApplyLinkResult {
  const apps = applicationsRepo(db, clock);
  const app = apps.get(applicationId);
  if (!app) return { ok: false, error: `No application ${applicationId}.` };

  const trimmed = value?.trim() ?? '';
  const next = trimmed === '' ? null : trimmed;
  if (next !== null) {
    const error = applyLinkError(next);
    if (error) return { ok: false, error };
  }
  if (next === app.applyUrl) return { ok: true, applyUrl: next, changed: false };

  apps.upsertForJob({ jobId: app.jobId, applyUrl: next });
  const host = next ? urlHost(next) : app.applyUrl ? urlHost(app.applyUrl) : null;
  eventsRepo(db, clock).append({
    type: 'apply_link',
    jobId: app.jobId,
    applicationId: app.id,
    payload: { host, from: next === null ? 'cleared' : from },
  });
  return { ok: true, applyUrl: next, changed: true };
}
