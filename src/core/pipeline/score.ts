import type { Criteria, Profile } from '../config/schemas.js';
import type { Db } from '../db/client.js';
import { eventsRepo } from '../db/repo/events.js';
import { type ScorableJob, jobsRepo } from '../db/repo/jobs.js';
import { type ScoreKey, scoresRepo } from '../db/repo/scores.js';
import type { Dimensions } from '../db/schema.js';
import { estimateUsd, hasPrice } from '../llm/cost.js';
import {
  JOB_TEXT_CHAR_CAP,
  SCORE_SYSTEM,
  VERSION,
  scoreOutputSchema,
  scoreUserPrompt,
} from '../llm/prompts/score.js';
import { type LlmClient, LlmParseError } from '../llm/types.js';
import type { Clock } from '../util/clock.js';
import { sha256 } from '../util/hash.js';
import type { Logger } from '../util/logger.js';
import { normalizeWhitespace, truncate } from '../util/text.js';
import { locationFact, whereDefault } from './areas.js';
import type { GateStats } from './gate.js';
import { computeRank, verdictFor } from './rank.js';
import { reconcilePlacement } from './reconcile.js';

/**
 * Dimension scoring (FR-5, FR-5b, ARCHITECTURE § Flows). Each run first
 * re-applies the four gates and recomputes prescores (both cheap and
 * idempotent), then walks gate-survivors with the jobs in Kris's places
 * first (`first`, default `where_default`), then by prescore:
 *
 *  - cache hit on (job, content hash, rubric, model, profile, preferences) → `scored`, free;
 *  - the per-run cap reached → `run_cap` is stored;
 *  - otherwise one LLM call for the six dimensions → `scored`.
 *
 * A job that already has a dimension score under an older key keeps it (and
 * stays `scored`, shown as stale) until it is rescored. One job's failure is
 * recorded and does not abort the rest.
 */

export interface ScoreStats {
  /** Gate pass this run. */
  gates: GateStats;
  /** Jobs given a prescore this run. */
  prescored: number;
  /** Gate-surviving jobs considered, including human-triaged statuses. */
  candidates: number;
  /** New scores produced by a model call this run. */
  scored: number;
  /** Jobs whose current-key score already existed. */
  cached: number;
  /** Uncached jobs left for a later run because the per-run cap was reached. */
  skipped_cap: number;
  /** Jobs whose scoring failed (e.g. the model output never validated). */
  errors: number;
  /** The areas this run took first, and how many of its new scores were in them. */
  first: string[];
  scored_first: number;
  model: string;
  rubric_version: string;
  input_tokens: number;
  output_tokens: number;
  /** Model round-trips, including retries. */
  calls: number;
  estimated_usd: number;
  /** True when the model has no known price, so `estimated_usd` is a floor only. */
  cost_is_estimate: boolean;
}

export interface ScoreDeps {
  db: Db;
  llm: LlmClient;
  clock: Clock;
  log: Logger;
  criteria: Criteria;
  profile: Profile;
  preferences: string;
  /** Lowers the per-run cap for this invocation (never raises it above criteria). */
  limit?: number;
  /**
   * Areas whose jobs are scored first (PLACES § 6). Defaults to `where_default`;
   * the UI passes the view's Where. `[]` puts no place first. Never skips a job.
   */
  first?: readonly string[];
  /** Score only these jobs, e.g. the UI's "Score this job". Absent: every scorable job. */
  jobIds?: readonly number[];
  /** Called once before the first model call, then after every model attempt. */
  onProgress?: (progress: ScoreProgress) => void;
}

export interface ScoreProgress {
  /** Model attempts so far, successes and failures. */
  done: number;
  /** Model attempts this run will make: the per-run cap, or fewer when fewer jobs need one. */
  total: number;
  /** New scores that rank Strong or Maybe under the saved weights. */
  found: number;
}

export interface ScoreResult {
  stats: ScoreStats;
}

/** The parts of the cache key that come from config rather than the job. */
export type ScoringKey = Omit<ScoreKey, 'jobId' | 'contentHash'>;

export interface ScoringInputs {
  key: ScoringKey;
  profileText: string;
  preferencesText: string;
}

const MAX_OUTPUT_TOKENS = 1500;

/** The rendered prompt inputs and the config half of the cache key they hash to. */
export function scoringInputs(
  criteria: Criteria,
  profile: Profile,
  preferences: string,
): ScoringInputs {
  const profileText = renderProfile(profile);
  const preferencesText = preferences.trim();
  return {
    profileText,
    preferencesText,
    key: {
      rubricVersion: VERSION,
      model: criteria.llm.scoring_model,
      profileHash: sha256(profileText),
      preferencesHash: sha256(normalizeWhitespace(preferencesText)),
    },
  };
}

