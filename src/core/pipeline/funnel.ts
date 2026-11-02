import type { Criteria } from '../config/schemas.js';
import type { Db } from '../db/client.js';
import { scoresRepo } from '../db/repo/scores.js';
import {
  GATE_NAMES,
  type GateName,
  SCORE_STATES,
  type ScoreState,
  type Verdict,
  jobs,
} from '../db/schema.js';
import type { Clock } from '../util/clock.js';
import { ageInDays } from './gate.js';
import { rankedList } from './ranked.js';
import type { ScoringKey } from './score.js';

/**
 * The funnel (FR-11): where every job in the database is, so a dropped job is
 * always explainable. Read-only. Every job lands in exactly one bucket:
 * gated (by which gate), scored (ranked), or unscored (by exact score state).
 * Bands use the current weights, not stored verdicts.
 */

export interface AgeBucket {
  label: string;
  count: number;
}

export interface Funnel {
  total: number;
  gated: Record<GateName, number>;
  gatedTotal: number;
  /** Hidden by a pre-Phase-2 filter and not re-gated yet (any `score`/`scout`/`funnel` run fixes this). */
  notYetGated: number;
  /** Open, non-duplicate jobs that passed the gates (scored + unscored). */
  passed: number;
  prescored: number;
  scored: { total: number; current: number; stale: number; bands: Record<Verdict, number> };
  unscored: { total: number; byState: Record<ScoreState, number> };
  triage: { shortlisted: number; skipped: number; archived: number };
  /** Posting age of the jobs that passed the gates, to help pick `max_age_days`. */
  ageOfPassed: AgeBucket[];
  settings: { maxAgeDays: number; maxNewScoresPerRun: number };
}

const AGE_EDGES = [7, 14, 21, 30, 45, 90, 180] as const;

export function computeFunnel(
  db: Db,
  clock: Clock,
  criteria: Criteria,
  current?: ScoringKey,
): Funnel {
  const nowMs = clock.nowMs();
  const all = db
    .select({
      id: jobs.id,
      status: jobs.status,
      closedAt: jobs.closedAt,
      duplicateOf: jobs.duplicateOf,
      gateResult: jobs.gateResult,
      postedAt: jobs.postedAt,
    })
    .from(jobs)
    .all();

  const scoredRows = rankedList(
    db,
    clock,
    { weights: criteria.weights, bands: criteria.bands, current },
    {},
  );
  const unscoredRows = scoresRepo(db, clock).unscoredRows();
  const visibleIds = new Set([...scoredRows, ...unscoredRows].map((r) => r.jobId));

  const gated = Object.fromEntries(GATE_NAMES.map((g) => [g, 0])) as Record<GateName, number>;
  const ageCounts = new Map<string, number>();
  const ageLabels = [...AGE_EDGES.map((d) => `≤${d}d`), `>${AGE_EDGES.at(-1)}d`, 'unknown'];
  for (const label of ageLabels) ageCounts.set(label, 0);

  let prescored = 0;
  let notYetGated = 0;
  const triage = { shortlisted: 0, skipped: 0, archived: 0 };
  for (const job of all) {
    if (!visibleIds.has(job.id)) {
      const gate = gateOf(job);
      if (gate) gated[gate] += 1;
      else notYetGated += 1;
      continue;
    }
    if (job.status === 'shortlisted' || job.status === 'skipped' || job.status === 'archived') {
      triage[job.status] += 1;
    }
    const label = ageLabel(ageInDays(job.postedAt, nowMs));
    ageCounts.set(label, (ageCounts.get(label) ?? 0) + 1);
  }
  for (const row of unscoredRows) if (row.prescore !== null) prescored += 1;
  for (const row of scoredRows) if (row.prescore !== null) prescored += 1;

  const bands: Record<Verdict, number> = { strong: 0, maybe: 0, no: 0 };
  let stale = 0;
  for (const row of scoredRows) {
    bands[row.verdict] += 1;
    if (row.stale) stale += 1;
  }
  const byState = Object.fromEntries(SCORE_STATES.map((state) => [state, 0])) as Record<
    ScoreState,
    number
  >;
  for (const row of unscoredRows) byState[row.scoreState] += 1;

  const gatedTotal = GATE_NAMES.reduce((sum, g) => sum + gated[g], 0);
  const passed = visibleIds.size;
  if (gatedTotal + notYetGated + passed !== all.length) {
    throw new Error(
      `funnel conservation failed: ${all.length} total != ${gatedTotal} gated + ${notYetGated} not-yet-gated + ${passed} passed`,
    );
  }
  if (scoredRows.length + unscoredRows.length !== passed) {
    throw new Error(
      `funnel passed-job conservation failed: ${passed} passed != ${scoredRows.length} scored + ${unscoredRows.length} unscored`,
    );
  }

  return {
    total: all.length,
    gated,
    gatedTotal,
    notYetGated,
    passed,
    prescored,
    scored: { total: scoredRows.length, current: scoredRows.length - stale, stale, bands },
    unscored: { total: unscoredRows.length, byState },
    triage,
    ageOfPassed: ageLabels.map((label) => ({ label, count: ageCounts.get(label) ?? 0 })),
    settings: {
      maxAgeDays: criteria.gates.max_age_days,
      maxNewScoresPerRun: criteria.budget.max_new_scores_per_run,
    },
  };
}

