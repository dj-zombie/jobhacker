import { createDb } from '../../../core/db/client.js';
import { applicationsToCsv, listApplications } from '../../../core/pipeline/tracker.js';
import { systemClock } from '../../../core/util/clock.js';

export const dynamic = 'force-dynamic';

/**
 * CSV export of the application tracker (FR-9). A GET download so the browser's
 * "Export CSV" link saves a file. Reads the DB server-side only.
 */
export function GET(): Response {
  const { db, sqlite } = createDb();
  try {
    const csv = applicationsToCsv(listApplications(db, systemClock));
    const stamp = systemClock.now().slice(0, 10);
    return new Response(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="jobhacker-applications-${stamp}.csv"`,
      },
    });
  } finally {
    sqlite.close();
  }
}
