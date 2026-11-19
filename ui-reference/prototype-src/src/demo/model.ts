import type {
  Band,
  DimKey,
  DimensionRow,
  FillField,
  JobDetailData,
  JobSummary,
  TriageState,
} from "@/components/jobhacker/types";
import type { Weights } from "@/components/jobhacker/tune-panel";
import { parseDescription } from "@/components/jobhacker/description";
import { DEFAULT_PLACES, REMOTE, classifyPlaces } from "../core-ports/places";
import {
  APPS,
  DEFAULT_THRESHOLDS,
  DEFAULT_WEIGHTS,
  JOBS,
  SCORE_SAMPLE,
  STATS,
  descriptionFor,
  fieldsFor,
  reasonFor,
  type AppContact,
  type AppStatus,
  type AppTask,
  type DemoApp,
  type DemoJob,
  type Dims,
} from "./data";
import { demoCoverUrl, demoLogoUrl, demoSymbolUrl, demoWordmarkUrl } from "./logos";

export const KEYS: DimKey[] = ["role", "tech", "domain", "seniority", "logistics", "comp"];
const LABEL: Record<DimKey, string> = {
  role: "Role",
  tech: "Tech",
  domain: "Domain",
  seniority: "Seniority",
  logistics: "Logistics",
  comp: "Comp",
};

export type Thresholds = { strong: number; maybe: number };

/* ---------- Places ---------- */

export const PLACE_OPTIONS = [
  ...DEFAULT_PLACES.places.map((p) => ({ id: p.id, label: p.label, note: p.note, kind: "place" as const })),
  { id: REMOTE, label: "Remote", note: "Remote roles open to the US", kind: "remote" as const },
];
export const DEFAULT_WHERE = PLACE_OPTIONS.map((p) => p.id);
const PLACE_LABEL = new Map(DEFAULT_PLACES.places.map((p) => [p.id, p.label]));

const areaCache = new Map<string, string[]>();
/** Which of Kris's areas a job is in, from its location text (see core-ports/places.ts). */
export function areasOf(job: DemoJob): string[] {
  const key = `${job.id}|${job.location}|${job.remote}`;
  let a = areaCache.get(key);
  if (!a) {
    a = classifyPlaces({ location: job.location, remote: job.remote, title: job.title }).areas;
    areaCache.set(key, a);
  }
  return a;
}

/** Empty `where` means Anywhere. */
export function inWhere(job: DemoJob, where: string[]): boolean {
  if (where.length === 0) return true;
  return areasOf(job).some((a) => where.includes(a));
}

export const INDUSTRY_OPTIONS = [
  { id: "games", label: "Games" },
  { id: "audio", label: "Audio" },
  { id: "devtools", label: "Developer tools" },
] as const;

/** Companies the demo already has, labeled the way the filter would show them. */
const COMPANY_INDUSTRY: Record<string, NonNullable<DemoJob["industry"]>> = {
  Linear: { id: "devtools", status: "confirmed" },
  Vercel: { id: "devtools", status: "confirmed" },
  GitLab: { id: "devtools", status: "confirmed" },
  Supabase: { id: "devtools", status: "confirmed" },
  Sentry: { id: "devtools", status: "confirmed" },
  Roblox: { id: "games", status: "suggested" },
  SoundCloud: { id: "audio", status: "suggested" },
};

/** Null means every industry. */
export function inDemoIndustry(job: DemoJob, industry: string | null): boolean {
  if (!industry) return true;
  return job.industry?.id === industry;
}

/** Same formula as core's rank.ts: weighted mean of non-null dimensions, scaled to 0–100. */
export function rank(d: Dims, w: Weights): number {
  let num = 0;
  let den = 0;
  KEYS.forEach((k, i) => {
    const v = d[i];
    if (v == null) return;
    num += w[k] * v;
    den += w[k];
  });
  return den ? Math.round((num / den) * 20) : 0;
}

export function bandFor(score: number, t: Thresholds): Band {
  return score >= t.strong ? "strong" : score >= t.maybe ? "maybe" : "no";
}

