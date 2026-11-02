import type { Criteria, Dimension } from '../config/schemas.js';
import type { Db } from '../db/client.js';
import { areasRepo } from '../db/repo/areas.js';
import { scoresRepo } from '../db/repo/scores.js';
import type { GateResult, Job, JobStatus, ScoreState, Verdict } from '../db/schema.js';
import type { Clock } from '../util/clock.js';
import { areaLabel, classifyJob, placesConfigFrom, sortAreas } from './areas.js';
import { ageInDays } from './gate.js';
import { type PrescoreBreakdown, buildPrescorer, prescoreCorpus } from './prescore.js';
import { type CriticalCap, computeRank, contributions, verdictFor } from './rank.js';
import { isStale } from './ranked.js';
import type { ScoringKey } from './score.js';

/**
 * `why <jobId>` (FR-11): every number that put a job where it is — gate,
 * prescore, each dimension with its weight and reason, and the live score.
 * Read-only; never calls the LLM.
 */

export type Placement = 'gated' | 'ranked' | 'unscored';

export interface WhyDimension {
  dimension: Dimension;
  weight: number;
  score: number | null;
  weighted: number | null;
  reason: string;
}

export interface WhyReport {
  job: Job;
  company: string;
  ageDays: number | null;
  status: JobStatus;
  placement: Placement;
  gate: GateResult | null;
  scoreState: ScoreState;
  prescore: { value: number | null; breakdown: PrescoreBreakdown | null };
  score: {
    baseScore: number | null;
    score: number | null;
    verdict: Verdict;
    cap: CriticalCap | null;
    dimensions: WhyDimension[];
    /** Σ weight over dimensions with a score (the denominator). */
    knownWeight: number;
    summary: string | null;
    redFlags: string[];
    model: string;
    rubricVersion: string;
    scoredAt: string;
    stale: boolean;
  } | null;
  /** A v1 single-number score for this text, kept for history but never ranked. */
  legacyScore: { score: number; verdict: Verdict } | null;
  /** Kris's places: classified live (with evidence) and as stored in `job_areas`. */
  places: {
    live: { area: string; label: string; evidence: string }[];
    remoteStates: string[];
    stored: string[];
    differs: boolean;
  };
}

export interface WhyOptions {
  criteria: Criteria;
  current?: ScoringKey;
  /** When given, the prescore is broken down into its matched terms. */
  preferences?: string;
}

export function explainJob(
  db: Db,
  clock: Clock,
  jobId: number,
  options: WhyOptions,
): WhyReport | undefined {
  const detail = scoresRepo(db, clock).detail(jobId);
  if (!detail) return undefined;
  const { job, company, score: row } = detail;
  const { criteria } = options;

  let breakdown: PrescoreBreakdown | null = null;
  if (options.preferences && job.prescore !== null) {
    breakdown = buildPrescorer(
      options.preferences,
      prescoreCorpus(db),
    )({
      title: job.title,
      text: job.descriptionText,
    });
  }

  let score: WhyReport['score'] = null;
  let legacyScore: WhyReport['legacyScore'] = null;
  if (row?.dimensions) {
    const dims = row.dimensions;
    const live = computeRank(dims, criteria.weights, criteria.bands);
    const parts = contributions(dims, criteria.weights).map((c) => ({
      ...c,
      reason: dims[c.dimension].reason,
    }));
    score = {
      baseScore: live.baseScore,
      score: live.score,
      verdict: verdictFor(live.score, criteria.bands),
      cap: live.cap,
      dimensions: parts,
      knownWeight: parts.reduce((sum, p) => sum + (p.score === null ? 0 : p.weight), 0),
      summary: row.summary,
      redFlags: row.redFlags,
      model: row.model,
      rubricVersion: row.rubricVersion,
      scoredAt: row.createdAt,
      stale: isStale(row, options.current),
    };
  } else if (row) {
    legacyScore = { score: row.score, verdict: row.verdict };
  }

  const gated =
    job.closedAt !== null || job.duplicateOf !== null || job.gateResult?.passed === false;
  const placement: Placement = gated ? 'gated' : score ? 'ranked' : 'unscored';
  const scoreState = job.scoreState;

  const classified = classifyJob(job, placesConfigFrom(criteria));
  const stored = sortAreas(criteria, areasRepo(db).forJob(job.id));
  const places = {
    live: classified.areas.map((area) => ({
      area,
      label: areaLabel(criteria, area),
      evidence: classified.evidence[area] ?? '',
    })),
    remoteStates: classified.remoteStates ?? [],
    stored,
    differs: stored.join(',') !== classified.areas.join(','),
  };

  return {
    job,
    company,
    ageDays: ageInDays(job.postedAt, clock.nowMs()),
    status: job.status,
    placement,
    scoreState,
    gate: job.gateResult,
    prescore: { value: job.prescore, breakdown },
    score,
    legacyScore,
    places,
  };
}

