import type {
  Band,
  DimKey,
  DimensionRow,
  JobDetailData,
  JobSummary,
  RemoteType,
  TriageState,
} from '@/components/jobhacker';
import { LOGO_TILE_PX } from '../../core/brand/logo-url.js';
import { companyHeaderLogos, companyLogoSrc } from '../../core/brand/site-icon.js';
import { type Bands, DIMENSIONS, type Dimension, type Weights } from '../../core/config/schemas.js';
import { computeRank, verdictFor } from '../../core/pipeline/rank.js';
import type { ScoreRunState } from '../../core/pipeline/score-run.js';
import { type DimScores, type JobStatus, toDimensions } from '../../core/pipeline/triage-view.js';
import type { ScoringSummary } from '../../core/pipeline/triage.js';

/**
 * The triage views' data (J5): what the server sends and how the client turns it into the kit's
 * `JobSummary` and `JobDetailData`. Plain values only, so it crosses the server/client boundary,
 * and ranking happens here, in the browser, from the six dimension scores and the saved weights.
 */

/** One list row: the list fields plus six dimension scores, nothing heavier. */
export interface TriageRowData {
  id: number;
  title: string;
  company: string;
  location: string;
  remote: RemoteType;
  /** Formatted pay, or null when the posting has none. */
  comp: string | null;
  /** First seen by a scout (ISO). Drives New today, Seen and the row's age. */
  seenAt: string;
  prescore: number | null;
  status: JobStatus;
  /** Kris's areas this job is in (`job_areas`). */
  areas: string[];
  /** Scores under the current cache key; null while unscored or stale. */
  dims: DimScores | null;
  /** Registrable company domain, or null when the tile stays a monogram. */
  domain: string | null;
  /** `company_domains.source`, when a row exists. */
  logoSource: string | null;
  /** The site's own icon, only for a typed domain. */
  markUrl: string | null;
}

/** The selected job's detail, loaded on demand. */
export interface TriageDetailData {
  row: TriageRowData;
  employment: string;
  postedAt: string | null;
  description: string;
  postingUrl: string;
  summary: string | null;
  /** Per-dimension reasons in `DIMENSIONS` order, when there's a current score. */
  reasons: string[] | null;
  redFlags: string[];
  model: string | null;
  rubric: string | null;
  scoredAt: string | null;
  /** Scored only under an older key: shown as unscored. */
  stale: boolean;
  application: { id: number; status: string } | null;
}

export interface PlaceInfo {
  id: string;
  label: string;
  note?: string;
  kind: 'place' | 'remote';
}

export interface Ranking {
  weights: Weights;
  bands: Bands;
}

export interface TriagePageData {
  rows: TriageRowData[];
  places: PlaceInfo[];
  whereDefault: string[];
  ranking: Ranking;
  /** When the rows were read; ages are computed from it so the server and client render alike. */
  nowMs: number;
  /** The Unscored view's hero; null on the other views. */
  scoring: ScoringSummary | null;
  /** A score batch still running, so the hero picks its progress back up. */
  liveRun: ScoreRunState | null;
  /** Passed once. The client builds each logo URL. Empty means every tile is a monogram. */
  logoClientId: string | null;
}

const DIM_KEY: Record<Dimension, DimKey> = {
  role_fit: 'role',
  tech_fit: 'tech',
  domain_interest: 'domain',
  seniority_fit: 'seniority',
  logistics_fit: 'logistics',
  comp_fit: 'comp',
};

/** The tune panel's weight keys, from the criteria file's. */
export function kitWeights(weights: Weights): Record<DimKey, number> {
  return {
    role: weights.role_fit,
    tech: weights.tech_fit,
    domain: weights.domain_interest,
    seniority: weights.seniority_fit,
    logistics: weights.logistics_fit,
    comp: weights.comp_fit,
  };
}

/** The criteria file's weight keys, from the tune panel's. */
export function weightsFromKit(weights: Record<DimKey, number>): Weights {
  return {
    role_fit: weights.role,
    tech_fit: weights.tech,
    domain_interest: weights.domain,
    seniority_fit: weights.seniority,
    logistics_fit: weights.logistics,
    comp_fit: weights.comp,
  };
}

const DIM_LABEL: Record<DimKey, string> = {
  role: 'Role',
  tech: 'Tech',
  domain: 'Domain',
  seniority: 'Seniority',
  logistics: 'Logistics',
  comp: 'Comp',
};

export function scoreOf(
  dims: DimScores | null,
  ranking: Ranking,
): { score: number | null; band: Band | null } {
  if (!dims) return { score: null, band: null };
  const { score } = computeRank(toDimensions(dims), ranking.weights, ranking.bands);
  return { score, band: score === null ? null : verdictFor(score, ranking.bands) };
}

function stateOf(status: JobStatus, application: { status: string } | null): TriageState {
  if (application) return application.status === 'prepped' ? 'prepped' : 'submitted';
  return status === 'shortlisted' || status === 'skipped' || status === 'archived' ? status : 'new';
}