export function toSummary(job: DemoJob, w: Weights, t: Thresholds): JobSummary {
  const score = job.dims ? rank(job.dims, w) : null;
  return {
    id: job.id,
    title: job.title,
    company: job.company,
    logoUrl: demoLogoUrl(job.company),
    location: job.location,
    remote: job.remote,
    compLabel: job.comp ?? null,
    ageHours: job.ageHours,
    score,
    band: score != null ? bandFor(score, t) : null,
    prescore: job.prescore,
    state: job.state,
    closed: job.closed,
    place: (() => {
      const id = areasOf(job).find((a) => a !== REMOTE);
      return id ? { id, label: PLACE_LABEL.get(id) ?? id } : null;
    })(),
  };
}

export function toDetail(job: DemoJob, w: Weights, t: Thresholds): JobDetailData {
  const base = toSummary(job, w, t);
  let dimensions: DimensionRow[] | undefined;
  let formula: string | undefined;
  if (job.dims) {
    dimensions = KEYS.map((k, i) => {
      const v = job.dims![i] ?? null;
      return {
        key: k,
        label: LABEL[k],
        score: v,
        weight: w[k],
        points: v == null ? null : v * w[k],
        reason: reasonFor(job, k, v),
      };
    });
    const pts = dimensions.filter((d) => d.points != null);
    const sum = pts.reduce((a, d) => a + (d.points ?? 0), 0);
    const den = pts.reduce((a, d) => a + d.weight, 0);
    const nulls = dimensions.filter((d) => d.score == null).map((d) => d.label.toLowerCase());
    formula = `${base.score} = ${sum} points ÷ ${den} total weight × 20${
      nulls.length ? `. ${nulls.join(", ")} not listed, so left out.` : ""
    }`;
  }
  return {
    ...base,
    // The prototype has one stand-in per company. The app passes the 256 px URL here.
    logoTileUrl: demoCoverUrl(job.company),
    logoSymbolOnDarkUrl: demoSymbolUrl(job.company, "white"),
    logoSymbolOnLightUrl: demoSymbolUrl(job.company, "black"),
    logoWordmarkOnDarkUrl: demoWordmarkUrl(job.company, "white"),
    logoWordmarkOnLightUrl: demoWordmarkUrl(job.company, "black"),
    employment: job.employment,
    postedLabel: job.postedLabel,
    confirmedLabel: job.confirmedLabel ?? "8 days ago",
    summary: job.summary ?? `${job.title} at ${job.company}, ${job.location}.`,
    dimensions,
    formula,
    redFlags: job.redFlags,
    description: parseDescription(descriptionFor(job)),
    model: job.dims ? "claude-haiku-5-5" : undefined,
    rubric: job.dims ? "score-2026-10-23-dims-v2" : undefined,
    scoredLabel: job.dims ? "Oct 23, 10:16 PM" : undefined,
  };
}

/* ---------- State ---------- */

export type View = "top" | "new" | "shortlist" | "unscored";
export type Segment = "matches" | "strong" | "maybe" | "weak";

export interface State {
  jobs: DemoJob[];
  weights: Weights;
  savedWeights: Weights;
  thresholds: Thresholds;
  savedThresholds: Thresholds;
  selected: Record<View, string | null>;
  leavingId: string | null;
  history: { id: string; prev: TriageState; view: View }[];
  density: "comfortable" | "compact";
  segment: Segment;
  /** Selected place ids; empty means Anywhere. */
  where: string[];
  /** Selected industry id. Null means every industry. */
  industry: string | null;
  posted: "any" | "1d" | "7d" | "30d";
  tuneOpen: boolean;
  scout: { done: number; total: number; found: number } | null;
  lastRun: string;
  newLastRun: number;
  scoring: { done: number; total: number; found: number } | null;
  apiCalls: number;
  scoredCount: number;
  unscoredCount: number;
  apps: DemoApp[];
  fields: Record<string, FillField[]>;
  mobileDetail: boolean;
}

