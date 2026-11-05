'use client';

import {
  BAND_LABEL,
  type Density,
  EmptyState,
  FilterChip,
  Hint,
  JobDetail,
  type JobDetailData,
  JobList,
  type JobSummary,
  Kbd,
  ListingsBanner,
  PageHeader,
  PlaceFilter,
  StatTabs,
  type TriageAction,
  TunePanel,
  parseDescription,
  toast,
  toastUndo,
  useHotkeys,
} from '@/components/jobhacker';
import { Button } from '@/components/ui/button';
import { formatCount } from '@/lib/format';
import { useMediaQuery } from '@/lib/use-media-query';
import { cn } from '@/lib/utils';
import {
  Archive,
  Bookmark,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  CircleDashed,
  FileText,
  Inbox,
  type LucideIcon,
  Radar,
  Rows3,
  Rows4,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import {
  DENSITY_EVENT,
  DENSITY_KEY,
  MobileNavButton,
  type TriageCountsView,
  usePaletteTarget,
  useRefreshListings,
  useRunScout,
  useTriageStore,
} from '../../components/app-shell.js';
import type { Bands, Weights } from '../../core/config/schemas.js';
import type { ScoreRunState } from '../../core/pipeline/score-run.js';
import type { JobStatus } from '../../core/pipeline/triage-view.js';
import {
  type TriageView as View,
  inView,
  inWhere,
  newSince,
} from '../../core/pipeline/triage-view.js';
import {
  type TriageWriteResult,
  prepJob,
  saveRankingAction,
  startScoreJob,
  startScoreNext,
  triageJobAction,
  undoTriageAction,
} from '../lib/actions.js';
import { encodeWeights, sameWeights } from '../lib/format.js';
import {
  SEEN_HOURS,
  SEEN_LABEL,
  SEEN_VALUES,
  type Seen,
  TRIAGE_PATH,
  parseSeen,
  parseWhereParam,
  triageQuery,
} from '../lib/triage-url.js';
import {
  type PlaceInfo,
  type TriageDetailData,
  type TriagePageData,
  type TriageRowData,
  headerLogosFor,
  kitWeights,
  scoreOf,
  toDetailData,
  toSummary,
  weightsFromKit,
} from '../lib/triage.js';
import { useLogoEditor } from './LogoEditor';
import { useLogoDomains } from './LogoLookup';
import { UnscoredHero } from './UnscoredHero.js';

const VIEW_META: Record<View, { title: string; icon: LucideIcon; count: keyof TriageCountsView }> =
  {
    top: { title: 'Top matches', icon: Sparkles, count: 'matches' },
    new: { title: 'New today', icon: Inbox, count: 'fresh' },
    shortlist: { title: 'Shortlist', icon: Bookmark, count: 'shortlist' },
    unscored: { title: 'Unscored', icon: CircleDashed, count: 'unscored' },
  };

const SEGMENTS = ['matches', 'strong', 'maybe', 'weak'] as const;
type Segment = (typeof SEGMENTS)[number];

const ACTION_TO_STATUS = {
  shortlist: 'shortlisted',
  skip: 'skipped',
  archive: 'archived',
} as const;
const ACTION_PAST = { shortlist: 'Shortlisted', skip: 'Skipped', archive: 'Archived' } as const;

/** The row's leave animation in JobList runs 200ms; the row goes once it has mostly played. */
const LEAVE_MS = 170;
const POLL_MS = 1000;
const COUNTS_AFTER_MS = 400;

function byRank(a: JobSummary, b: JobSummary): number {
  const s = (b.score ?? -1) - (a.score ?? -1);
  if (s) return s;
  const p = (b.prescore ?? 0) - (a.prescore ?? 0);
  if (p) return p;
  return Number(a.id) - Number(b.id);
}

function readDensity(): Density {
  try {
    return window.localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

function saveDensity(density: Density): void {
  try {
    window.localStorage.setItem(DENSITY_KEY, density);
  } catch {
    // Private mode or storage full: the choice lasts until reload.
  }
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/** "Portland, Phoenix or remote", as the reference's copy reads. */
function placesText(ids: readonly string[], places: ReadonlyMap<string, PlaceInfo>): string {
  const labels = ids.map((id) => {
    const p = places.get(id);
    return p?.kind === 'remote' ? 'remote' : (p?.label ?? id);
  });
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`;
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store', signal });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * The split triage view (J5): the ranked list on the left, the selected job on the right, and on
 * phones the detail as a full-screen sheet. Rows come from the server once; Where, Seen, the band
 * segment and ranking all happen here. Triage writes go to server actions after an optimistic
 * update, and the sidebar counts follow without a reload.
 */
export function TriageView({ view, data }: { view: View; data: TriagePageData }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const store = useTriageStore();
  const runScout = useRunScout();
  const refreshListings = useRefreshListings();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const foundLogos = useLogoDomains();
  const logoEdits = useLogoEditor();
  const meta = VIEW_META[view];

  const known = React.useMemo(() => data.places.map((p) => p.id), [data.places]);
  const places = React.useMemo(
    () => new Map(data.places.map((p) => [p.id, p] as const)),
    [data.places],
  );
  const whereRaw = params.get('where');
  const where = React.useMemo(
    () => parseWhereParam(whereRaw, known, data.whereDefault),
    [whereRaw, known, data.whereDefault],
  );
  const seen = parseSeen(params.get('seen'));
  const segment: Segment =
    view === 'top' ? (SEGMENTS.find((s) => s === params.get('segment')) ?? 'matches') : 'matches';

  /** Where, Seen and the segment live in the URL; replaceState keeps the server out of it. */
  const setUrl = (next: { where?: string[]; seen?: Seen; segment?: Segment }) => {
    const q = new URLSearchParams(
      triageQuery(next.where ?? where, next.seen ?? seen, data.whereDefault, known).slice(1),
    );
    const seg = next.segment ?? segment;
    if (view === 'top' && seg !== 'matches') q.set('segment', seg);
    const s = q.toString().replaceAll('%2C', ',');
    window.history.replaceState(null, '', `${pathname}${s ? `?${s}` : ''}`);
  };
  const viewQuery = triageQuery(where, seen, data.whereDefault, known);

  // Live weights and bands (J6). The saved pair comes from the server; dragging never rescores.
  const savedRanking = data.ranking;
  const savedKey = `${encodeWeights(savedRanking.weights)}:${savedRanking.bands.strong}:${savedRanking.bands.maybe}`;
  const [weights, setWeights] = React.useState<Weights>(savedRanking.weights);
  const [bands, setBands] = React.useState<Bands>(savedRanking.bands);
  const [acked, setAcked] = React.useState(savedRanking);
  const [tuneOpen, setTuneOpen] = React.useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: resync only when the saved ranking changes
  React.useEffect(() => {
    setWeights(savedRanking.weights);
    setBands(savedRanking.bands);
    setAcked(savedRanking);
  }, [savedKey]);
  const ranking = React.useMemo(() => ({ weights, bands }), [weights, bands]);
  const dirty =
    !sameWeights(weights, acked.weights) ||
    bands.strong !== acked.bands.strong ||
    bands.maybe !== acked.bands.maybe;
  const reduceMotion = useReducedMotion();
  const palette = usePaletteTarget();
  React.useEffect(() => {
    palette.setLiveRanking(
      dirty ? `w=${encodeWeights(weights)}&bands=${bands.strong},${bands.maybe}` : '',
    );
    return () => palette.setLiveRanking('');
  }, [dirty, weights, bands, palette.setLiveRanking]);

  const [density, setDensity] = React.useState<Density>('comfortable');
  React.useEffect(() => {
    const apply = () => setDensity(readDensity());
    apply();
    window.addEventListener(DENSITY_EVENT, apply);
    return () => window.removeEventListener(DENSITY_EVENT, apply);
  }, []);
  const toggleDensity = () => {
    const next = density === 'compact' ? 'comfortable' : 'compact';
    saveDensity(next);
    setDensity(next);
  };

  // Rows replaced after Score this job, until the server's rows catch up.
  const [patches, setPatches] = React.useState<ReadonlyMap<number, TriageRowData>>(new Map());
  const [details, setDetails] = React.useState<ReadonlyMap<number, TriageDetailData>>(new Map());
  // biome-ignore lint/correctness/useExhaustiveDependencies: new rows from the server replace local patches and cached details
  React.useEffect(() => {
    setPatches(new Map());
    setDetails(new Map());
  }, [data.rows]);

  const since = React.useMemo(() => newSince(data.nowMs), [data.nowMs]);
  const rows = React.useMemo(() => {
    const out: TriageRowData[] = [];
    for (const r of data.rows) {
      const patched = patches.get(r.id) ?? r;
      const status = store.overrides.get(r.id) ?? patched.status;
      const base = status === patched.status ? patched : { ...patched, status };
      const edit = logoEdits.edits.get(base.company);
      const row = edit
        ? { ...base, domain: edit.domain, logoSource: edit.source, markUrl: edit.markUrl }
        : base.domain
          ? base
          : { ...base, domain: foundLogos.get(base.company) ?? null };
      if (inView(view, { status, dims: row.dims, firstSeenAt: row.seenAt }, since)) out.push(row);
    }
    return out;
  }, [data.rows, patches, store.overrides, view, since, foundLogos, logoEdits.edits]);

  const summaries = React.useMemo(
    () =>
      rows.map((row) => ({
        row,
        s: toSummary(row, ranking, places, data.nowMs, null, data.logoClientId),
      })),
    [rows, ranking, places, data.nowMs, data.logoClientId],
  );

  const segOk = React.useCallback(
    (s: JobSummary) => {
      if (view !== 'top') return true;
      if (segment === 'matches') return s.band !== 'no';
      if (segment === 'weak') return s.band === 'no';
      return s.band === segment;
    },
    [view, segment],
  );

  const { placeCounts, base, items, hidden } = React.useMemo(() => {
    const hours = SEEN_HOURS[seen];
    const seenOk = (x: { s: JobSummary }) => hours === null || x.s.ageHours < hours;
    const seenRows = summaries.filter(seenOk);
    const counts: Record<string, number> = {};
    let elsewhere = 0;
    for (const { row, s } of seenRows) {
      if (!segOk(s)) continue;
      if (!inWhere(row.areas, where)) elsewhere += 1;
      for (const a of row.areas) counts[a] = (counts[a] ?? 0) + 1;
    }
    const inPlace = seenRows.filter((x) => inWhere(x.row.areas, where));
    let older = 0;
    for (const x of summaries) {
      if (!seenOk(x) && segOk(x.s) && inWhere(x.row.areas, where)) older += 1;
    }
    return {
      placeCounts: counts,
      base: inPlace,
      items: inPlace
        .filter((x) => segOk(x.s))
        .map((x) => x.s)
        .sort(byRank),
      // What an empty list is hiding: jobs outside Where, and jobs older than Seen.
      hidden: { elsewhere, older },
    };
  }, [summaries, seen, where, segOk]);

  const segCounts = React.useMemo(() => {
    const c = { strong: 0, maybe: 0, no: 0 };
    for (const { s } of base) if (s.band) c[s.band] += 1;
    return c;
  }, [base]);

  // The sidebar count for this view comes from these rows, so it moves on the key press. The
  // other views' counts are refetched within this Where.
  const ownCount = React.useMemo(() => {
    const inPlace = summaries.filter((x) => inWhere(x.row.areas, where));
    return view === 'top' ? inPlace.filter((x) => x.s.band !== 'no').length : inPlace.length;
  }, [summaries, where, view]);
  const ownCountRef = React.useRef(ownCount);
  ownCountRef.current = ownCount;
  const { setCounts } = store;
  React.useEffect(() => {
    setCounts({ [meta.count]: ownCount });
  }, [setCounts, meta.count, ownCount]);

  const countsTimer = React.useRef<number | undefined>(undefined);
  const rankingRef = React.useRef(ranking);
  rankingRef.current = ranking;
  const ackedRef = React.useRef(acked);
  ackedRef.current = acked;
  const refreshCounts = React.useCallback(
    (delay: number) => {
      window.clearTimeout(countsTimer.current);
      countsTimer.current = window.setTimeout(async () => {
        const q = new URLSearchParams();
        q.set('where', where.length ? where.join(',') : 'anywhere');
        const live = rankingRef.current;
        const base = ackedRef.current;
        const moved =
          !sameWeights(live.weights, base.weights) ||
          live.bands.strong !== base.bands.strong ||
          live.bands.maybe !== base.bands.maybe;
        if (moved) {
          q.set('w', encodeWeights(live.weights));
          q.set('bands', `${live.bands.strong},${live.bands.maybe}`);
        }
        const c = await fetchJson<TriageCountsView>(`/api/triage-counts?${q}`);
        if (c) setCounts({ ...c, [meta.count]: ownCountRef.current });
      }, delay);
    },
    [where, setCounts, meta.count],
  );
  React.useEffect(() => () => window.clearTimeout(countsTimer.current), []);

  const whereKey = where.join(',');
  const mounted = React.useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch when Where or the server's rows change; the layout's counts already cover the default Where on first render
  React.useEffect(() => {
    const first = !mounted.current;
    mounted.current = true;
    if (first && sameSet(where, data.whereDefault)) return;
    refreshCounts(0);
  }, [whereKey, data.rows]);

  const weightsKey = `${encodeWeights(weights)}:${bands.strong}:${bands.maybe}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the sidebar's match count follows a weight while it moves
  React.useEffect(() => {
    if (!dirty) return;
    refreshCounts(200);
  }, [weightsKey, dirty]);

  // A view restored from the router cache (Back) can predate a triage write: read it again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on mount only
  React.useEffect(() => {
    if (store.lastWriteAt > data.nowMs) router.refresh();
  }, []);

  const [selected, setSelected] = React.useState<string | null>(null);
  const selIndex = selected ? items.findIndex((i) => i.id === selected) : -1;
  const selId = selIndex >= 0 ? selected : (items[0]?.id ?? null);
  const index = selIndex >= 0 ? selIndex : selId ? 0 : -1;
  const selNum = selId ? Number(selId) : null;
  const selRow = selNum !== null ? rows.find((r) => r.id === selNum) : undefined;
  const [leavingId, setLeavingId] = React.useState<string | null>(null);
  const [sheet, setSheet] = React.useState(false);
  const backRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (sheet && isMobile) backRef.current?.focus();
  }, [sheet, isMobile]);

  React.useEffect(() => {
    if (!palette.pendingJob || view !== 'top') return;
    setSelected(palette.pendingJob.id);
    if (isMobile) setSheet(true);
    palette.clearPending();
  }, [palette.pendingJob, view, isMobile, palette.clearPending]);

  React.useEffect(() => {
    if (palette.tuneToken === 0) return;
    setTuneOpen(true);
  }, [palette.tuneToken]);

  React.useEffect(() => {
    if (selNum === null || details.has(selNum)) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      const d = await fetchJson<TriageDetailData>(`/api/job/${selNum}`, ctrl.signal);
      if (d) setDetails((prev) => new Map(prev).set(selNum, d));
    }, 60);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [selNum, details]);

  const loaded = selNum !== null ? details.get(selNum) : undefined;
  const detail: JobDetailData | null = React.useMemo(() => {
    if (!selRow) return null;
    if (loaded) {
      const d = toDetailData(
        {
          ...loaded,
          row: {
            ...loaded.row,
            status: selRow.status,
            domain: logoEdits.edits.has(selRow.company)
              ? selRow.domain
              : (loaded.row.domain ?? selRow.domain),
            logoSource: logoEdits.edits.has(selRow.company)
              ? selRow.logoSource
              : loaded.row.logoSource,
            markUrl: logoEdits.edits.has(selRow.company) ? selRow.markUrl : loaded.row.markUrl,
          },
        },
        ranking,
        places,
        data.nowMs,
        data.logoClientId,
      );
      return { ...d, description: parseDescription(loaded.description) };
    }
    return {
      ...toSummary(selRow, ranking, places, data.nowMs, null, data.logoClientId),
      ...headerLogosFor(selRow, data.logoClientId),
      employment: '…',
      postedLabel: '…',
      confirmedLabel: '…',
    };
  }, [selRow, loaded, ranking, places, data.nowMs, data.logoClientId, logoEdits.edits]);

  const select = (id: string | null) => setSelected(id);
  const move = (d: number) => {
    if (!items.length) return;
    const next = items[Math.max(0, Math.min(items.length - 1, (index < 0 ? 0 : index) + d))];
    if (next) select(next.id);
  };

  // The latest store and count refresher, for toast callbacks that outlive this render.
  const live = React.useRef({ store, refreshCounts });
  live.current = { store, refreshCounts };

  const [history, setHistory] = React.useState<number[]>([]);

  const write = (jobId: number, run: () => Promise<TriageWriteResult>, revertTo: JobStatus) => {
    run()
      .catch((err: unknown): TriageWriteResult => ({ ok: false, error: String(err) }))
      .then((res) => {
        const { store: s, refreshCounts: refresh } = live.current;
        if (res.ok) {
          s.markWrite();
          refresh(COUNTS_AFTER_MS);
        } else {
          s.setStatus(jobId, revertTo);
          toast("Couldn't save that", {
            description: res.error,
            icon: <TriangleAlert className="text-danger" />,
          });
        }
      });
  };

  const undo = (jobId: number, label: string) => {
    setHistory((h) => {
      const i = h.lastIndexOf(jobId);
      return i < 0 ? h : [...h.slice(0, i), ...h.slice(i + 1)];
    });
    undoTriageAction(jobId)
      .catch((err: unknown): TriageWriteResult => ({ ok: false, error: String(err) }))
      .then((res) => {
        const { store: s, refreshCounts: refresh } = live.current;
        if (res.ok) {
          s.setStatus(jobId, res.to);
          s.markWrite();
          refresh(COUNTS_AFTER_MS);
          setSelected(String(jobId));
          toast('Restored', { description: label });
        } else {
          toast("Couldn't undo", {
            description: res.error,
            icon: <TriangleAlert className="text-danger" />,
          });
        }
      });
  };

  const [preparing, setPreparing] = React.useState<number | null>(null);
  const prepare = async (jobId: number) => {
    const row = rows.find((r) => r.id === jobId);
    if (!row || preparing !== null) return;
    setPreparing(jobId);
    const id = toast.loading('Preparing application', {
      description: `${row.title} at ${row.company}. Tailoring the resume, cover note and answers.`,
    });
    try {
      const res = await prepJob(jobId);
      if (res.ok) {
        const open = res.needsInput?.length ?? 0;
        toast('Prepared application', {
          id,
          description: `${row.title} at ${row.company}. ${
            open
              ? `${open} ${open === 1 ? 'item needs' : 'items need'} your input.`
              : 'Ready to review.'
          }`,
          icon: <FileText className="text-brand-hi" />,
        });
        store.markWrite();
        router.push(
          res.applicationId === undefined
            ? `/application/${jobId}`
            : `/applications/${res.applicationId}`,
        );
      } else {
        toast("Couldn't prepare the application", {
          id,
          description: res.error,
          icon: <TriangleAlert className="text-danger" />,
        });
      }
    } finally {
      setPreparing(null);
    }
  };

  const act = (id: string, action: TriageAction) => {
    const jobId = Number(id);
    const row = rows.find((r) => r.id === jobId);
    if (!row) return;
    if (action === 'open') {
      window.open(`/job/${jobId}/posting`, '_blank', 'noopener,noreferrer');
      return;
    }
    if (view === 'shortlist' && action === 'shortlist') {
      void prepare(jobId);
      return;
    }
    if (leavingId) return;
    const at = items.findIndex((i) => i.id === id);
    const next = items[at + 1] ?? items[at - 1] ?? null;
    const from = row.status;
    const to = ACTION_TO_STATUS[action];
    const label = `${row.title} · ${row.company}`;
    const wasSelected = id === selId;
    setLeavingId(id);
    window.setTimeout(() => {
      live.current.store.setStatus(jobId, to);
      if (wasSelected) setSelected(next?.id ?? null);
      setLeavingId(null);
      write(jobId, () => triageJobAction(jobId, action), from);
    }, LEAVE_MS);
    setHistory((h) => [...h, jobId]);
    const Icon = action === 'shortlist' ? Bookmark : action === 'skip' ? X : Archive;
    toastUndo(ACTION_PAST[action], () => undo(jobId, label), {
      description: label,
      icon: <Icon className={action === 'shortlist' ? 'text-brand-hi' : 'text-fg-3'} />,
    });
  };

  const [run, setRun] = React.useState<ScoreRunState | null>(data.liveRun);
  const [starting, setStarting] = React.useState(false);
  const runId = run?.running ? run.runId : null;
  React.useEffect(() => {
    if (runId === null) return;
    const t = window.setInterval(async () => {
      const next = await fetchJson<ScoreRunState>(`/api/score-run/${runId}`);
      if (next) setRun(next);
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [runId]);

  const finishedRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!run || run.running || finishedRef.current === run.runId) return;
    finishedRef.current = run.runId;
    if (data.liveRun?.runId !== run.runId && !run.jobIds && run.progress.total === 0 && run.ok) {
      toast('Nothing to score', { description: 'Every job past the gates has a current score.' });
      return;
    }
    if (run.jobIds?.length === 1) {
      const jobId = run.jobIds[0] ?? 0;
      void fetchJson<TriageDetailData>(`/api/job/${jobId}`).then((d) => {
        if (!d) return;
        setPatches((prev) => new Map(prev).set(jobId, d.row));
        setDetails((prev) => new Map(prev).set(jobId, d));
        live.current.refreshCounts(0);
        const { score, band } = scoreOf(d.row.dims, rankingRef.current);
        if (score !== null && band) {
          toast(`Scored ${score}, ${BAND_LABEL[band].toLowerCase()}`, {
            description: `${d.row.title} at ${d.row.company}. 1 model call.`,
            icon: <Sparkles className="text-strong" />,
          });
        } else {
          toast("Couldn't score this job", {
            description: run.error ?? 'The model call failed; it stays in Unscored.',
            icon: <TriangleAlert className="text-danger" />,
          });
        }
      });
      return;
    }
    if (run.abandoned || run.ok === false) {
      toast('Scoring stopped', {
        description:
          run.error ?? `${run.progress.done} of ${run.progress.total} were scored first.`,
        icon: <TriangleAlert className="text-danger" />,
      });
    } else {
      const { done, found } = run.progress;
      toast(`Scored ${formatCount(done)} ${done === 1 ? 'job' : 'jobs'}`, {
        description:
          found === 0
            ? 'No new matches this time.'
            : `${formatCount(found)} new ${found === 1 ? 'match' : 'matches'}. They're in Top matches now.`,
        icon: <Sparkles className="text-strong" />,
        action:
          found === 0
            ? undefined
            : { label: 'View', onClick: () => router.push(`${TRIAGE_PATH.top}${viewQuery}`) },
      });
    }
    router.refresh();
  }, [run, data.liveRun, router, viewQuery]);

  const startRun = async (
    start: () => ReturnType<typeof startScoreNext>,
    jobIds: number[] | null,
  ) => {
    if (run?.running) {
      toast('A score run is going', { description: 'Wait for it to finish, then try again.' });
      return;
    }
    setStarting(true);
    try {
      const res = await start().catch(
        (err: unknown): Awaited<ReturnType<typeof startScoreNext>> => ({
          ok: false,
          error: String(err),
        }),
      );
      if (!res.ok) {
        toast("Couldn't start scoring", {
          description: res.error,
          icon: <TriangleAlert className="text-danger" />,
        });
        return;
      }
      setRun({
        runId: res.runId,
        running: true,
        ok: null,
        error: null,
        abandoned: false,
        progress: { done: 0, total: jobIds ? 1 : 0, found: 0 },
        first: where,
        jobIds,
        beatAt: null,
      });
    } finally {
      setStarting(false);
    }
  };
  const scoreNext = () => startRun(() => startScoreNext(where), null);
  const scoreOne = (jobId: number) => startRun(() => startScoreJob(jobId), [jobId]);

  const changeWhere = (next: string[]) => setUrl({ where: next });
  const changeSegment = (next: Segment) => setUrl({ segment: next });

  const sliderFocused = () =>
    document.activeElement instanceof HTMLElement &&
    document.activeElement.getAttribute('role') === 'slider';

  useHotkeys({
    j: () => move(1),
    arrowdown: () => {
      if (!sliderFocused()) move(1);
    },
    k: () => move(-1),
    arrowup: () => {
      if (!sliderFocused()) move(-1);
    },
    s: () => selId && act(selId, 'shortlist'),
    x: () => selId && act(selId, 'skip'),
    a: () => selId && act(selId, 'archive'),
    o: () => selId && act(selId, 'open'),
    u: () => {
      if (leavingId) return;
      const last = history.at(-1);
      if (last === undefined) return;
      const row = data.rows.find((r) => r.id === last);
      undo(last, row ? `${row.title} · ${row.company}` : 'The last triage action was undone.');
    },
    d: toggleDensity,
    t: () => setTuneOpen((open) => !open),
    '1': () => view === 'top' && changeSegment('matches'),
    '2': () => view === 'top' && changeSegment('strong'),
    '3': () => view === 'top' && changeSegment('maybe'),
    enter: () => {
      if (isMobile && selId) setSheet(true);
    },
    escape: () => {
      if (tuneOpen) setTuneOpen(false);
      else setSheet(false);
    },
  });

  const anywhere = where.length === 0;
  const whereText = placesText(where, places);
  const noun = (n: number) => {
    const one = n === 1;
    if (view === 'top') {
      if (segment === 'weak') return one ? 'weak job' : 'weak jobs';
      const band = segment === 'matches' ? '' : `${segment} `;
      return one ? `${band}match` : `${band}matches`;
    }
    if (view === 'new') return one ? 'new job' : 'new jobs';
    if (view === 'shortlist') return one ? 'shortlisted job' : 'shortlisted jobs';
    return one ? 'unscored job' : 'unscored jobs';
  };
  const are = (n: number) => (n === 1 ? 'is' : 'are');

  const empty =
    !anywhere && hidden.elsewhere > 0 ? (
      <EmptyState
        icon={meta.icon}
        title={`No ${noun(2)} in ${whereText}${view === 'top' ? ' yet' : ''}`}
        body={`${formatCount(hidden.elsewhere)} ${noun(hidden.elsewhere)} ${are(hidden.elsewhere)} elsewhere. Look anywhere to see ${hidden.elsewhere === 1 ? 'it' : 'them'}.`}
        action={
          <Button size="sm" variant="secondary" onClick={() => changeWhere([])}>
            Look anywhere
          </Button>
        }
      />
    ) : seen !== 'any' && hidden.older > 0 ? (
      <EmptyState
        icon={meta.icon}
        title={`No ${noun(2)} first seen in the ${SEEN_LABEL[seen].toLowerCase()}`}
        body={`${formatCount(hidden.older)} older ${noun(hidden.older)} ${are(hidden.older)} hidden by Seen.`}
        action={
          <Button size="sm" variant="secondary" onClick={() => setUrl({ seen: 'any' })}>
            Show any time
          </Button>
        }
      />
    ) : view === 'top' ? (
      <EmptyState
        icon={Sparkles}
        title={segment === 'matches' ? 'No matches left to triage' : 'Nothing in this band'}
        body="Score more jobs to find new matches."
        action={
          <Button size="sm" asChild>
            <Link href={`${TRIAGE_PATH.unscored}${viewQuery}`}>
              <Sparkles />
              Score more jobs
            </Link>
          </Button>
        }
      />
    ) : view === 'shortlist' ? (
      <EmptyState
        icon={Bookmark}
        title="Nothing shortlisted yet"
        body={
          <>
            Press <Kbd>S</Kbd> on a job in Top matches to keep it here until you prepare an
            application.
          </>
        }
        action={
          <Button size="sm" variant="secondary" asChild>
            <Link href={`${TRIAGE_PATH.top}${viewQuery}`}>Go to Top matches</Link>
          </Button>
        }
      />
    ) : view === 'new' ? (
      <EmptyState
        icon={Inbox}
        title="Nothing new in the last 24 hours"
        body="Run the scout to check all boards for new postings now."
        action={
          <Button size="sm" onClick={runScout}>
            <Radar />
            Run scout
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={CircleDashed}
        title="Everything is scored"
        body="New postings from the next scout will appear here."
      />
    );

  const tuneScores = React.useMemo(() => {
    const scores: number[] = [];
    for (const { s } of summaries) if (s.score != null) scores.push(s.score);
    return scores;
  }, [summaries]);
  const tuneBands = React.useMemo(() => {
    const c = { strong: 0, maybe: 0, no: 0 };
    for (const { s } of summaries) if (s.band) c[s.band] += 1;
    return c;
  }, [summaries]);
  const saving = React.useRef(false);
  const onSaveRanking = () => {
    if (saving.current || !dirty) return;
    saving.current = true;
    void saveRankingAction(weights, bands)
      .then((res) => {
        if (!res.ok) {
          toast("Couldn't save ranking", {
            description: res.error,
            icon: <TriangleAlert className="text-danger" />,
          });
          return;
        }
        setAcked({ weights, bands });
        toast('Saved to criteria.yaml', {
          description: 'The next scout ranks with these weights too.',
          icon: <SlidersHorizontal className="text-brand-hi" />,
        });
      })
      .finally(() => {
        saving.current = false;
      });
  };

  const tune = (
    <TunePanel
      weights={kitWeights(weights)}
      onWeightsChange={(next) => setWeights(weightsFromKit(next))}
      thresholds={bands}
      onThresholdsChange={(next) => setBands(next)}
      scores={tuneScores}
      bandCounts={tuneBands}
      dirty={dirty}
      apiCalls={0}
      onSave={onSaveRanking}
      onReset={() => {
        setWeights(acked.weights);
        setBands(acked.bands);
      }}
      onClose={() => setTuneOpen(false)}
    />
  );

  const detailEl = detail ? (
    <JobDetail
      job={detail}
      onAction={(a) => act(detail.id, a)}
      onTune={() => setTuneOpen(true)}
      onEditLogo={() => logoEdits.openPicker(detail.company)}
      onScore={detail.score == null ? () => void scoreOne(Number(detail.id)) : undefined}
      context={{
        label: meta.title,
        dock: anywhere ? 'anywhere' : whereText,
        index: index + 1,
        total: items.length,
      }}
      primary={
        view === 'shortlist'
          ? {
              label: preparing === Number(detail.id) ? 'Preparing…' : 'Prepare application',
              icon: <FileText />,
              onClick: () => void prepare(Number(detail.id)),
              kbd: 'S',
            }
          : undefined
      }
    />
  ) : null;

  const tuneButton = (
    <Hint label="Tune ranking" shortcut="T" side="bottom">
      <Button
        variant={tuneOpen ? 'secondary' : 'outline'}
        size="sm"
        aria-label="Tune ranking"
        onClick={() => setTuneOpen((open) => !open)}
        className={tuneOpen ? 'text-brand-hi' : undefined}
      >
        <SlidersHorizontal />
        <span className="max-sm:hidden">Tune</span>
        <Kbd className="-mr-1 h-4 min-w-4 max-xl:hidden">T</Kbd>
      </Button>
    </Hint>
  );

  const densityButton = (
    <Hint
      label={density === 'compact' ? 'Comfortable rows' : 'Compact rows'}
      shortcut="D"
      side="bottom"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={density === 'compact' ? 'Use comfortable rows' : 'Use compact rows'}
        onClick={toggleDensity}
      >
        {density === 'compact' ? <Rows3 /> : <Rows4 />}
      </Button>
    </Hint>
  );

  const batch = run?.running && !run.jobIds ? run : null;
  const firstIds = anywhere ? data.whereDefault : where;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        icon={meta.icon}
        kicker="Triage"
        title={meta.title}
        art="/art/deck-skull.webp"
        glitchKey={`${segment}|${where.join(',')}`}
        count={view === 'top' ? undefined : formatCount(items.length)}
        leading={<MobileNavButton />}
        actions={
          <>
            {tuneButton}
            {densityButton}
          </>
        }
        toolbar={
          <>
            <PlaceFilter
              value={where}
              onChange={changeWhere}
              options={data.places.map((p) => ({ ...p, count: placeCounts[p.id] ?? 0 }))}
            />
            <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-line-2 max-md:hidden" />
            <FilterChip<Seen>
              label="Seen"
              value={seen}
              defaultValue="any"
              onChange={(v) => setUrl({ seen: v })}
              options={SEEN_VALUES.map((v) => ({ value: v, label: SEEN_LABEL[v] }))}
            />
            <span className="ml-auto flex shrink-0 items-baseline gap-1.5 max-sm:hidden">
              <span className="font-display text-base font-semibold tnum text-fg">
                {formatCount(items.length)}
              </span>
              <span className="hud-label text-fg-3">
                {items.length === 1 ? 'job' : 'jobs'}, by{' '}
                {view === 'unscored' ? 'prescore' : 'rank'}
              </span>
            </span>
            <span className="ml-3 hidden shrink-0 items-center gap-1 text-2xs text-fg-4 xl:inline-flex">
              <Kbd>J</Kbd>
              <Kbd>K</Kbd> move
            </span>
          </>
        }
      >
        {view === 'top' ? (
          <StatTabs<Segment>
            aria-label="Match band"
            value={segment}
            onChange={changeSegment}
            parts={[
              { id: 'strong', count: segCounts.strong, tone: 'bg-strong' },
              { id: 'maybe', count: segCounts.maybe, tone: 'bg-maybe' },
              { id: 'weak', count: segCounts.no, tone: 'bg-no' },
            ]}
            options={[
              {
                value: 'matches',
                label: 'All matches',
                shortLabel: 'All',
                count: segCounts.strong + segCounts.maybe,
                covers: ['strong', 'maybe'],
                kbd: '1',
                hint: `Strong and Maybe: a score of ${bands.maybe} or more.`,
              },
              {
                value: 'strong',
                label: 'Strong',
                count: segCounts.strong,
                dot: 'bg-strong',
                covers: ['strong'],
                kbd: '2',
                hint: `A score of ${bands.strong} or more.`,
              },
              {
                value: 'maybe',
                label: 'Maybe',
                count: segCounts.maybe,
                dot: 'bg-maybe',
                covers: ['maybe'],
                kbd: '3',
                hint: `A score from ${bands.maybe} to ${bands.strong - 1}.`,
              },
              {
                value: 'weak',
                label: 'Weak',
                count: segCounts.no,
                dot: 'bg-no',
                covers: ['weak'],
                hint: `A score under ${bands.maybe}.`,
              },
            ]}
          />
        ) : null}
      </PageHeader>

      {data.banner ? (
        <ListingsBanner checkedOn={data.banner.checkedOn} onRefresh={refreshListings} />
      ) : null}

      {view === 'unscored' && data.scoring ? (
        <UnscoredHero
          summary={data.scoring}
          run={batch}
          firstLabel={placesText(firstIds, places)}
          starting={starting}
          onScore={() => void scoreNext()}
        />
      ) : null}

      <p className="sr-only" aria-live="polite">
        {selRow ? `${selRow.title} at ${selRow.company}` : ''}
      </p>
      <div className="flex min-h-0 min-w-0 flex-1 overflow-x-hidden">
        <div
          className={cn(
            'min-h-0',
            'overflow-x-hidden',
            isMobile ? 'w-full' : 'w-[44%] min-w-[340px] max-w-[600px] border-r border-line',
          )}
        >
          <JobList
            items={items}
            selectedId={selId}
            leavingId={leavingId}
            density={density}
            aria-label={meta.title}
            onSelect={(id) => {
              select(id);
              if (isMobile) setSheet(true);
            }}
            onAction={act}
            emptyState={empty}
          />
        </div>

        {isMobile ? null : (
          <div className="relative min-h-0 min-w-0 flex-1">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={tuneOpen ? 'tune' : 'detail'}
                initial={reduceMotion ? false : { opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduceMotion ? { opacity: 1 } : { opacity: 0, x: -8 }}
                transition={
                  reduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.16, 1, 0.3, 1] }
                }
                className="absolute inset-0"
              >
                {tuneOpen
                  ? tune
                  : (detailEl ?? (
                      <EmptyState
                        still
                        icon={meta.icon}
                        title="Select a job"
                        body="Pick a job on the left to see why it ranked where it did."
                      />
                    ))}
              </motion.div>
            </AnimatePresence>
          </div>
        )}
      </div>

      {isMobile && tuneOpen ? (
        <div className="fixed inset-0 z-40 flex flex-col bg-panel pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] animate-sheet-in">
          {tune}
        </div>
      ) : null}

      {isMobile && sheet && detailEl && !tuneOpen ? (
        <div className="fixed inset-0 z-40 flex flex-col bg-panel pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] animate-sheet-in">
          <div className="flex items-center gap-1 border-b border-line px-2 py-1.5 pr-[max(8px,env(safe-area-inset-right,0px))]">
            <Button
              ref={backRef}
              variant="ghost"
              size="sm"
              aria-label="Back"
              onClick={() => setSheet(false)}
              className="min-h-10"
            >
              <ChevronLeft />
              {meta.title}
            </Button>
            <span className="ml-auto text-xs tnum text-fg-3">
              {index + 1} of {formatCount(items.length)}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous job"
              onClick={() => move(-1)}
            >
              <ChevronUp />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Next job" onClick={() => move(1)}>
              <ChevronDown />
            </Button>
          </div>
          <div className="min-h-0 flex-1">{detailEl}</div>
        </div>
      ) : null}
    </div>
  );
}