export function toSummary(
  row: TriageRowData,
  ranking: Ranking,
  places: ReadonlyMap<string, PlaceInfo>,
  nowMs: number,
  application: { status: string } | null = null,
  logoClientId: string | null = null,
): JobSummary {
  const { score, band } = scoreOf(row.dims, ranking);
  const placeId = row.areas.find((a) => places.get(a)?.kind === 'place');
  const place = placeId ? places.get(placeId) : undefined;
  return {
    id: String(row.id),
    title: row.title,
    company: row.company,
    logoUrl: companyLogoSrc({
      domain: row.domain,
      source: row.logoSource,
      markUrl: row.markUrl,
      clientId: logoClientId,
      size: LOGO_TILE_PX,
    }),
    location: row.location,
    remote: row.remote,
    compLabel: row.comp,
    ageHours: Math.max(0, (nowMs - Date.parse(row.seenAt)) / 3_600_000),
    score,
    band,
    prescore: row.prescore,
    state: stateOf(row.status, application),
    place: place ? { id: place.id, label: place.label } : null,
  };
}

/**
 * The detail header's logos (J11), from the row alone, so the browser can build them
 * the moment J or K selects a job, before its detail loads.
 */
export function headerLogosFor(
  row: Pick<TriageRowData, 'domain' | 'logoSource' | 'markUrl'>,
  logoClientId: string | null,
): Pick<JobDetailData, 'logoTileUrl' | 'logoSymbolUrl' | 'logoWordmarkUrl'> {
  const logos = companyHeaderLogos({
    domain: row.domain,
    source: row.logoSource,
    markUrl: row.markUrl,
    clientId: logoClientId,
  });
  return { logoTileUrl: logos.cover, logoSymbolUrl: logos.symbol, logoWordmarkUrl: logos.wordmark };
}

/** "Oct 24", or "today"/"yesterday", for the detail's Posted line. */
export function postedLabel(iso: string | null, nowMs: number): string {
  if (!iso) return 'date unknown';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 'date unknown';
  const days = Math.floor((nowMs - at) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function scoredLabel(iso: string | null): string | undefined {
  if (!iso) return undefined;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return undefined;
  return `Scored ${at.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
}

function formulaFor(
  rows: DimensionRow[],
  score: number | null,
  ranking: Ranking,
  dims: DimScores,
): string | undefined {
  if (score === null) return undefined;
  const pts = rows.filter((d) => d.points != null);
  const sum = pts.reduce((a, d) => a + (d.points ?? 0), 0);
  const den = pts.reduce((a, d) => a + d.weight, 0);
  const { baseScore, cap } = computeRank(toDimensions(dims), ranking.weights, ranking.bands);
  const nulls = rows.filter((d) => d.score == null).map((d) => d.label.toLowerCase());
  const parts = [`${baseScore ?? score} = ${sum} points ÷ ${den} total weight × 20`];
  if (nulls.length) parts.push(`${nulls.join(', ')} not listed, so left out`);
  if (cap && baseScore !== null && score < baseScore) {
    const names = cap.dimensions.map((d) => DIM_LABEL[DIM_KEY[d]].toLowerCase()).join(', ');
    parts.push(`${names} at ${cap.level} of 5 caps it at ${cap.maxScore}, so ${score}`);
  }
  return parts.join('. ');
}

/** The detail pane's data. `description` is filled in by the caller, which parses it. */
export function toDetailData(
  detail: TriageDetailData,
  ranking: Ranking,
  places: ReadonlyMap<string, PlaceInfo>,
  nowMs: number,
  logoClientId: string | null = null,
): Omit<JobDetailData, 'description'> {
  const summary = toSummary(detail.row, ranking, places, nowMs, detail.application, logoClientId);
  const dims = detail.row.dims;
  const dimensions: DimensionRow[] | undefined = dims
    ? DIMENSIONS.map((d, i) => {
        const key = DIM_KEY[d];
        const score = dims[i] ?? null;
        const weight = ranking.weights[d];
        return {
          key,
          label: DIM_LABEL[key],
          score,
          weight,
          points: score == null ? null : score * weight,
          reason: detail.reasons?.[i] ?? '',
        };
      })
    : undefined;
  return {
    ...summary,
    ...headerLogosFor(detail.row, logoClientId),
    employment: employmentLabel(detail.employment),
    postedLabel: postedLabel(detail.postedAt, nowMs),
    summary: detail.summary ?? undefined,
    dimensions,
    formula:
      dimensions && dims ? formulaFor(dimensions, summary.score ?? null, ranking, dims) : undefined,
    redFlags: detail.redFlags,
    model: detail.model ?? undefined,
    rubric: detail.rubric ?? undefined,
    scoredLabel: scoredLabel(detail.scoredAt),
    postingUrl: detail.postingUrl,
  };
}

function employmentLabel(value: string): string {
  if (!value || value === 'unknown') return 'Employment type not listed';
  return value
    .split('_')
    .map((w, i) => (i === 0 ? `${w[0]?.toUpperCase() ?? ''}${w.slice(1)}` : w))
    .join('-');
}