export async function scoreNewJobs(deps: ScoreDeps): Promise<ScoreResult> {
  const { db, llm, clock, log, criteria } = deps;
  const jobsWrites = jobsRepo(db);
  const scores = scoresRepo(db, clock);
  const events = eventsRepo(db, clock);

  const { gates, prescored } = reconcilePlacement(db, criteria, deps.preferences, clock);

  const inputs = scoringInputs(criteria, deps.profile, deps.preferences);
  const { model } = inputs.key;
  const configCap = criteria.budget.max_new_scores_per_run;
  const cap = deps.limit != null ? Math.min(configCap, Math.max(0, deps.limit)) : configCap;

  const first = [...(deps.first ?? whereDefault(criteria))];
  const candidates = jobsWrites.listScorable({ key: inputs.key, first, jobIds: deps.jobIds });
  const progress: ScoreProgress = {
    done: 0,
    total: Math.min(cap, candidates.filter((job) => !job.current).length),
    found: 0,
  };
  deps.onProgress?.({ ...progress });
  const stats: ScoreStats = {
    gates,
    prescored,
    candidates: candidates.length,
    scored: 0,
    cached: 0,
    skipped_cap: 0,
    errors: 0,
    first,
    scored_first: 0,
    model,
    rubric_version: VERSION,
    input_tokens: 0,
    output_tokens: 0,
    calls: 0,
    estimated_usd: 0,
    cost_is_estimate: !hasPrice(model),
  };

  for (const job of candidates) {
    const key: ScoreKey = { jobId: job.id, contentHash: job.contentHash, ...inputs.key };
    if (scores.findCached(key)) {
      jobsWrites.setScoreState(job.id, 'current', true);
      stats.cached += 1;
      continue;
    }

    const hasDimensions = scores.hasDimensions(job.id, job.contentHash);
    if (hasDimensions) jobsWrites.setScoreState(job.id, 'stale', true);

    // The cap counts every new model attempt, success or failure, so a run of
    // invalid output cannot call the API past it (Known issue [2]).
    if (stats.scored + stats.errors >= cap) {
      stats.skipped_cap += 1;
      jobsWrites.setScoreState(job.id, 'run_cap', hasDimensions);
      continue;
    }

    try {
      const result = await llm.structured({
        model,
        system: SCORE_SYSTEM,
        user: scoreUserPrompt({
          preferences: inputs.preferencesText,
          profile: inputs.profileText,
          job: renderJob(job, criteria),
        }),
        schema: scoreOutputSchema,
        maxTokens: MAX_OUTPUT_TOKENS,
        promptName: 'score',
      });

      const dimensions: Dimensions = result.value.dimensions;
      const snapshot = computeRank(dimensions, criteria.weights, criteria.bands);
      const verdict = verdictFor(snapshot.score, criteria.bands);
      scores.insert({
        ...key,
        dimensions,
        summary: result.value.summary,
        redFlags: result.value.red_flags,
        score: snapshot.score ?? 0,
        verdict,
      });
      jobsWrites.setScoreState(job.id, 'current', true);

      if (verdict !== 'no') progress.found += 1;
      stats.scored += 1;
      if (job.inFirst) stats.scored_first += 1;
      stats.input_tokens += result.usage.inputTokens;
      stats.output_tokens += result.usage.outputTokens;
      stats.calls += result.usage.calls;
      stats.estimated_usd += estimateUsd(result.usage);

      // Token counts only — never the prompt or description (invariant 4).
      events.append({
        type: 'llm_usage',
        jobId: job.id,
        payload: {
          model,
          prompt: 'score',
          rubric_version: VERSION,
          input_tokens: result.usage.inputTokens,
          output_tokens: result.usage.outputTokens,
          calls: result.usage.calls,
        },
      });
    } catch (err) {
      stats.errors += 1;
      jobsWrites.setScoreState(job.id, 'llm_error', hasDimensions);
      const message = err instanceof Error ? err.message : String(err);
      // A failed attempt still spent tokens; record them so the cost total
      // reflects it (Known issue [2]).
      if (err instanceof LlmParseError && err.usage) {
        stats.input_tokens += err.usage.inputTokens;
        stats.output_tokens += err.usage.outputTokens;
        stats.calls += err.usage.calls;
        stats.estimated_usd += estimateUsd(err.usage);
        events.append({
          type: 'llm_usage',
          jobId: job.id,
          payload: {
            model,
            prompt: 'score',
            rubric_version: VERSION,
            input_tokens: err.usage.inputTokens,
            output_tokens: err.usage.outputTokens,
            calls: err.usage.calls,
            failed: true,
          },
        });
      }
      log.error({ jobId: job.id, err: message }, 'scoring failed');
    }
    progress.done = stats.scored + stats.errors;
    deps.onProgress?.({ ...progress });
  }

  return { stats };
}

/** Summary, skills and experience. Never contact details or links (invariant 4). */
function renderProfile(profile: Profile): string {
  const skills = Object.entries(profile.skills)
    .map(([group, items]) => `- ${group}: ${items.join(', ')}`)
    .join('\n');
  const experience = profile.experience.map((e) => {
    const bullets = e.bullets.map((b) => `  - ${b.text}`).join('\n');
    return `- ${e.title}, ${e.company} (${e.start} – ${e.end})${bullets ? `\n${bullets}` : ''}`;
  });
  return [
    `Summary: ${profile.summary.trim()}`,
    'Skills:',
    skills,
    ...(experience.length > 0 ? ['Experience:', ...experience] : []),
  ].join('\n');
}

function renderJob(job: ScorableJob, criteria: Criteria): string {
  const lines = [
    `Company: ${job.companyName}`,
    `Title: ${job.title}`,
    `Location: ${job.locationRaw ?? 'not stated'} (${job.remoteType})`,
    locationFact(job, criteria),
    `Employment type: ${job.employmentType ?? 'not stated'}`,
    `Compensation: ${renderComp(job)}`,
    `Posted: ${job.postedAt ?? 'unknown'}`,
    '',
    'Description:',
    truncate(job.descriptionText, JOB_TEXT_CHAR_CAP),
  ];
  return lines.join('\n');
}

function renderComp(job: ScorableJob): string {
  if (job.compMin == null && job.compMax == null) return 'not stated';
  const currency = job.compCurrency ? ` ${job.compCurrency}` : '';
  if (job.compMin != null && job.compMax != null) return `${job.compMin}–${job.compMax}${currency}`;
  return `${job.compMin ?? job.compMax}${currency}`;
}
