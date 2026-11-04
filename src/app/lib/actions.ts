'use server';
import { revalidatePath } from 'next/cache';
import { type PreparedAnswerView, markSubmitted, runApply } from '../../core/apply/apply.js';
import { BrowserError } from '../../core/apply/browser.js';
import { isStandardKey, isUsable } from '../../core/apply/field-map.js';
import { approvalTarget, parseStoredReport } from '../../core/apply/fill-view.js';
import type { FillReport } from '../../core/apply/types.js';
import {
  type LogoChoice,
  type LogoChoiceResult,
  applyLogoChoice,
} from '../../core/brand/choose.js';
import { pickSearchMatch, saveSearchedDomain, searchHitsSchema } from '../../core/brand/search.js';
import { moveBoard, setCompanyActive } from '../../core/config/companies-file.js';
import { saveRanking, saveWeights } from '../../core/config/criteria-file.js';
import { ConfigError, DEFAULT_CONFIG_DIR, loadAllConfig } from '../../core/config/load.js';
import {
  BOARD_ATS,
  type Bands,
  type BoardAts,
  type Criteria,
  type Weights,
} from '../../core/config/schemas.js';
import { DEFAULT_BACKUP_DIR } from '../../core/db/backup.js';
import { createDb, openExistingDb } from '../../core/db/client.js';
import { applicationsRepo } from '../../core/db/repo/applications.js';
import { companiesRepo } from '../../core/db/repo/companies.js';
import { runsRepo } from '../../core/db/repo/runs.js';
import { type ResetPlan, applyReset, planReset } from '../../core/db/reset.js';
import type { JobStatus } from '../../core/db/schema.js';
import { createAnthropicLlm } from '../../core/llm/anthropic.js';
import { LlmError } from '../../core/llm/types.js';
import { areaIds, whereDefault } from '../../core/pipeline/areas.js';
import {
  TRIAGE_ACTIONS,
  type TriageAction,
  triageJob,
  undoTriage,
} from '../../core/pipeline/review.js';
import { ScoreBusyError, runScoreBatch, startScoreRun } from '../../core/pipeline/score-run.js';
import { scoutCard } from '../../core/pipeline/scout-card.js';
import {
  type ScoutScoringDeps,
  runRefresh,
  runScout,
  sourceKeysFromEnv,
  startScoutRun,
} from '../../core/pipeline/scout.js';
import {
  TrackerError,
  approveAnswer,
  changeApplicationStatus,
  localDateToFollowUp,
  setFollowUp,
  setNotes,
} from '../../core/pipeline/tracker.js';
import { prepareAnswers } from '../../core/prep/answers.js';
import { regenerateCoverNote, regenerateResume, runPrep } from '../../core/prep/prep.js';
import { DEFAULT_CACHE_PATH } from '../../core/sources/discover.js';
import { MoveError, moveToLink } from '../../core/sources/move.js';
import { relocationsFromStats } from '../../core/sources/relocate.js';
import { systemClock } from '../../core/util/clock.js';
import { createHttp } from '../../core/util/http.js';
import { createLogger } from '../../core/util/logger.js';

/**
 * Server actions for the review UI. They call core directly (no API layer) and
 * then revalidate the affected routes. These run only on the server.
 */

function isTriageAction(value: string): value is TriageAction {
  return (TRIAGE_ACTIONS as readonly string[]).includes(value);
}

/** Shortlist / skip / archive a job, then refresh the queue and lists. */
export async function triage(jobId: number, action: string): Promise<void> {
  if (!isTriageAction(action)) throw new Error(`unknown triage action "${action}"`);
  const { db, sqlite } = createDb();
  try {
    triageJob(db, systemClock, { jobId, action });
  } finally {
    sqlite.close();
  }
  revalidateShell();
}

/** The shell's sidebar counts read the DB too, so a change revalidates the root layout. */
function revalidateShell(): void {
  revalidatePath('/', 'layout');
}

export type TriageWriteResult =
  | { ok: true; jobId: number; from: JobStatus; to: JobStatus }
  | { ok: false; error: string };

/**
 * A triage action from the split view (J5). It doesn't revalidate: that would re-render a view of
 * thousands of rows on every key press. The view updates optimistically and refetches the sidebar
 * counts itself (D96).
 */