// `?stress` replicates the scored jobs to about 11,000 rows to check virtualization.
const STRESS = typeof location !== "undefined" && location.search.includes("stress");
const FRAME = typeof location !== "undefined" ? new URLSearchParams(location.search).get("frame") : null;
const BASE_JOBS = JOBS.map((j) => ({
  ...j,
  ...(COMPANY_INDUSTRY[j.company] ? { industry: COMPANY_INDUSTRY[j.company] } : {}),
  ...(FRAME === "closed" && j.id === "vercel-de" ? { state: "shortlisted" as const, closed: true } : {}),
}));
const SEED_JOBS = STRESS
  ? BASE_JOBS.concat(
      Array.from({ length: 300 }, (_, k) =>
        BASE_JOBS.filter((j) => j.dims && j.state === "new").map((j) => ({ ...j, id: `${j.id}-${k}` })),
      ).flat(),
    )
  : BASE_JOBS;

export const initialState: State = {
  jobs: SEED_JOBS,
  weights: { ...DEFAULT_WEIGHTS },
  savedWeights: { ...DEFAULT_WEIGHTS },
  thresholds: { ...DEFAULT_THRESHOLDS },
  savedThresholds: { ...DEFAULT_THRESHOLDS },
  selected: {
    top: "linear-pe",
    new: null,
    shortlist: FRAME === "closed" ? "vercel-de" : null,
    unscored: null,
  },
  leavingId: null,
  history: [],
  density: "comfortable",
  segment: "matches",
  where: DEFAULT_WHERE,
  industry: null,
  posted: "any",
  tuneOpen: false,
  scout: null,
  lastRun: STATS.lastRun,
  newLastRun: STATS.newLastRun,
  scoring: null,
  apiCalls: STATS.llmCalls,
  scoredCount: STATS.scored,
  unscoredCount: STATS.unscored,
  apps: APPS.map((a) => ({ ...a })),
  fields: Object.fromEntries(APPS.map((a) => [a.id, fieldsFor(a.id)])),
  mobileDetail: false,
};

