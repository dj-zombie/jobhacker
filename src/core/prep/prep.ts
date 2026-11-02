import { join } from 'node:path';
import { isStandardKey } from '../apply/field-map.js';
import type { Criteria, Profile } from '../config/schemas.js';
import type { Db } from '../db/client.js';
import { applicationsRepo } from '../db/repo/applications.js';
import { eventsRepo } from '../db/repo/events.js';
import { scoresRepo } from '../db/repo/scores.js';
import type { Job } from '../db/schema.js';
import { COVER_NOTE_JOB_CHAR_CAP } from '../llm/prompts/cover-note.js';
import { TAILOR_JOB_CHAR_CAP } from '../llm/prompts/tailor.js';
import type { LlmClient } from '../llm/types.js';
import type { Clock } from '../util/clock.js';
import type { Logger } from '../util/logger.js';
import { truncate } from '../util/text.js';
import { type PreparedAnswer, prepareAnswers } from './answers.js';
import { writeCoverNote } from './cover-note.js';
import { renderResumeHtml, renderResumePdf, writeResumeHtml } from './render.js';
import { type TailoredResultBullet, tailorBullets } from './tailor.js';

/**
 * Prep orchestration (FR-7, ARCHITECTURE § Flows "Prep"). For one shortlisted
 * job it tailors resume bullets, writes a cover note, prepares the standard
 * answers, renders the resume to HTML + PDF under `output/<appId>/`, and persists
 * everything on the job's `applications` row with a `prep` audit event. Every
 * generated artifact is grounded in the profile (invariant 3); missing facts are
 * left as `[NEEDS INPUT: …]` markers, never guessed.
 */

export class PrepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrepError';
  }
}

export interface PrepDeps {
  db: Db;
  llm: LlmClient;
  clock: Clock;
  log: Logger;
  criteria: Criteria;
  profile: Profile;
  /** `preferences.md` prose, so the cover letter uses Kris's own reasons. */
  preferences?: string;
}

export interface PrepOptions {
  jobId: number;
  /** Base output directory; defaults to `output`. */
  outputDir?: string;
  /** Override the Chrome binary used for the PDF. */
  chromePath?: string;
  /** Skip the PDF step (used by tests, which have no browser). */
  skipPdf?: boolean;
}

export interface PrepResult {
  applicationId: number;
  jobId: number;
  title: string;
  company: string;
  htmlPath: string;
  pdfPath: string | null;
  bullets: TailoredResultBullet[];
  coverNote: string;
  coverNoteGrounded: boolean;
  answers: PreparedAnswer[];
  /** Every `[NEEDS INPUT: …]` marker across the cover note and answers. */
  needsInput: string[];
  /** Bullets that fell back to their original source text (grounding failed). */
  fellBack: number;
  usage: { inputTokens: number; outputTokens: number; calls: number };
}

const NEEDS_INPUT_RE = /\[NEEDS INPUT[^\]]*\]/gi;

export async function runPrep(deps: PrepDeps, options: PrepOptions): Promise<PrepResult> {
  const { db, clock, log } = deps;
  const detail = scoresRepo(db, clock).detail(options.jobId);
  if (!detail) throw new PrepError(`job ${options.jobId} not found`);
  const { job, company } = detail;

  const model = deps.criteria.llm.writing_model;
  const tailorJobText = renderJobText(job, company, TAILOR_JOB_CHAR_CAP);
  const coverJobText = renderJobText(job, company, COVER_NOTE_JOB_CHAR_CAP);

  const tailored = await tailorBullets({
    llm: deps.llm,
    model,
    profile: deps.profile,
    jobText: tailorJobText,
  });
  const cover = await writeCoverNote({
    llm: deps.llm,
    model,
    profile: deps.profile,
    company,
    jobText: coverJobText,
    preferences: deps.preferences,
  });
  const answers = prepareAnswers(deps.profile);

  // Create (or find) the application first so we have an id for the output path.
  const apps = applicationsRepo(db, clock);
  const app = apps.upsertForJob({ jobId: options.jobId, status: 'prepped' });

  const outDir = join(options.outputDir ?? 'output', String(app.id));
  const htmlPath = join(outDir, 'resume.html');
  const pdfPath = join(outDir, 'resume.pdf');

  const html = renderResumeHtml({ profile: deps.profile, bullets: tailored.bullets });
  await writeResumeHtml(html, htmlPath);

  let savedPdfPath: string | null = null;
  if (!options.skipPdf) {
    await renderResumePdf(html, pdfPath, { chromePath: options.chromePath });
    savedPdfPath = pdfPath;
  }

  // Standard answers are re-derived; answers saved for this job's form questions
  // (drafted on a fill, maybe edited by Kris) are kept.
  const answerMap: Record<string, string> = {};
  for (const [key, value] of Object.entries(app.answers ?? {})) {
    if (!isStandardKey(key)) answerMap[key] = value;
  }
  for (const a of answers) answerMap[a.key] = a.answer;

  apps.upsertForJob({
    jobId: options.jobId,
    status: 'prepped',
    resumeHtml: html,
    resumePdfPath: savedPdfPath,
    coverNote: cover.text,
    answers: answerMap,
  });

  const needsInput = collectNeedsInput(cover.text, answers);
  const usage = {
    inputTokens: tailored.usage.inputTokens + cover.usage.inputTokens,
    outputTokens: tailored.usage.outputTokens + cover.usage.outputTokens,
    calls: tailored.usage.calls + cover.usage.calls,
  };

  // Audit event: counts and token usage only, never the generated text (invariant 4).
  const eventsWriter = eventsRepo(db, clock);
  eventsWriter.append({
    type: 'prep',
    jobId: options.jobId,
    applicationId: app.id,
    payload: {
      model,
      bullets: tailored.bullets.length,
      fell_back_bullets: tailored.fellBack,
      cover_grounded: cover.grounded,
      needs_input: needsInput.length,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      calls: usage.calls,
    },
  });
  // A separate `llm_usage` event so prep spend counts in the month's total
  // (Known issue [4]). Token counts only (invariant 4).
  eventsWriter.append({
    type: 'llm_usage',
    jobId: options.jobId,
    applicationId: app.id,
    payload: {
      model,
      prompt: 'prep',
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      calls: usage.calls,
    },
  });

  log.info(
    {
      jobId: options.jobId,
      applicationId: app.id,
      bullets: tailored.bullets.length,
      fellBack: tailored.fellBack,
      needsInput: needsInput.length,
    },
    'prep complete',
  );

  return {
    applicationId: app.id,
    jobId: options.jobId,
    title: job.title,
    company,
    htmlPath,
    pdfPath: savedPdfPath,
    bullets: tailored.bullets,
    coverNote: cover.text,
    coverNoteGrounded: cover.grounded,
    answers,
    needsInput,
    fellBack: tailored.fellBack,
    usage,
  };
}

