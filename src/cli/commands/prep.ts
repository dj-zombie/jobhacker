import { ConfigError, loadAllConfig } from '../../core/config/load.js';
import { createDb } from '../../core/db/client.js';
import { runsRepo } from '../../core/db/repo/runs.js';
import { createAnthropicLlm } from '../../core/llm/anthropic.js';
import { LlmError } from '../../core/llm/types.js';
import { PrepError, type PrepResult, runPrep } from '../../core/prep/prep.js';
import { systemClock } from '../../core/util/clock.js';
import { createLogger } from '../../core/util/logger.js';

/**
 * `prep <jobId>` — generate tailored resume (HTML + PDF), a cover note, and the
 * standard answers for one shortlisted job, grounded in the profile (FR-7).
 * Wrapped in a `prep` run for bookkeeping, mirroring `score`.
 */
export async function prepCommand(jobIdArg: string): Promise<void> {
  const jobId = Number(jobIdArg);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    console.error('prep FAILED\n\n<jobId> must be a positive integer');
    process.exitCode = 1;
    return;
  }

  let sqlite: ReturnType<typeof createDb>['sqlite'] | undefined;
  try {
    const config = loadAllConfig();
    const llm = createAnthropicLlm();
    const opened = createDb();
    sqlite = opened.sqlite;
    const runs = runsRepo(opened.db, systemClock);
    const runId = runs.start('prep');
    try {
      const result = await runPrep(
        {
          db: opened.db,
          llm,
          clock: systemClock,
          log: createLogger(),
          criteria: config.criteria,
          profile: config.profile,
          preferences: config.preferences,
        },
        { jobId },
      );
      runs.finish(runId, { ok: true, stats: { jobId, applicationId: result.applicationId } });
      console.log(formatPrepSummary(runId, result));
    } catch (err) {
      runs.finish(runId, { ok: false, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  } catch (err) {
    if (err instanceof ConfigError || err instanceof LlmError || err instanceof PrepError) {
      console.error(`prep FAILED\n\n${err.message}`);
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

function formatPrepSummary(runId: number, r: PrepResult): string {
  const tokens = r.usage.inputTokens + r.usage.outputTokens;
  const lines = [
    `prep run ${runId}: ok`,
    `  job ${r.jobId}: ${r.title} @ ${r.company} (application ${r.applicationId})`,
    `  resume: ${r.htmlPath}`,
    `  resume PDF: ${r.pdfPath ?? '(skipped)'}`,
    `  bullets: ${r.bullets.length} (${r.fellBack} fell back to source)`,
    `  cover note: ${r.coverNoteGrounded ? 'grounded' : 'fell back to safe note'}`,
    `  tokens: ${r.usage.inputTokens} in + ${r.usage.outputTokens} out = ${tokens}`,
  ];
  if (r.needsInput.length > 0) {
    lines.push('  NEEDS INPUT:');
    for (const marker of r.needsInput) lines.push(`    - ${marker}`);
  } else {
    lines.push('  NEEDS INPUT: none');
  }
  return lines.join('\n');
}
