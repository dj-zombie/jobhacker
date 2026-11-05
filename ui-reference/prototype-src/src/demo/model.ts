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
  STATS,
  descriptionFor,
  fieldsFor,
  reasonFor,
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
const BASE_JOBS = JOBS.map((j) =>
  FRAME === "closed" && j.id === "vercel-de" ? { ...j, state: "shortlisted" as const, closed: true } : { ...j },
);
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
