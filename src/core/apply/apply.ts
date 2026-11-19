import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Browser } from 'playwright-core';
import type { Ats, Criteria, Profile } from '../config/schemas.js';
import type { Db } from '../db/client.js';
import { applicationsRepo } from '../db/repo/applications.js';
import { eventsRepo } from '../db/repo/events.js';
import { scoresRepo } from '../db/repo/scores.js';
import { type Application, companies } from '../db/schema.js';
import { FORM_ANSWERS_JOB_CHAR_CAP } from '../llm/prompts/form-answers.js';
import type { LlmClient } from '../llm/types.js';
import { draftFormAnswers, storedAnswer } from '../prep/form-answers.js';
import { renderJobText } from '../prep/prep.js';
import { attachmentName, renderCoverLetterHtml, renderResumePdf } from '../prep/render.js';
import type { Clock } from '../util/clock.js';
import { urlHost } from '../util/host.js';
import type { Logger } from '../util/logger.js';
import { connectChrome, openApplyPage } from './browser.js';
import { type FieldMapping, isUsable } from './field-map.js';
import { fillForm } from './fill.js';
import { mapFormFields } from './llm-map.js';
import { type ApplyPlan, adapterForHost, planApply, selectAdapter } from './plan.js';
import { fillSmartRecruitersForm } from './smartrecruiters.js';
import { ApplyError, type FillReport, type OpenQuestion, type RawFormField } from './types.js';

/**
 * Apply-assist orchestration (FR-8, ARCHITECTURE § Flows "Apply assist"). It
 * connects to Kris's Chrome, opens the apply URL, fills every field it can —
 * profile fields, standard answers, and the form's own questions (drafted by
 * the writing model on first fill, saved on the application, reused after) —
 * attaches the resume and cover letter, outlines drafted answers and unfilled
 * required fields, and persists a fill report + a `fill` event. It never
 * submits. `markSubmitted` is the human's follow-up after he reviews and
 * submits the form himself.
 *
 * An ATS without its own adapter still opens the page and fills it through the
 * generic harvester. Copy-paste is only the result when the page has no fields.
 */

/** ATSs whose filler drafts the form's own questions; the others map fields with the model. */
export const FILLABLE_ATS: readonly Ats[] = ['greenhouse', 'lever', 'ashby'];

export interface ApplyDeps {
  db: Db;
  clock: Clock;
  log: Logger;
  profile: Profile;
  /**
   * The writing model, to draft answers to the form's own questions. Without
   * it those questions are left unfilled (and outlined when required).
   */
  llm?: LlmClient;
  criteria?: Criteria;
  /** `preferences.md`, so logistics answers follow Kris's own words. */
  preferences?: string;
  /** Connects to Kris's Chrome. Tests pass a fake. */
  connect?: (endpoint?: string) => Promise<Browser>;
}

/** The plan for one job's application, read from the database. No browser, no model. */
export function applyPlanFor(db: Db, clock: Clock, jobId: number): ApplyPlan {
  const detail = scoresRepo(db, clock).detail(jobId);
  if (!detail) throw new ApplyError(`job ${jobId} not found`);
  const app = applicationsRepo(db, clock).findByJob(jobId);
  return planApply({
    job: detail.job,
    company: detail.company,
    employerLink: app?.applyUrl ?? null,
    boardToken: boardTokenOf(db, detail.job.companyId),
  });
}

function boardTokenOf(db: Db, companyId: number): string | null {
  return (
    db.select({ token: companies.token }).from(companies).where(eq(companies.id, companyId)).get()
      ?.token ?? null
  );
}

export interface ApplyOptions {
  jobId: number;
  /** CDP endpoint override (defaults to the dedicated Chrome). */
  endpoint?: string;
}

export interface PreparedAnswerView {
  key: string;
  label: string;
  value: string;
}

export interface ApplyResult {
  ok: boolean;
  /** True when the page had no fillable fields, so the answers are for copy-paste. */
  fallback: boolean;
  ats: string;
  applyUrl: string;
  applicationId: number;
  title: string;
  company: string;
  /** Present when a form was filled (not a fallback), or when the page had no form. */
  report?: FillReport;
  /** Present for a fallback: the prepared answers to copy-paste. */
  answers?: PreparedAnswerView[];
  /** Set when the plan stopped before Chrome: the link is on a job board. */
  skipped?: { host: string; publisher: string | null };
  /** Set when the page opened but had no application form; the tab stays open. */
  noForm?: { host: string; reason: string };
}