const PLACEMENT_TEXT: Record<Placement, string> = {
  gated: 'gated out (not in the queue)',
  ranked: 'ranked in the queue',
  unscored: 'not LLM-scored for the current posting text (in the unscored list)',
};

const SCORE_STATE_TEXT: Record<ScoreState, string> = {
  pending: 'pending scoring',
  current: 'current-key score stored',
  stale: 'stale score; current-key rescore pending',
  run_cap: 'deferred by the per-run cap',
  llm_error: 'last LLM scoring attempt failed',
};

function renderPlaces(p: WhyReport['places']): string[] {
  const live =
    p.live.length === 0
      ? "none of Kris's places (shown under Anywhere)"
      : p.live.map((a) => `${a.label} (matched "${a.evidence}")`).join('; ');
  const lines = [`places:    ${live}`];
  if (p.remoteStates.length > 0) {
    lines.push(`           remote limited to ${p.remoteStates.join(', ')}`);
  }
  if (p.differs) {
    lines.push(
      `           ! stored in job_areas: ${p.stored.join(', ') || 'none'}; run \`pnpm cli places:reclassify\``,
    );
  }
  return lines;
}

/** Plain-text rendering for the CLI. */
export function renderWhy(r: WhyReport): string {
  const j = r.job;
  const comp =
    j.compMin == null && j.compMax == null
      ? 'not stated'
      : `${j.compMin ?? '?'}–${j.compMax ?? '?'} ${j.compCurrency ?? ''}`.trim();
  const lines = [
    `#${j.id}  ${r.company} — ${j.title}`,
    `  ${j.locationRaw ?? 'location not stated'} (${j.remoteType}) · comp ${comp} · posted ${
      r.ageDays === null ? 'unknown' : `${r.ageDays}d ago`
    } · status ${r.status}`,
    `  ${j.url}`,
    '',
    `placement: ${PLACEMENT_TEXT[r.placement]}`,
    `score state: ${r.scoreState} — ${SCORE_STATE_TEXT[r.scoreState]}`,
    `gate:      ${
      r.gate
        ? r.gate.passed
          ? 'passed all four gates'
          : `${r.gate.gate} — ${r.gate.detail ?? ''}`
        : 'not yet gated'
    }`,
    ...renderPlaces(r.places),
  ];

  const p = r.prescore;
  if (p.value === null) {
    lines.push('prescore:  none (gated or not yet computed)');
  } else {
    lines.push(
      `prescore:  ${p.value.toFixed(3)} (ordering signal only; never an eligibility floor)`,
    );
    if (p.breakdown) {
      lines.push(
        `           title terms matched: ${p.breakdown.titleMatches.join(', ') || '(none)'}`,
        `           title terms unwanted: ${p.breakdown.titleNegatives.join(', ') || '(none)'}`,
        `           description coverage of wanted terms: ${p.breakdown.bodyCoverage.toFixed(2)}`,
      );
    }
  }

  const s = r.score;
  if (!s) {
    lines.push(
      r.legacyScore
        ? `score:     v1 score ${r.legacyScore.score} (${r.legacyScore.verdict}) — old single-number rubric, not ranked`
        : 'score:     not LLM-scored',
    );
    return lines.join('\n');
  }
  lines.push(
    `score:     ${s.score ?? '—'} → ${s.verdict}${s.stale ? '  (stale: scored with older preferences/profile/rubric)' : ''}`,
    `base:      ${s.baseScore ?? '—'} = Σ(weight × dimension) / ${s.knownWeight} × 20`,
    ...(s.cap
      ? [
          `cap:       critical ${s.cap.dimensions.join(', ')} = ${s.cap.level}; maximum score ${s.cap.maxScore}`,
        ]
      : ['cap:       none']),
    '',
  );
  for (const d of s.dimensions) {
    const value = d.score === null ? ' –' : `${d.score}/5`;
    const weighted = d.weighted === null ? 'n/a' : String(d.weighted);
    lines.push(
      `  ${d.dimension.padEnd(15)} ${value.padStart(4)}  × w${d.weight} = ${weighted.padStart(3)}   ${d.reason}`,
    );
  }
  lines.push('');
  if (s.summary) lines.push(`summary:   ${s.summary}`);
  if (s.redFlags.length === 0) lines.push('red flags: none');
  else lines.push('red flags:', ...s.redFlags.map((f) => `  - ${f}`));
  lines.push(`scored:    ${s.scoredAt} by ${s.model} (${s.rubricVersion})`);
  return lines.join('\n');
}