export type Action =
  | { type: "select"; view: View; id: string | null }
  | { type: "leave"; id: string | null }
  | { type: "triage"; id: string; to: TriageState; view: View; nextId: string | null }
  | { type: "undo" }
  | { type: "weights"; weights: Weights }
  | { type: "thresholds"; thresholds: Thresholds }
  | { type: "saveTune" }
  | { type: "resetTune" }
  | { type: "tune"; open: boolean }
  | { type: "density"; density: State["density"] }
  | { type: "segment"; segment: Segment }
  | { type: "where"; where: string[] }
  | { type: "industry"; industry: string | null }
  | {
      type: "companyIndustry";
      company: string;
      industryId: NonNullable<DemoJob["industry"]>["id"] | null;
    }
  | { type: "posted"; posted: State["posted"] }
  | { type: "scout"; progress: State["scout"] }
  | { type: "scoutDone"; found: number }
  | { type: "scoring"; progress: State["scoring"] }
  | { type: "scoringDone"; ids: string[]; calls: number }
  | { type: "scoreOne"; id: string }
  | { type: "approveField"; appId: string; fieldId: string }
  | { type: "submitApp"; appId: string }
  | { type: "createApp"; jobId: string; appId: string }
  | { type: "mobileDetail"; open: boolean };

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "select":
      return { ...s, selected: { ...s.selected, [a.view]: a.id } };
    case "leave":
      return { ...s, leavingId: a.id };
    case "triage": {
      const job = s.jobs.find((j) => j.id === a.id);
      if (!job) return s;
      return {
        ...s,
        leavingId: null,
        jobs: s.jobs.map((j) => (j.id === a.id ? { ...j, state: a.to } : j)),
        history: [...s.history, { id: a.id, prev: job.state, view: a.view }].slice(-30),
        selected: { ...s.selected, [a.view]: a.nextId },
      };
    }
    case "undo": {
      const last = s.history[s.history.length - 1];
      if (!last) return s;
      return {
        ...s,
        jobs: s.jobs.map((j) => (j.id === last.id ? { ...j, state: last.prev } : j)),
        history: s.history.slice(0, -1),
        selected: { ...s.selected, [last.view]: last.id },
      };
    }
    case "weights":
      return { ...s, weights: a.weights };
    case "thresholds":
      return { ...s, thresholds: a.thresholds };
    case "saveTune":
      return { ...s, savedWeights: { ...s.weights }, savedThresholds: { ...s.thresholds } };
    case "resetTune":
      return { ...s, weights: { ...s.savedWeights }, thresholds: { ...s.savedThresholds } };
    case "tune":
      return { ...s, tuneOpen: a.open };
    case "density":
      return { ...s, density: a.density };
    case "segment":
      return { ...s, segment: a.segment };
    case "where":
      return { ...s, where: a.where };
    case "industry":
      return { ...s, industry: a.industry };
    case "companyIndustry":
      return {
        ...s,
        jobs: s.jobs.map((job) =>
          job.company === a.company
            ? {
                ...job,
                industry: a.industryId ? { id: a.industryId, status: "confirmed" } : undefined,
              }
            : job,
        ),
      };
    case "posted":
      return { ...s, posted: a.posted };
    case "scout":
      return { ...s, scout: a.progress };
    case "scoutDone":
      return { ...s, scout: null, lastRun: "Just now", newLastRun: a.found };
    case "scoring":
      return { ...s, scoring: a.progress };
    case "scoringDone":
      return {
        ...s,
        scoring: null,
        apiCalls: s.apiCalls + a.calls,
        scoredCount: s.scoredCount + a.calls,
        unscoredCount: Math.max(0, s.unscoredCount - a.calls),
        jobs: s.jobs.map((j) => (a.ids.includes(j.id) && j.pending ? { ...j, dims: j.pending } : j)),
      };
    case "scoreOne":
      return {
        ...s,
        apiCalls: s.apiCalls + 1,
        scoredCount: s.scoredCount + 1,
        unscoredCount: Math.max(0, s.unscoredCount - 1),
        jobs: s.jobs.map((j) => (j.id === a.id && j.pending ? { ...j, dims: j.pending } : j)),
      };
    case "approveField":
      return {
        ...s,
        fields: {
          ...s.fields,
          [a.appId]: (s.fields[a.appId] ?? []).map((f) => (f.id === a.fieldId ? { ...f, state: "filled" } : f)),
        },
      };
    case "submitApp":
      return {
        ...s,
        apps: s.apps.map((ap) =>
          ap.id === a.appId
            ? { ...ap, status: "submitted", submittedLabel: "Oct 24", followUpLabel: "Oct 31", updatedLabel: "Just now" }
            : ap,
        ),
        jobs: s.jobs.map((j) => {
          const app = s.apps.find((ap) => ap.id === a.appId);
          return app && j.id === app.jobId ? { ...j, state: "submitted" } : j;
        }),
      };
    case "createApp": {
      if (s.apps.some((ap) => ap.id === a.appId)) return s;
      return {
        ...s,
        apps: [{ id: a.appId, jobId: a.jobId, status: "prepped", updatedLabel: "Just now" }, ...s.apps],
        fields: { ...s.fields, [a.appId]: fieldsFor(a.appId) },
        jobs: s.jobs.map((j) => (j.id === a.jobId ? { ...j, state: "prepped" } : j)),
      };
    }
    case "mobileDetail":
      return { ...s, mobileDetail: a.open };
  }
}

export function sameWeights(a: Weights, b: Weights): boolean {
  return KEYS.every((k) => a[k] === b[k]);
}

/* ---------- Dashboard ---------- */

export interface FunnelStage {
  id: string;
  label: string;
  value: number;
  /** Background class for the bar, e.g. "bg-info". Every stage also carries a label. */
  tone: string;
  /** The drop from the stage before it, e.g. "−241 gated". */
  note?: string;
}

export interface SectorRow {
  id: string;
  label: string;
  count: number;
  kind: "place" | "remote" | "rest";
}

/** One application as the dashboard board shows it: identity, stage, last contact, open action. */
export interface InFlightApp {
  id: string;
  company: string;
  title: string;
  logoUrl: string | null;
  status: AppStatus;
  contact?: AppContact;
  task?: AppTask;
  /** A task due today or overdue. These sort first and carry the follow-up accent. */
  needsAction: boolean;
}