/** Which gate a non-visible job is behind. Closed and duplicate are read from the job itself. */
function gateOf(job: {
  closedAt: string | null;
  duplicateOf: number | null;
  gateResult: { gate: GateName | null } | null;
}): GateName | null {
  if (job.closedAt !== null) return 'closed';
  if (job.duplicateOf !== null) return 'duplicate';
  return job.gateResult?.gate ?? null;
}

function ageLabel(days: number | null): string {
  if (days === null) return 'unknown';
  for (const edge of AGE_EDGES) if (days <= edge) return `≤${edge}d`;
  return `>${AGE_EDGES.at(-1)}d`;
}

/** One line per gate with its count, in gate order. The CLI and the Unscored view both print these. */
export function gateLines(f: Funnel): { gate: GateName; label: string; count: number }[] {
  const ageGate =
    f.settings.maxAgeDays > 0 ? `max_age_days ${f.settings.maxAgeDays}` : 'age gate off';
  const labels: Record<GateName, string> = {
    closed: 'closed (no longer on the board)',
    duplicate: 'duplicate of another posting',
    blocklist: 'company blocklisted',
    age: `too old (${ageGate})`,
  };
  return GATE_NAMES.map((gate) => ({ gate, label: labels[gate], count: f.gated[gate] }));
}

/** Plain-text rendering for the CLI. */
export function renderFunnel(f: Funnel): string {
  const pad = (n: number) => String(n).padStart(6);
  const lines = [
    `${pad(f.total)}  jobs in the database`,
    `${pad(f.gatedTotal)}  gated out`,
    ...gateLines(f).map((g) => `${pad(g.count)}    ${g.label}`),
    `${pad(f.notYetGated)}  not yet gated (must be 0 after gate reconciliation)`,
    `${pad(f.passed)}  passed the gates`,
    `${pad(f.prescored)}    prescored`,
    `${pad(f.scored.total)}    LLM-scored (${f.scored.current} current, ${f.scored.stale} stale)`,
    `${pad(f.scored.bands.strong)}      strong`,
    `${pad(f.scored.bands.maybe)}      maybe`,
    `${pad(f.scored.bands.no)}      no`,
    `${pad(f.unscored.total)}    not LLM-scored yet (visible in the unscored list)`,
    `${pad(f.unscored.byState.pending)}      pending`,
    `${pad(f.unscored.byState.run_cap)}      deferred by per-run cap ${f.settings.maxNewScoresPerRun}`,
    `${pad(f.unscored.byState.llm_error)}      last LLM attempt failed`,
    `${pad(f.unscored.byState.stale)}      stale state without a current-text score`,
    `${pad(f.unscored.byState.current)}      inconsistent current state (must be 0)`,
    '',
    `triage: ${f.triage.shortlisted} shortlisted, ${f.triage.skipped} skipped, ${f.triage.archived} archived`,
    `posting age of jobs that passed: ${f.ageOfPassed.map((b) => `${b.label} ${b.count}`).join(' · ')}`,
  ];
  return lines.join('\n');
}