export async function triageJobAction(jobId: number, action: string): Promise<TriageWriteResult> {
  try {
    if (!isTriageAction(action)) throw new Error(`unknown triage action "${action}"`);
    const { db, sqlite } = createDb();
    try {
      const result = triageJob(db, systemClock, { jobId, action });
      return { ok: true, jobId, from: result.from, to: result.to };
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** U, or Undo on the toast: restore the job's status before its last triage action. */
export async function undoTriageAction(jobId: number): Promise<TriageWriteResult> {
  try {
    const { db, sqlite } = createDb();
    try {
      const result = undoTriage(db, systemClock, { jobId });
      return { ok: true, jobId, from: result.from, to: result.to };
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type StartScoreResult = { ok: true; runId: number } | { ok: false; error: string };

/**
 * Open a score run and let it go on in the server process after this returns. The client polls
 * `/api/score-run/<id>` for progress (D95), so no server action is held open while it scores.
 */
function startBatch(
  pick: (criteria: Criteria) => {
    first: string[];
    jobIds?: number[];
  },
): StartScoreResult {
  try {
    const config = loadAllConfig();
    const llm = createAnthropicLlm();
    const { db, sqlite } = createDb();
    let runId: number;
    try {
      runId = startScoreRun(db, systemClock, pick(config.criteria));
    } catch (err) {
      sqlite.close();
      throw err;
    }
    void runScoreBatch(runId, {
      db,
      llm,
      clock: systemClock,
      log: createLogger(),
      criteria: config.criteria,
      profile: config.profile,
      preferences: config.preferences,
    }).finally(() => sqlite.close());
    return { ok: true, runId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Score next N from the Unscored view: up to `budget.max_new_scores_per_run` jobs, the view's
 * Where first (`where_default` when the view is on Anywhere), then by prescore.
 */
export async function startScoreNext(where: string[]): Promise<StartScoreResult> {
  return startBatch((criteria) => {
    const known = areaIds(criteria);
    const picked = known.filter((id) => where.includes(id));
    return { first: picked.length ? picked : whereDefault(criteria) };
  });
}

/** Score this job, from the detail pane: one model call for one job. */
export async function startScoreJob(jobId: number): Promise<StartScoreResult> {
  return startBatch(() => ({ first: [], jobIds: [jobId] }));
}

export type StartScoutResult =
  | { ok: true; runId: number; scoringNote?: string }
  | { ok: false; error: string };

/**
 * Open a scout and return its id at once. The fetch continues in the server process.
 * The shell polls `GET /api/scout-run/<id>` (D95, D125), so the tab's other actions are
 * not held for the run. `score` is Run scout. Refresh listings leaves it off, so the run
 * never enters the Scoring step.
 */
async function beginScout(score: boolean): Promise<StartScoutResult> {
  try {
    const config = loadAllConfig();

    let scoring: ScoutScoringDeps | undefined;
    let scoringNote: string | undefined;
    if (score) {
      try {
        scoring = { llm: createAnthropicLlm(), profile: config.profile };
      } catch (err) {
        if (err instanceof LlmError) scoringNote = err.message;
        else throw err;
      }
    }

    const { db, sqlite } = createDb();
    let runId: number;
    try {
      runId = startScoutRun(db, systemClock);
    } catch (err) {
      sqlite.close();
      if (err instanceof ScoreBusyError) return { ok: false, error: err.message };
      throw err;
    }

    const run = score ? runScout : runRefresh;
    void run({
      db,
      http: createHttp(),
      clock: systemClock,
      log: createLogger(),
      companies: config.companies.companies,
      criteria: config.criteria,
      preferences: config.preferences,
      scoring,
      sourceKeys: sourceKeysFromEnv(process.env),
      runId,
      upkeep: { dir: DEFAULT_CONFIG_DIR, cachePath: DEFAULT_CACHE_PATH },
    })
      .catch((err: unknown) => {
        createLogger().error(
          { err: err instanceof Error ? err.message : String(err) },
          'scout failed',
        );
      })
      .finally(() => sqlite.close());

    return { ok: true, runId, ...(scoringNote ? { scoringNote } : {}) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * "Run scout now". Discovery, gates, prescore, then scoring. If no `ANTHROPIC_API_KEY`
 * is set, scoring is skipped and `scoringNote` says so.
 */
export async function runScoutNow(): Promise<StartScoutResult> {
  return beginScout(true);
}

/** Refresh listings. The same scout and the same lock, with no model call. */
export async function refreshListings(): Promise<StartScoutResult> {
  return beginScout(false);
}

function isBoardAts(value: string): value is BoardAts {
  return (BOARD_ATS as readonly string[]).includes(value);
}

/**
 * Stop scouting one board. Sets `active: false` in companies.yaml and on the
 * companies row. Jobs already stored stay. Refused while a scout is running,
 * because that run would turn the board back on.
 */
export async function turnOffBoard(input: {
  ats: string;
  token: string;
}): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const ats = input.ats.trim();
  const token = input.token.trim();
  if (!isBoardAts(ats) || token.length === 0 || token.length > 200) {
    return { ok: false, error: 'That board is not valid.' };
  }

  let config: ReturnType<typeof loadAllConfig>;
  try {
    config = loadAllConfig();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const { db, sqlite } = createDb();
  try {
    if (scoutCard(db, systemClock, config.criteria).running) {
      return {
        ok: false,
        error: 'A scout is running. Turn this board off after it finishes.',
      };
    }
    let edited: { name: string; changed: boolean };
    try {
      edited = setCompanyActive(DEFAULT_CONFIG_DIR, ats, token, false);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    try {
      companiesRepo(db, systemClock).setActive(ats, token, false);
    } catch (err) {
      if (edited.changed) {
        try {
          setCompanyActive(DEFAULT_CONFIG_DIR, ats, token, true);
        } catch {
          // The file is already inactive. The next scout reads that.
        }
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    revalidateShell();
    return { ok: true, name: edited.name };
  } finally {
    sqlite.close();
  }
}

export type MoveBoardResult = { ok: true; from: string; to: string } | { ok: false; error: string };

/**
 * Use this board (J15): move a gone board to a board relocation found for it. Only a candidate the
 * latest scout stored for that board is accepted. `moveBoard` refuses while a scout is live.
 */
export async function moveBoardToCandidate(input: {
  ats: string;
  token: string;
  to: { ats: string; token: string };
}): Promise<MoveBoardResult> {
  const ats = input.ats.trim();
  const token = input.token.trim();
  if (!isBoardAts(ats) || token.length === 0 || token.length > 200) {
    return { ok: false, error: 'That board is not valid.' };
  }
  const { db, sqlite } = createDb();
  try {
    const relocation = relocationsFromStats(runsRepo(db, systemClock).latest('scout')?.stats).find(
      (r) => r.ats === ats && r.token === token,
    );
    const candidate = relocation?.candidates.find(
      (c) => c.ats === input.to.ats && c.token === input.to.token,
    );
    if (!candidate) {
      return { ok: false, error: 'That board is no longer offered. Run scout again.' };
    }
    const moved = moveBoard(
      { dir: DEFAULT_CONFIG_DIR, db, clock: systemClock },
      { ats, token },
      {
        ats: candidate.ats,
        token: candidate.token,
        name: candidate.name,
      },
    );
    revalidateShell();
    return { ok: true, from: moved.from.name, to: moved.to.name };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    sqlite.close();
  }
}

/**
 * The careers-link field (J15): detect the ATS, fetch the board once, and move to it when it has
 * postings. A refusal comes back as words for the card and changes nothing.
 */
export async function moveBoardToLink(input: {
  ats: string;
  token: string;
  url: string;
}): Promise<MoveBoardResult> {
  const ats = input.ats.trim();
  const token = input.token.trim();
  const url = input.url.trim();
  if (!isBoardAts(ats) || token.length === 0 || token.length > 200) {
    return { ok: false, error: 'That board is not valid.' };
  }
  if (url.length === 0 || url.length > 500) {
    return { ok: false, error: "That link isn't a board JobHacker can read. Nothing changed." };
  }
  let config: ReturnType<typeof loadAllConfig>;
  try {
    config = loadAllConfig();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const from = config.companies.companies.find((c) => c.ats === ats && c.token === token);
  const { db, sqlite } = createDb();
  try {
    const keys = sourceKeysFromEnv(process.env);
    const moved = await moveToLink(
      {
        dir: DEFAULT_CONFIG_DIR,
        db,
        clock: systemClock,
        http: createHttp(),
        keys: { workable: keys.workable, teamtailor: keys.teamtailor },
      },
      { ats, token, name: from?.name ?? token },
      url,
    );
    revalidateShell();
    return { ok: true, from: moved.from.name, to: moved.to.name };
  } catch (err) {
    if (err instanceof MoveError || err instanceof ConfigError) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    sqlite.close();
  }
}

/**
 * "Save to criteria.yaml" (FR-6): persist the slider weights. Only the six
 * weight values in the file change; the ranked list re-reads them. No LLM.
 */
export async function saveWeightsAction(
  weights: Weights,
): Promise<{ ok: boolean; error?: string }> {
  try {
    saveWeights(DEFAULT_CONFIG_DIR, weights);
    revalidateShell();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Save the tune panel's weights and bands (J6). Same file edit as
 * `saveWeights`, plus the two band thresholds. No model call.
 */
export async function saveRankingAction(
  weights: Weights,
  bands: Bands,
): Promise<{ ok: boolean; error?: string }> {
  try {
    saveRanking(DEFAULT_CONFIG_DIR, { weights, bands });
    revalidateShell();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function prepDeps() {
  const config = loadAllConfig();
  const { db, sqlite } = createDb();
  return {
    deps: {
      db,
      llm: createAnthropicLlm(),
      clock: systemClock,
      log: createLogger(),
      criteria: config.criteria,
      profile: config.profile,
      preferences: config.preferences,
    },
    sqlite,
  };
}

export interface PrepActionResult {
  ok: boolean;
  applicationId?: number;
  needsInput?: string[];
  fellBack?: number;
  coverGrounded?: boolean;
  pdf?: boolean;
  error?: string;
}

/** Generate tailored materials for a shortlisted job (FR-7). */
export async function prepJob(jobId: number): Promise<PrepActionResult> {
  let sqlite: ReturnType<typeof createDb>['sqlite'] | undefined;
  try {
    const built = prepDeps();
    sqlite = built.sqlite;
    const result = await runPrep(built.deps, { jobId });
    revalidateShell();
    return {
      ok: true,
      applicationId: result.applicationId,
      needsInput: result.needsInput,
      fellBack: result.fellBack,
      coverGrounded: result.coverNoteGrounded,
      pdf: result.pdfPath != null,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    sqlite?.close();
  }
}

/** Regenerate just the resume for an application. Returns the new HTML. */
export async function regenerateResumeAction(
  jobId: number,
): Promise<{ ok: boolean; resumeHtml?: string; fellBack?: number; error?: string }> {
  let sqlite: ReturnType<typeof createDb>['sqlite'] | undefined;
  try {
    const built = prepDeps();
    sqlite = built.sqlite;
    const res = await regenerateResume(built.deps, { jobId });
    revalidateShell();
    return { ok: true, resumeHtml: res.resumeHtml, fellBack: res.fellBack };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    sqlite?.close();
  }
}

/** Regenerate just the cover note for an application. Returns the new text. */
export async function regenerateCoverAction(
  jobId: number,
): Promise<{ ok: boolean; coverNote?: string; grounded?: boolean; error?: string }> {
  let sqlite: ReturnType<typeof createDb>['sqlite'] | undefined;
  try {
    const built = prepDeps();
    sqlite = built.sqlite;
    const res = await regenerateCoverNote(built.deps, { jobId });
    revalidateShell();
    return { ok: true, coverNote: res.text, grounded: res.grounded };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    sqlite?.close();
  }
}

/**
 * Re-derive the standard answers from the profile (deterministic, no LLM).
 * Answers saved for this job's form questions are kept.
 */
export async function regenerateAnswersAction(
  jobId: number,
): Promise<{ ok: boolean; answers?: Record<string, string>; error?: string }> {
  try {
    const config = loadAllConfig();
    const answers = prepareAnswers(config.profile);
    const { db, sqlite } = createDb();
    const map: Record<string, string> = {};
    try {
      const repo = applicationsRepo(db, systemClock);
      for (const [key, value] of Object.entries(repo.findByJob(jobId)?.answers ?? {})) {
        if (!isStandardKey(key)) map[key] = value;
      }
      for (const a of answers) map[a.key] = a.answer;
      repo.upsertForJob({ jobId, answers: map });
    } finally {
      sqlite.close();
    }
    revalidateShell();
    return { ok: true, answers: map };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface OpenAndFillResult {
  ok: boolean;
  fallback?: boolean;
  ats?: string;
  applyUrl?: string;
  report?: FillReport;
  answers?: PreparedAnswerView[];
  /** True when Chrome is not reachable; `launchCommand` tells the human what to run. */
  needsChrome?: boolean;
  launchCommand?: string;
  error?: string;
}

/**
 * "Open & fill" (FR-8): connect to Kris's Chrome, open the apply URL, fill the
 * form (drafting answers to its own questions with the writing model when an
 * API key is set), attach the resume, and return the fill report. Never
 * submits. If Chrome is not running, returns `needsChrome` + the launch command
 * instead of throwing (acceptance #4).
 */
export async function openAndFill(jobId: number): Promise<OpenAndFillResult> {
  let sqlite: ReturnType<typeof createDb>['sqlite'] | undefined;
  try {
    const config = loadAllConfig();
    let llm: ReturnType<typeof createAnthropicLlm> | undefined;
    try {
      llm = createAnthropicLlm();
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
    }
    const opened = createDb();
    sqlite = opened.sqlite;
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
      {
        jobId,
        // The keyboard walkthrough points this at its own Chrome. Unset, fill uses port 9222.
        ...(process.env.JOBHACKER_CDP_ENDPOINT
          ? { endpoint: process.env.JOBHACKER_CDP_ENDPOINT }
          : {}),
      },
    );
    revalidateShell();
    return {
      ok: true,
      fallback: result.fallback,
      ats: result.ats,
      applyUrl: result.applyUrl,
      report: result.report,
      answers: result.answers,
    };
  } catch (err) {
    if (err instanceof BrowserError) {
      return { ok: false, needsChrome: true, launchCommand: err.message, error: err.message };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    sqlite?.close();
  }
}

/**
 * "Mark submitted" (FR-8/FR-9): the human submitted the form himself. A second
 * click keeps the first submission time (`already`).
 */
export async function markSubmittedAction(
  jobId: number,
): Promise<{ ok: boolean; followUpAt?: string | null; already?: boolean; error?: string }> {
  try {
    const { db, sqlite } = createDb();
    try {
      const res = markSubmitted(db, systemClock, jobId);
      revalidateShell();
      return { ok: true, followUpAt: res.followUpAt, already: res.already };
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Change an application's status (FR-9 tracker). Refreshes the tracker views. */
export async function setApplicationStatusAction(
  jobId: number,
  status: string,
): Promise<{ ok: boolean; followUpAt?: string | null; error?: string }> {
  try {
    const { db, sqlite } = createDb();
    try {
      const res = changeApplicationStatus(db, systemClock, { jobId, status });
      revalidateShell();
      return { ok: true, followUpAt: res.followUpAt };
    } finally {
      sqlite.close();
    }
  } catch (err) {
    if (err instanceof TrackerError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Set or clear an application's follow-up date (FR-9 tracker). */
export async function setFollowUpAction(
  jobId: number,
  followUpAt: string | null,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { db, sqlite } = createDb();
    try {
      setFollowUp(db, systemClock, { jobId, followUpAt });
      revalidateShell();
      return { ok: true };
    } finally {
      sqlite.close();
    }
  } catch (err) {
    if (err instanceof TrackerError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Set or clear the follow-up date from the workspace's date field. `date` is a
 * local `yyyy-mm-dd`; it's stored as 9 AM that day on Kris's Mac.
 */
export async function setFollowUpDateAction(
  jobId: number,
  date: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (date === null) return setFollowUpAction(jobId, null);
  const at = localDateToFollowUp(date);
  if (!at) return { ok: false, error: 'That date was not understood.' };
  return setFollowUpAction(jobId, at);
}

/** Update an application's free-text notes (FR-9 tracker). */
export async function setNotesAction(
  jobId: number,
  notes: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { db, sqlite } = createDb();
    try {
      setNotes(db, systemClock, { jobId, notes });
      revalidateShell();
      return { ok: true };
    } finally {
      sqlite.close();
    }
  } catch (err) {
    if (err instanceof TrackerError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * "Looks good" on a drafted answer: record that Kris approved exactly the text
 * the workspace shows, for this application only (invariant 3).
 */
export async function approveDraftAction(
  applicationId: number,
  approvalKey: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { profile } = loadAllConfig();
    const { db, sqlite } = createDb();
    try {
      const app = applicationsRepo(db, systemClock).get(applicationId);
      if (!app) return { ok: false, error: 'That application no longer exists.' };
      const target = approvalTarget(
        { report: parseStoredReport(app.fillReport), answers: app.answers ?? {}, profile },
        approvalKey,
      );
      if (!target) return { ok: false, error: 'That answer is no longer on the fill report.' };
      approveAnswer(db, systemClock, { jobId: app.jobId, ...target });
    } finally {
      sqlite.close();
    }
    revalidateShell();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Persist Kris's edits to the cover note and answers. A drafted answer he
 * changed counts as reviewed: it's his text now, for this application only.
 */
export async function saveApplication(
  jobId: number,
  data: { coverNote?: string; answers?: Record<string, string> },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { profile } = loadAllConfig();
    const { db, sqlite } = createDb();
    try {
      const apps = applicationsRepo(db, systemClock);
      const before = apps.findByJob(jobId);
      if (!before) return { ok: false, error: 'That application no longer exists.' };
      const tx = db.$client.transaction(() => {
        apps.upsertForJob({ jobId, ...data });
        const answers = data.answers;
        if (!answers) return;
        const report = parseStoredReport(before.fillReport);
        for (const [key, value] of Object.entries(answers)) {
          if (before.answers?.[key] === value || !isUsable(value)) continue;
          const target = approvalTarget({ report, answers, profile }, key);
          if (target) approveAnswer(db, systemClock, { jobId, ...target, edited: true });
        }
      });
      tx();
    } finally {
      sqlite.close();
    }
    revalidateShell();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * A domain Brand Search matched unambiguously. The browser fetched it.
 * No revalidate: the open list updates itself, and the next navigation reads the row.
 */
function readLogoChoice(value: unknown): LogoChoice | null {
  if (!value || typeof value !== 'object') return null;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === 'confirm' || kind === 'none') return { kind };
  if (kind !== 'pick' && kind !== 'type') return null;
  const domain = (value as { domain?: unknown }).domain;
  if (typeof domain !== 'string') return null;
  if (kind === 'type') {
    const markUrl = (value as { markUrl?: unknown }).markUrl;
    return { kind, domain, markUrl: typeof markUrl === 'string' ? markUrl : null };
  }
  const brandId = (value as { brandId?: unknown }).brandId;
  return { kind, domain, brandId: typeof brandId === 'string' ? brandId : null };
}

/** Kris's answer from the logo picker. The browser searched; this only stores the choice. */
export async function setCompanyLogo(name: string, choice: unknown): Promise<LogoChoiceResult> {
  const parsed = readLogoChoice(choice);
  if (!parsed || name.trim().length === 0) {
    return { ok: false, error: 'That choice was not understood.' };
  }
  try {
    const config = loadAllConfig();
    const { db, sqlite } = createDb();
    try {
      return applyLogoChoice(db, systemClock, config.criteria, name, parsed);
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    revalidatePath('/companies');
    revalidateShell();
  }
}

export type ResetPlanResult = { ok: true; plan: ResetPlan } | { ok: false; error: string };

/** The dialog's counts. Reads only. */
export async function loadResetPlan(): Promise<ResetPlanResult> {
  try {
    const { db, sqlite } = openExistingDb();
    try {
      return { ok: true, plan: planReset(db) };
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type ConfirmResetResult =
  | { ok: true; before: ResetPlan; after: ResetPlan }
  | { ok: false; error: string };

/** Back up, then empty the queue. Refuses while a scout or score run is live. */
export async function confirmReset(): Promise<ConfirmResetResult> {
  try {
    const { db, sqlite } = openExistingDb();
    try {
      const result = await applyReset({
        db,
        sqlite,
        destDir: DEFAULT_BACKUP_DIR,
        clock: systemClock,
      });
      return { ok: true, before: result.before, after: result.after };
    } catch (err) {
      if (err instanceof ScoreBusyError) return { ok: false, error: err.message };
      throw err;
    } finally {
      sqlite.close();
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    revalidateShell();
  }
}

export async function recordBrandDomain(
  name: string,
  hits: unknown,
): Promise<{ domain: string | null }> {
  const list = Array.isArray(hits) ? hits.slice(0, 8) : hits;
  const parsed = searchHitsSchema.safeParse(list);
  if (!parsed.success || name.trim().length === 0) return { domain: null };
  const pick = pickSearchMatch(name, parsed.data);
  if (!pick) return { domain: null };
  const { db, sqlite } = createDb();
  try {
    const domain = saveSearchedDomain(db, systemClock, {
      name,
      domain: pick.domain,
      brandId: pick.brandId,
    });
    return { domain };
  } finally {
    sqlite.close();
  }
}