export interface DashboardModel {
  /** Match bands over the current scores; `matches` is strong + maybe. */
  signal: { strong: number; maybe: number; weak: number; matches: number; scored: number };
  today: { newToday: number; followUpsDue: number };
  /** The recon pipeline, widest first: harvested → past gates → scored → matches. */
  funnel: FunnelStage[];
  gated: { closed: number; duplicate: number; blocklist: number; age: number; total: number };
  boards: { active: number; byAts: { ats: string; count: number }[] };
  searchOnly: { total: number; bySource: { source: string; count: number }[] };
  sector: SectorRow[];
  inWhere: { strong: number; maybe: number };
  /** The live applications, urgent first, for the Mission board. */
  inFlight: InFlightApp[];
  apply: { prepared: number; filled: number; submitted: number; followUpsDue: number };
  fill: { ats: string; pct: number; forms: number }[];
  time: { medianMinutes: number; submissions: number };
  spend: {
    modelCalls: number;
    usd: number;
    sources: { name: string; calls: number; budget: number; credits?: number; creditBudget?: number }[];
  };
  logos: { companies: number; withDomain: number; confirmed: number };
  scored: { current: number; stale: number; unscored: number };
  /** 0–100 scores for the signal-spectrum histogram. */
  scores: number[];
}

/**
 * Assembles the dashboard's read-only snapshot. In the app this maps from core's computeStats();
 * here it reshapes the fictional STATS aggregates (data.ts) into view-ready shapes. The live scout
 * state, Run scout and Refresh listings come from the shell (useDemo) in the view, not from here.
 */
export function dashboardModel(state: State): DashboardModel {
  const s = STATS;
  const matches = s.bands.strong + s.bands.maybe;
  const funnel: FunnelStage[] = [
    { id: "harvested", label: "Harvested", value: s.totalJobs, tone: "bg-fg-4" },
    { id: "live", label: "Past the gates", value: s.passed, tone: "bg-info", note: `−${formatGate(s.gated)} gated` },
    {
      id: "scored",
      label: "Scored",
      value: s.scoredCurrent,
      tone: "bg-uv-hi",
      note: `${formatGate(state.unscoredCount)} still unscored`,
    },
    { id: "matches", label: "Matches", value: matches, tone: "bg-brand-hi", note: `${s.bands.strong} strong` },
  ];
  const sector: SectorRow[] = [
    { id: "portland", label: "Portland", count: s.where.portland, kind: "place" },
    { id: "phoenix", label: "Phoenix", count: s.where.phoenix, kind: "place" },
    { id: "remote", label: "Remote", count: s.where.remote, kind: "remote" },
    { id: "elsewhere", label: "Elsewhere", count: s.where.elsewhere, kind: "rest" },
  ];
  const dueRank: Record<AppTask["due"], number> = { overdue: 0, today: 1, soon: 2 };
  const stageRank: Record<AppStatus, number> = {
    interviewing: 0,
    submitted: 1,
    offer: 2,
    prepped: 3,
    rejected: 4,
  };
  const inFlight: InFlightApp[] = state.apps
    .map((app): InFlightApp => {
      const job = state.jobs.find((j) => j.id === app.jobId);
      const company = job?.company ?? app.id;
      return {
        id: app.id,
        company,
        title: job?.title ?? "Application",
        logoUrl: demoLogoUrl(company),
        status: app.status,
        contact: app.contact,
        task: app.task,
        needsAction: app.task != null && (app.task.due === "today" || app.task.due === "overdue"),
      };
    })
    .sort((a, b) => {
      if (a.needsAction !== b.needsAction) return a.needsAction ? -1 : 1;
      const byDue = (a.task ? dueRank[a.task.due] : 9) - (b.task ? dueRank[b.task.due] : 9);
      if (byDue !== 0) return byDue;
      return stageRank[a.status] - stageRank[b.status];
    });
  return {
    signal: {
      strong: s.bands.strong,
      maybe: s.bands.maybe,
      weak: s.bands.weak,
      matches,
      scored: s.scoredCurrent,
    },
    today: { newToday: s.newToday, followUpsDue: s.apply.followUpsDue },
    funnel,
    gated: { ...s.gatedBy, total: s.gated },
    boards: { active: s.boards, byAts: s.boardsByAts },
    searchOnly: s.searchOnly,
    sector,
    inWhere: s.inWhere,
    inFlight,
    apply: s.apply,
    fill: s.fill,
    time: s.time,
    spend: s.spend,
    logos: s.logos,
    scored: { current: s.scoredCurrent, stale: s.scoredStale, unscored: state.unscoredCount },
    scores: SCORE_SAMPLE,
  };
}

function formatGate(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}