function humanizeKey(key: string): string {
  const spaced = key.replace(/_/g, ' ').trim();
  return spaced.length === 0 ? key : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function answerViews(answers: Record<string, string>): PreparedAnswerView[] {
  return Object.entries(answers).map(([key, value]) => ({ key, label: humanizeKey(key), value }));
}

export async function runApply(deps: ApplyDeps, options: ApplyOptions): Promise<ApplyResult> {
  const { db, clock, log } = deps;
  const detail = scoresRepo(db, clock).detail(options.jobId);
  if (!detail) throw new ApplyError(`job ${options.jobId} not found`);

  const apps = applicationsRepo(db, clock);
  const app = apps.findByJob(options.jobId);
  if (!app) {
    throw new ApplyError(`no application for job ${options.jobId}; run \`prep\` first`);
  }

  const plan = planApply({
    job: detail.job,
    company: detail.company,
    employerLink: app.applyUrl,
    boardToken: boardTokenOf(db, detail.job.companyId),
  });
  const answers = app.answers ?? {};

  // A job board's page is never opened for filling: no browser, no model,
  // no fill report. Only the counts are recorded (D184).
  if (plan.kind === 'stop') {
    const stored = detail.job.applyOptions ?? [];
    eventsRepo(db, clock).append({
      type: 'fill_skipped',
      jobId: options.jobId,
      applicationId: app.id,
      payload: {
        host: plan.host,
        options: stored.length,
        direct: stored.filter((o) => o.direct).length,
      },
    });
    log.info({ jobId: options.jobId, host: plan.host }, 'apply: job-board link, not opened');
    return {
      ok: true,
      fallback: false,
      ats: detail.job.ats,
      applyUrl: plan.url,
      applicationId: app.id,
      title: detail.job.title,
      company: detail.company,
      skipped: { host: plan.host, publisher: plan.publisher },
    };
  }

  const applyUrl = plan.url;
  const adapter = selectAdapter(detail.job.ats, applyUrl);
  const byHost = adapterForHost(applyUrl) !== undefined;
  const drafts = (FILLABLE_ATS as readonly string[]).includes(adapter.ats);

  const jobText = renderJobText(detail.job, detail.company, FORM_ANSWERS_JOB_CHAR_CAP);
  const browser = await (deps.connect ?? connectChrome)(options.endpoint);
  try {
    const page = await openApplyPage(browser, applyUrl);
    const fillDeps = {
      profile: deps.profile,
      answers,
      resumePdfPath: namedResume(deps.profile, app),
      coverNote: app.coverNote,
      coverLetterAvailable: isUsable(app.coverNote) || existsSync(PROVIDED_COVER_LETTER),
      coverLetterPdf: () => coverLetterPdf(deps.profile, app),
      draftAnswers: drafts ? draftAndSave(deps, app, jobText) : undefined,
      mapFields: drafts ? undefined : mapAndSave(deps, app, jobText),
      reportAts: byHost ? adapter.ats : detail.job.ats,
    };
    const report =
      adapter.ats === 'smartrecruiters'
        ? await fillSmartRecruitersForm(page, fillDeps, applyUrl)
        : await fillForm(page, adapter, fillDeps, applyUrl);
    const empty =
      report.filled.length === 0 && report.unfilled.length === 0 && report.skipped_eeo.length === 0;

    // Persist the report (labels + sources only, never typed values; invariant 4).
    apps.upsertForJob({ jobId: options.jobId, fillReport: report });
    eventsRepo(db, clock).append({
      type: 'fill',
      jobId: options.jobId,
      applicationId: app.id,
      payload: {
        ats: report.ats,
        filled: report.filled.length,
        drafted: report.filled.filter((f) => f.via === 'draft').length,
        unfilled: report.unfilled.length,
        unfilled_required: report.unfilled.filter((u) => u.required).length,
        skipped_eeo: report.skipped_eeo.length,
        self_identification: report.self_identification.length,
        resume_attached: report.resumeAttached,
        ...(report.noForm ? { no_form: true } : {}),
      },
    });
    log.info(
      {
        jobId: options.jobId,
        applicationId: app.id,
        filled: report.filled.length,
        unfilled: report.unfilled.length,
        skippedEeo: report.skipped_eeo.length,
      },
      'apply: form filled (not submitted)',
    );

    if (report.noForm) {
      return {
        ok: true,
        fallback: true,
        ats: report.ats,
        applyUrl,
        applicationId: app.id,
        title: detail.job.title,
        company: detail.company,
        report,
        answers: answerViews(answers),
        noForm: { host: urlHost(applyUrl) ?? applyUrl, reason: report.noForm.reason },
      };
    }
    return {
      ok: true,
      fallback: empty,
      ats: report.ats,
      applyUrl,
      applicationId: app.id,
      title: detail.job.title,
      company: detail.company,
      report: empty ? undefined : report,
      answers: empty ? answerViews(answers) : undefined,
    };
  } finally {
    // Disconnect from CDP; Kris's Chrome and the filled tab stay open.
    await browser.close();
  }
}

/** The resume Kris made and keeps in `input/`. */
export const PROVIDED_RESUME = join('input', 'resume.pdf');

/**
 * The resume a fill attaches and the Resume tab shows: Kris's own
 * `input/resume.pdf`, as it is, whenever it exists (D124); otherwise the one
 * prep rendered.
 */
export function attachedResume(
  generatedPath: string | null,
  exists: (path: string) => boolean = existsSync,
): { path: string | null; provided: boolean } {
  if (exists(PROVIDED_RESUME)) return { path: PROVIDED_RESUME, provided: true };
  return { path: generatedPath, provided: false };
}

/**
 * The resume as the recruiter should see it ("Kris_Tester_Resume.pdf", not
 * "resume.pdf"): a copy in the application's output folder, refreshed on every fill.
 */
export function namedResume(
  profile: Profile,
  app: Pick<Application, 'id' | 'resumePdfPath'>,
): string | null {
  const source = attachedResume(app.resumePdfPath).path;
  if (!source || !existsSync(source)) return source;
  const dir = app.resumePdfPath ? dirname(app.resumePdfPath) : join('output', String(app.id));
  mkdirSync(dir, { recursive: true });
  const named = join(dir, attachmentName(profile, 'Resume'));
  copyFileSync(source, named);
  return named;
}

/** The cover letter Kris wrote and keeps in `input/`, used when the note has a gap. */
export const PROVIDED_COVER_LETTER = join('input', 'cover-letter.pdf');

/**
 * The cover-letter PDF for an upload: the job's own cover note rendered when
 * it is usable; otherwise the cover letter Kris provided at
 * `input/cover-letter.pdf`, copied beside the prep output under his name.
 * A gapped note must never silently mean "no cover letter" (Kris, 2026-10-24).
 */
async function coverLetterPdf(profile: Profile, app: Application): Promise<string | null> {
  const dir = app.resumePdfPath ? dirname(app.resumePdfPath) : join('output', String(app.id));
  const out = join(dir, attachmentName(profile, 'Cover_Letter'));
  if (isUsable(app.coverNote)) {
    await renderResumePdf(renderCoverLetterHtml(profile, app.coverNote), out);
    return out;
  }
  if (existsSync(PROVIDED_COVER_LETTER)) {
    copyFileSync(PROVIDED_COVER_LETTER, out);
    return out;
  }
  return null;
}

/**
 * The generic-path mapping step: one writing-model call over the harvested
 * fields. A failure leaves the deterministic profile fills in place. Counts
 * only are logged (invariant 4). Undefined when no model is configured.
 */
function mapAndSave(
  deps: ApplyDeps,
  app: Application,
  jobText: string,
): ((fields: RawFormField[]) => Promise<Map<string, FieldMapping>>) | undefined {
  const { llm, criteria } = deps;
  if (!llm || !criteria) return undefined;
  return async (fields) => {
    try {
      const result = await mapFormFields(
        {
          llm,
          model: criteria.llm.writing_model,
          profile: deps.profile,
          preferences: deps.preferences ?? '',
          answers: app.answers ?? {},
          jobText,
        },
        fields,
      );
      if (result.usage.calls > 0) {
        eventsRepo(deps.db, deps.clock).append({
          type: 'llm_usage',
          jobId: app.jobId,
          applicationId: app.id,
          payload: {
            model: criteria.llm.writing_model,
            prompt: 'field-map',
            input_tokens: result.usage.inputTokens,
            output_tokens: result.usage.outputTokens,
            calls: result.usage.calls,
            questions: result.questions,
            kept: result.kept,
            dropped: result.dropped,
          },
        });
      }
      deps.log.info(
        {
          jobId: app.jobId,
          questions: result.questions,
          kept: result.kept,
          dropped: result.dropped,
        },
        'apply: mapped form fields',
      );
      return result.mappings;
    } catch (err) {
      deps.log.warn(
        { jobId: app.jobId, err: err instanceof Error ? err.message : String(err) },
        'apply: field map failed; filling profile fields only',
      );
      return new Map();
    }
  };
}

/**
 * The drafting step for `fillForm`: one writing-model call for the open
 * questions, answers saved on the application (so a re-fill reuses them and
 * Kris can edit them in the UI), plus `draft_answers` and `llm_usage` events
 * with counts only (invariant 4). Undefined when no model is configured.
 */
function draftAndSave(
  deps: ApplyDeps,
  app: Application,
  jobText: string,
): ((questions: OpenQuestion[]) => Promise<Record<string, string>>) | undefined {
  const { llm, criteria } = deps;
  if (!llm || !criteria) return undefined;
  return async (questions) => {
    const model = criteria.llm.writing_model;
    const result = await draftFormAnswers(
      {
        llm,
        model,
        profile: deps.profile,
        preferences: deps.preferences ?? '',
        jobText,
        coverNote: app.coverNote ?? '',
      },
      questions,
    );
    const drafted: Record<string, string> = {};
    for (const a of result.answers) drafted[a.label] = storedAnswer(a);

    const apps = applicationsRepo(deps.db, deps.clock);
    const current = apps.findByJob(app.jobId)?.answers ?? {};
    apps.upsertForJob({ jobId: app.jobId, answers: { ...current, ...drafted } });

    const answered = result.answers.filter((a) => a.answer !== null).length;
    const needsInput = result.answers.filter((a) => a.needsInput !== null).length;
    const events = eventsRepo(deps.db, deps.clock);
    events.append({
      type: 'draft_answers',
      jobId: app.jobId,
      applicationId: app.id,
      payload: {
        model,
        questions: questions.length,
        answered,
        needs_input: needsInput,
        rejected: result.rejected,
        retried: result.retried,
      },
    });
    events.append({
      type: 'llm_usage',
      jobId: app.jobId,
      applicationId: app.id,
      payload: {
        model,
        prompt: 'form-answers',
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        calls: result.usage.calls,
      },
    });
    deps.log.info(
      {
        jobId: app.jobId,
        questions: questions.length,
        answered,
        needsInput,
        rejected: result.rejected,
      },
      'apply: drafted answers for the form questions',
    );
    return drafted;
  };
}

export interface MarkSubmittedResult {
  applicationId: number;
  submittedAt: string;
  followUpAt: string | null;
  /** True when the application was already marked submitted; nothing changed. */
  already: boolean;
}

/** Follow-up days after submission for the default follow-up date (FR-9 seed). */
export const FOLLOW_UP_DAYS = 7;

/**
 * Record that the human submitted the application himself ("Mark submitted").
 * Sets `submitted_at=now`, a default `follow_up_at` of now + 7 days, moves a
 * prepped application to `submitted`, and appends a `submitted` event.
 * Idempotent: once `submitted_at` is set, a second call changes nothing, so the
 * first submission time (and the time-to-submit stat) stays. A prepped
 * application isn't submitted, whatever stamp it carries. A later status
 * (interviewing, offer, …) is never moved back. DB-only (no browser, no LLM).
 */
export function markSubmitted(db: Db, clock: Clock, jobId: number): MarkSubmittedResult {
  const apps = applicationsRepo(db, clock);
  const app = apps.findByJob(jobId);
  if (!app) throw new ApplyError(`no application for job ${jobId}; run \`prep\` first`);
  if (app.submittedAt && app.status !== 'prepped') {
    return {
      applicationId: app.id,
      submittedAt: app.submittedAt,
      followUpAt: app.followUpAt,
      already: true,
    };
  }

  const submittedAt = clock.now();
  const followUpAt = new Date(Date.parse(submittedAt) + FOLLOW_UP_DAYS * 86_400_000).toISOString();
  const status = app.status === 'prepped' ? 'submitted' : app.status;

  apps.upsertForJob({ jobId, status, submittedAt, followUpAt });
  eventsRepo(db, clock).append({
    type: 'submitted',
    jobId,
    applicationId: app.id,
    payload: { follow_up_at: followUpAt },
  });

  return { applicationId: app.id, submittedAt, followUpAt, already: false };
}
