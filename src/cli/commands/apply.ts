import { type ApplyResult, runApply } from '../../core/apply/apply.js';
import { BrowserError } from '../../core/apply/browser.js';
import { ApplyError } from '../../core/apply/types.js';
import { ConfigError, loadAllConfig } from '../../core/config/load.js';
import { createDb } from '../../core/db/client.js';
import { runsRepo } from '../../core/db/repo/runs.js';
import { createAnthropicLlm } from '../../core/llm/anthropic.js';
import { LlmError } from '../../core/llm/types.js';
import { systemClock } from '../../core/util/clock.js';
import { createLogger } from '../../core/util/logger.js';

/**
 * `apply <jobId>` — open the job's application form in Kris's Chrome and fill
 * it: profile fields, standard answers, and the form's own questions (drafted by
 * the writing model on the first fill and saved), attach the resume and cover
 * letter, outline drafted answers and unfilled required fields, and print a
 * fill report (FR-8). It never submits. Prep must have been run for the job
 * first. Mirrors `prep`: wrapped in a `fill` run for bookkeeping.
 */
export async function applyCommand(jobIdArg: string): Promise<void> {
  const jobId = Number(jobIdArg);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    console.error('apply FAILED\n\n<jobId> must be a positive integer');
    process.exitCode = 1;
    return;
  }

  let sqlite: ReturnType<typeof createDb>['sqlite'] | undefined;
  try {
    const config = loadAllConfig();
    const opened = createDb();
    sqlite = opened.sqlite;
    const runs = runsRepo(opened.db, systemClock);
    const runId = runs.start('fill');
    let llm: ReturnType<typeof createAnthropicLlm> | undefined;
    try {
      llm = createAnthropicLlm();
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
      console.log(`note: ${err.message} — the form's own questions will be left for you.`);
    }
    try {
      const result = await runApply(
        {
          db: opened.db,
          clock: systemClock,
          log: createLogger(),
          profile: config.profile,
          llm,
          criteria: config.criteria,
          preferences: config.preferences,
        },
        { jobId },
      );
      runs.finish(runId, {
        ok: true,
        stats: {
          jobId,
          applicationId: result.applicationId,
          fallback: result.fallback,
          filled: result.report?.filled.length ?? 0,
          unfilled: result.report?.unfilled.length ?? 0,
          skipped_eeo: result.report?.skipped_eeo.length ?? 0,
        },
      });
      console.log(formatApplySummary(runId, result));
    } catch (err) {
      runs.finish(runId, { ok: false, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  } catch (err) {
    if (err instanceof ConfigError || err instanceof ApplyError || err instanceof BrowserError) {
      console.error(`apply FAILED\n\n${err.message}`);
      process.exitCode = 1;
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (/no such table/i.test(message)) {
      console.error(`${message}\nDatabase is not migrated. Run \`pnpm cli db:migrate\` first.`);
      process.exitCode = 1;
      return;
    }
    throw err;
  } finally {
    sqlite?.close();
  }
}

function formatApplySummary(runId: number, r: ApplyResult): string {
  if (r.fallback) {
    const lines = [
      `apply run ${runId}: fallback (no fillable fields on this ${r.ats} page)`,
      `  ${r.title} @ ${r.company} (application ${r.applicationId})`,
      `  open this URL and apply manually: ${r.applyUrl}`,
      '  prepared answers to copy-paste:',
    ];
    for (const a of r.answers ?? []) lines.push(`    - ${a.label}: ${a.value}`);
    lines.push('  (nothing was submitted)');
    return lines.join('\n');
  }

  const report = r.report;
  if (!report) return `apply run ${runId}: ok (no report)`;

  const lines = [
    `apply run ${runId}: ok — form filled, NOT submitted`,
    `  ${r.title} @ ${r.company} (application ${r.applicationId}, ${report.ats})`,
    `  url: ${report.url}`,
    `  resume attached: ${report.resumeAttached ? 'yes' : 'no'}`,
    `  filled (${report.filled.length}):`,
  ];
  for (const f of report.filled) {
    const review = f.via === 'draft' ? '  (drafted — review it, outlined in amber)' : '';
    lines.push(
      `    - ${f.field}  [${f.via}:${f.via === 'draft' ? 'form question' : f.source}]${review}`,
    );
  }
  lines.push(`  unfilled (${report.unfilled.length}):`);
  for (const u of report.unfilled) {
    const why = u.reason ? ` — ${u.reason}` : '';
    lines.push(`    - ${u.field}${u.required ? ' (required, outlined in red)' : ''}${why}`);
  }
  lines.push(
    `  self-identification filled from profile.yaml (${report.self_identification.length}):`,
  );
  for (const s of report.self_identification) lines.push(`    - ${s.field}: ${s.value}`);
  lines.push(
    `  self-identification left blank (${report.skipped_eeo.length}, no configured answer or decline option — needs you):`,
  );
  for (const s of report.skipped_eeo) lines.push(`    - ${s}`);
  lines.push('  Review the form in Chrome and click submit yourself.');
  return lines.join('\n');
}