export interface RegenerateOptions {
  jobId: number;
  outputDir?: string;
  chromePath?: string;
  skipPdf?: boolean;
}

export interface RegenerateResumeResult {
  applicationId: number;
  htmlPath: string;
  pdfPath: string | null;
  resumeHtml: string;
  bullets: TailoredResultBullet[];
  fellBack: number;
}

/**
 * Regenerate only the resume for an existing application (UI per-section
 * regenerate). The application must already exist (`prep` was run once).
 */
export async function regenerateResume(
  deps: PrepDeps,
  options: RegenerateOptions,
): Promise<RegenerateResumeResult> {
  const { db, clock } = deps;
  const detail = scoresRepo(db, clock).detail(options.jobId);
  if (!detail) throw new PrepError(`job ${options.jobId} not found`);
  const apps = applicationsRepo(db, clock);
  const app = apps.findByJob(options.jobId);
  if (!app) throw new PrepError(`no application for job ${options.jobId}; run prep first`);

  const model = deps.criteria.llm.writing_model;
  const jobText = renderJobText(detail.job, detail.company, TAILOR_JOB_CHAR_CAP);
  const tailored = await tailorBullets({ llm: deps.llm, model, profile: deps.profile, jobText });

  const outDir = join(options.outputDir ?? 'output', String(app.id));
  const htmlPath = join(outDir, 'resume.html');
  const pdfPath = join(outDir, 'resume.pdf');
  const html = renderResumeHtml({ profile: deps.profile, bullets: tailored.bullets });
  await writeResumeHtml(html, htmlPath);

  let savedPdfPath: string | null = null;
  if (!options.skipPdf) {
    await renderResumePdf(html, pdfPath, { chromePath: options.chromePath });
    savedPdfPath = pdfPath;
  }

  apps.upsertForJob({ jobId: options.jobId, resumeHtml: html, resumePdfPath: savedPdfPath });
  eventsRepo(db, clock).append({
    type: 'prep',
    jobId: options.jobId,
    applicationId: app.id,
    payload: {
      section: 'resume',
      bullets: tailored.bullets.length,
      fell_back_bullets: tailored.fellBack,
    },
  });

  return {
    applicationId: app.id,
    htmlPath,
    pdfPath: savedPdfPath,
    resumeHtml: html,
    bullets: tailored.bullets,
    fellBack: tailored.fellBack,
  };
}

export interface RegenerateCoverResult {
  applicationId: number;
  text: string;
  grounded: boolean;
}

/** Regenerate only the cover note for an existing application. */
export async function regenerateCoverNote(
  deps: PrepDeps,
  options: { jobId: number },
): Promise<RegenerateCoverResult> {
  const { db, clock } = deps;
  const detail = scoresRepo(db, clock).detail(options.jobId);
  if (!detail) throw new PrepError(`job ${options.jobId} not found`);
  const apps = applicationsRepo(db, clock);
  const app = apps.findByJob(options.jobId);
  if (!app) throw new PrepError(`no application for job ${options.jobId}; run prep first`);

  const model = deps.criteria.llm.writing_model;
  const jobText = renderJobText(detail.job, detail.company, COVER_NOTE_JOB_CHAR_CAP);
  const cover = await writeCoverNote({
    llm: deps.llm,
    model,
    profile: deps.profile,
    company: detail.company,
    jobText,
    preferences: deps.preferences,
  });

  apps.upsertForJob({ jobId: options.jobId, coverNote: cover.text });
  eventsRepo(db, clock).append({
    type: 'prep',
    jobId: options.jobId,
    applicationId: app.id,
    payload: { section: 'cover', cover_grounded: cover.grounded },
  });

  return { applicationId: app.id, text: cover.text, grounded: cover.grounded };
}

/** The job as prompt text: company, title, location, truncated description. */
export function renderJobText(job: Job, company: string, cap: number): string {
  const lines = [
    `Company: ${company}`,
    `Title: ${job.title}`,
    `Location: ${job.locationRaw ?? 'not stated'} (${job.remoteType})`,
    '',
    'Description:',
    truncate(job.descriptionText, cap),
  ];
  return lines.join('\n');
}

function collectNeedsInput(coverNote: string, answers: PreparedAnswer[]): string[] {
  const found = new Set<string>();
  for (const m of coverNote.matchAll(NEEDS_INPUT_RE)) found.add(m[0]);
  for (const a of answers) {
    for (const m of a.answer.matchAll(NEEDS_INPUT_RE)) found.add(m[0]);
  }
  return [...found];
}
