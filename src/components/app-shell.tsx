'use client';

import {
  AppSidebar,
  AppToaster,
  CommandPalette,
  type NavSection,
  type PaletteGroup,
  type ResetCounts,
  ResetDialog,
  ScoutCard,
  type ShortcutGroup,
  ShortcutsDialog,
  toast,
  useHotkeys,
} from '@/components/jobhacker';
import { CompanyLogo } from '@/components/jobhacker/company-logo';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { TooltipProvider } from '@/components/ui/tooltip';
import { formatCompact, formatCount } from '@/lib/format';
import { type SidebarPreference, sidebarCookie, sidebarIsRail } from '@/lib/sidebar-preference';
import { useMediaQuery } from '@/lib/use-media-query';
import {
  BellRing,
  Bookmark,
  CircleDashed,
  Eraser,
  FileText,
  Images,
  Inbox,
  Keyboard,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  PowerOff,
  Radar,
  RefreshCw,
  Rows3,
  Send,
  Settings,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react';
import { MotionConfig } from 'motion/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { LogoEditor, useLogoEditor } from '../app/components/LogoEditor.js';
import { LogoDomainProvider, LogoLookup } from '../app/components/LogoLookup.js';
import {
  type MoveBoardResult,
  confirmReset,
  loadResetPlan,
  moveBoardToCandidate,
  moveBoardToLink,
  refreshListings,
  runScoutNow,
  turnOffBoard,
} from '../app/lib/actions.js';
import type {
  PaletteJob,
  ScoutCardView,
  ScoutRunView,
  ShellCounts,
} from '../app/lib/shell-types.js';
import { TRIAGE_PATH, paletteJobHref } from '../app/lib/triage-url.js';
import type { JobStatus } from '../core/pipeline/triage-view.js';

const POLL_MS = 1000;

/** The shortcuts dialog. Same groups as the reference's `SHORTCUTS`. */
const SHORTCUTS: ShortcutGroup[] = [
  {
    heading: 'Triage',
    items: [
      { keys: ['J'], label: 'Next job' },
      { keys: ['K'], label: 'Previous job' },
      { keys: ['S'], label: 'Shortlist' },
      { keys: ['X'], label: 'Skip' },
      { keys: ['A'], label: 'Archive' },
      { keys: ['O'], label: 'Open posting' },
      { keys: ['U'], label: 'Undo last action' },
    ],
  },
  {
    heading: 'Views',
    items: [
      { keys: ['1'], label: 'All matches' },
      { keys: ['2'], label: 'Strong only' },
      { keys: ['3'], label: 'Maybe only' },
      { keys: ['T'], label: 'Tune ranking' },
      { keys: ['D'], label: 'Toggle density' },
    ],
  },
  {
    heading: 'Anywhere',
    items: [
      { keys: ['⌘', 'K'], label: 'Search and commands' },
      { keys: ['⌘', 'B'], label: 'Collapse or expand the sidebar' },
      { keys: ['?'], label: 'This list' },
      { keys: ['Esc'], label: 'Close panel or dialog' },
    ],
  },
];

export const DENSITY_KEY = 'jobhacker.density';
export const DENSITY_EVENT = 'jobhacker-density';

function readDensity(): 'compact' | 'comfortable' {
  try {
    return window.localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

function toggleStoredDensity(): void {
  const next = readDensity() === 'compact' ? 'comfortable' : 'compact';
  try {
    window.localStorage.setItem(DENSITY_KEY, next);
  } catch {
    // A private window with storage disabled still toggles for this page via the event.
  }
  window.dispatchEvent(new Event(DENSITY_EVENT));
}

export type TriageCountsView = Pick<ShellCounts, 'matches' | 'fresh' | 'shortlist' | 'unscored'>;

/**
 * Triage state that outlives one view (J5). A triage action writes in the background, so a view
 * restored from the router's cache (Back) can hold rows from before it. `overrides` carries each
 * job's latest status across views, and `lastWriteAt` tells a restored view to refresh.
 */
export interface TriageStore {
  overrides: ReadonlyMap<number, JobStatus>;
  setStatus: (jobId: number, status: JobStatus) => void;
  /** Counts that replace the layout's until it re-renders. Absolute numbers, not deltas. */
  setCounts: (counts: Partial<ShellCounts>) => void;
  /** Client time of the last triage write the server confirmed. */
  lastWriteAt: number;
  markWrite: () => void;
}

interface ShellContext {
  openMobileNav: () => void;
  runScout: () => void;
  refreshListings: () => void;
  triage: TriageStore;
  /** A job chosen in ⌘K. The triage view selects it, then clears it. */
  pendingJob: { id: string; token: number } | null;
  clearPending: () => void;
  /** Bumped when ⌘K asks for the tune panel. */
  tuneToken: number;
  /** The tune panel's live `w` and `bands` query, or '' for the saved ranking. */
  setLiveRanking: (query: string) => void;
  /** Add to the sidebar counts until the layout refreshes. */
  adjustCounts: (delta: Partial<Record<keyof ShellCounts, number>>) => void;
}

const noop = () => {};

const Ctx = React.createContext<ShellContext>({
  openMobileNav: noop,
  runScout: noop,
  refreshListings: noop,
  triage: {
    overrides: new Map(),
    setStatus: noop,
    setCounts: noop,
    lastWriteAt: 0,
    markWrite: noop,
  },
  pendingJob: null,
  clearPending: noop,
  tuneToken: 0,
  setLiveRanking: noop,
  adjustCounts: noop,
});

export function useTriageStore(): TriageStore {
  return React.useContext(Ctx).triage;
}

/** The sidebar's Run scout, for an empty New today. */
export function useRunScout(): () => void {
  return React.useContext(Ctx).runScout;
}

/** Refresh listings, from the scout card and the stale banner. */
export function useRefreshListings(): () => void {
  return React.useContext(Ctx).refreshListings;
}

/** ⌘K's selected job, and the tune-panel request. The triage view consumes both. */
export function usePaletteTarget(): {
  pendingJob: { id: string; token: number } | null;
  clearPending: () => void;
  tuneToken: number;
  setLiveRanking: (query: string) => void;
} {
  const ctx = React.useContext(Ctx);
  return {
    pendingJob: ctx.pendingJob,
    clearPending: ctx.clearPending,
    tuneToken: ctx.tuneToken,
    setLiveRanking: ctx.setLiveRanking,
  };
}

/** Add to the sidebar counts until the layout refreshes. A status change uses this so the
 * sidebar doesn't wait on the layout. */
export function useAdjustCounts(): (delta: Partial<Record<keyof ShellCounts, number>>) => void {
  return React.useContext(Ctx).adjustCounts;
}

/** The menu button a page header shows on phones; it opens the sidebar as a drawer. */
export function MobileNavButton() {
  const { openMobileNav } = React.useContext(Ctx);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Open navigation"
      onClick={openMobileNav}
      className="md:hidden"
    >
      <Menu />
    </Button>
  );
}

const TRIAGE_PATHS: readonly string[] = Object.values(TRIAGE_PATH);

/** Settings opens on its first section (J18). */
export const SETTINGS_HREF = '/settings/profile';

const APPLICATION_LISTS: readonly string[] = [
  '/applications/submitted',
  '/applications/follow-ups',
];

/**
 * Which nav item a URL belongs to, without the triage views' `where` and `seen`. A workspace,
 * `/applications/<id>`, belongs to In progress (UI-KIT § App shell).
 * `/?view=review|ranked` redirects to Top matches (J6).
 */
export function activeHrefFor(pathname: string, view: string | null): string {
  if (pathname === '/') return view === null ? '/' : '';
  if (TRIAGE_PATHS.includes(pathname)) return pathname;
  if (APPLICATION_LISTS.includes(pathname)) return pathname;
  if (pathname === '/applications' || pathname.startsWith('/applications/')) return '/applications';
  if (pathname === '/companies') return '/companies';
  if (pathname === '/settings' || pathname.startsWith('/settings/')) return SETTINGS_HREF;
  return '';
}

/** The triage view's `where` and `seen`, which the sidebar's triage links carry. */
function triageQueryOf(params: URLSearchParams): string {
  const p = new URLSearchParams();
  for (const key of ['where', 'seen']) {
    const value = params.get(key);
    if (value) p.set(key, value);
  }
  const q = p.toString().replaceAll('%2C', ',');
  return q ? `?${q}` : '';
}

function sectionsFor(
  counts: ShellCounts | null,
  query: string,
  logosMissing: number | undefined,
  onStartFresh: () => void,
): NavSection[] {
  const c = counts;
  return [
    {
      label: 'Triage',
      items: [
        {
          href: `${TRIAGE_PATH.top}${query}`,
          label: 'Top matches',
          icon: Sparkles,
          count: c ? formatCount(c.matches) : undefined,
          countTone: 'brand',
        },
        {
          href: `${TRIAGE_PATH.new}${query}`,
          label: 'New today',
          icon: Inbox,
          count: c ? formatCount(c.fresh) : undefined,
        },
        {
          href: `${TRIAGE_PATH.shortlist}${query}`,
          label: 'Shortlist',
          icon: Bookmark,
          count: c ? formatCount(c.shortlist) : undefined,
        },
        {
          href: `${TRIAGE_PATH.unscored}${query}`,
          label: 'Unscored',
          icon: CircleDashed,
          count: c ? formatCompact(c.unscored) : undefined,
        },
      ],
    },
    {
      label: 'Applications',
      items: [
        { href: '/applications', label: 'In progress', icon: FileText, count: c?.inProgress },
        {
          href: '/applications/submitted',
          label: 'Submitted',
          icon: Send,
          count: c?.submitted,
        },
        {
          href: '/applications/follow-ups',
          label: 'Follow-ups',
          icon: BellRing,
          count: c?.followUps,
          countTone: c?.followUps ? 'maybe' : 'default',
        },
      ],
    },
    {
      label: 'Setup',
      items: [
        { href: '/companies', label: 'Company logos', icon: Images, count: logosMissing },
        { href: SETTINGS_HREF, label: 'Settings', icon: Settings },
        { label: 'Start fresh', icon: Eraser, onSelect: onStartFresh },
      ],
    },
  ];
}

async function fetchCard(): Promise<ScoutCardView | null> {
  try {
    const res = await fetch('/api/scout-card', { cache: 'no-store' });
    return res.ok ? ((await res.json()) as ScoutCardView | null) : null;
  } catch {
    return null;
  }
}

async function fetchRun(id: number): Promise<ScoutRunView | null> {
  try {
    const res = await fetch(`/api/scout-run/${id}`, { cache: 'no-store' });
    return res.ok ? ((await res.json()) as ScoutRunView) : null;
  } catch {
    return null;
  }
}

/** The sidebar, the inset main panel and the toaster around every page (UI-KIT § The shell). */
interface ShellProps {
  counts: ShellCounts | null;
  scout: ScoutCardView | null;
  /** The sidebar badge, from profile.yaml; null when the config can't be read. */
  user: { name: string; initials: string } | null;
  /** Companies still missing a domain, and the client id the browser searches with. */
  logos?: { clientId: string | null; names: string[] };
  /** Places a triage URL uses when `where` is absent. */
  whereDefault?: string[];
  /** Pinned on a wide window. The root layout reads it from the cookie. */
  sidebar?: SidebarPreference;
  children?: React.ReactNode;
}

export function AppShell({ children, ...props }: ShellProps) {
  return (
    <LogoEditor clientId={props.logos?.clientId ?? null}>
      <React.Suspense
        fallback={
          <ShellFrame {...props} activeHref="" query="" onTriage={false}>
            {children}
          </ShellFrame>
        }
      >
        <ShellWithRoute {...props}>{children}</ShellWithRoute>
      </React.Suspense>
    </LogoEditor>
  );
}

function ShellWithRoute(props: ShellProps) {
  const pathname = usePathname();
  const params = useSearchParams();
  const onTriage = TRIAGE_PATHS.includes(pathname) && params.get('view') === null;
  const current = onTriage ? triageQueryOf(params) : null;
  // Off the triage views, the links keep the Where and Seen the last triage view had.
  const [last, setLast] = React.useState('');
  React.useEffect(() => {
    if (current !== null) setLast(current);
  }, [current]);
  const query = current ?? last;
  const active = activeHrefFor(pathname, params.get('view'));
  return (
    <ShellFrame
      {...props}
      query={query}
      onTriage={current !== null}
      activeHref={TRIAGE_PATHS.includes(active) ? `${active}${query}` : active}
    />
  );
}

function ShellFrame({
  counts,
  scout,
  user,
  logos,
  activeHref,
  query,
  onTriage,
  whereDefault = [],
  sidebar = 'expanded',
  children,
}: ShellProps & { activeHref: string; query: string; onTriage: boolean }) {
  const router = useRouter();
  const [foundLogos, setFoundLogos] = React.useState<ReadonlyMap<string, string>>(new Map());
  const noteLogo = React.useCallback((name: string, domain: string) => {
    setFoundLogos((prev) => {
      if (prev.get(name) === domain) return prev;
      const next = new Map(prev);
      next.set(name, domain);
      return next;
    });
  }, []);
  const [overrides, setOverrides] = React.useState<ReadonlyMap<number, JobStatus>>(new Map());
  const [lastWriteAt, setLastWriteAt] = React.useState(0);
  // A view's counts hold only against the layout counts they were pushed over: a refresh or a
  // scout brings newer layout counts, and the view pushes again if it's still open.
  const [viewCounts, setViewCounts] = React.useState<{
    value: Partial<ShellCounts>;
    basis: ShellCounts | null;
  } | null>(null);
  const basis = React.useRef(counts);
  basis.current = counts;
  const triage = React.useMemo<TriageStore>(
    () => ({
      overrides,
      setStatus: (jobId, status) => setOverrides((prev) => new Map(prev).set(jobId, status)),
      setCounts: (value) =>
        setViewCounts((prev) => ({
          value: prev?.basis === basis.current ? { ...prev.value, ...value } : value,
          basis: basis.current,
        })),
      lastWriteAt,
      markWrite: () => setLastWriteAt(Date.now()),
    }),
    [overrides, lastWriteAt],
  );
  const shown: ShellCounts | null =
    counts && viewCounts?.basis === counts ? { ...counts, ...viewCounts.value } : counts;
  const shownRef = React.useRef(shown);
  shownRef.current = shown;

  // Off the triage views the links keep the last Where, so the counts follow it: the layout's
  // are for the default Where, and a write elsewhere (Prepare application) brings new ones.
  const lastWhere = new URLSearchParams(query).get('where');
  const pushed = viewCounts?.basis === counts;
  const { setCounts } = triage;
  React.useEffect(() => {
    if (onTriage || !lastWhere || !counts || pushed) return;
    const ctl = new AbortController();
    fetch(`/api/triage-counts?where=${encodeURIComponent(lastWhere)}`, {
      cache: 'no-store',
      signal: ctl.signal,
    })
      .then((res) => (res.ok ? (res.json() as Promise<TriageCountsView>) : null))
      .then((value) => {
        if (value) setCounts(value);
      })
      .catch(() => undefined);
    return () => ctl.abort();
  }, [onTriage, lastWhere, counts, pushed, setCounts]);
  const logoEditor = useLogoEditor();
  const [sidebarPreference, setSidebarPreference] = React.useState(sidebar);
  const narrow = useMediaQuery('(max-width: 1279px)');
  const collapsed = sidebarIsRail(narrow, sidebarPreference);
  const toggleSidebar = React.useCallback(() => {
    // Below 1280 the rail is already the layout. Don't pin a choice the window can't show.
    if (narrow) return;
    setSidebarPreference((prev) => {
      const next: SidebarPreference = prev === 'rail' ? 'expanded' : 'rail';
      document.cookie = sidebarCookie(next);
      return next;
    });
  }, [narrow]);
  // Unmounted on phones, as in the reference: a hidden copy would also hold the brand mark's
  // gradient id, and the drawer's mark would resolve to the hidden one and paint nothing.
  const phone = useMediaQuery('(max-width: 767px)');
  const [mobileNav, setMobileNav] = React.useState(false);
  const [card, setCard] = React.useState(scout);
  const [starting, setStarting] = React.useState(false);
  const [liveProgress, setLiveProgress] = React.useState<ScoutCardView['progress']>(null);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [resetOpen, setResetOpen] = React.useState(false);
  const [resetPlan, setResetPlan] = React.useState<ResetCounts | null>(null);
  const [resetPhase, setResetPhase] = React.useState<'confirm' | 'done'>('confirm');
  const [resetBusy, setResetBusy] = React.useState(false);
  const [resetError, setResetError] = React.useState<string | null>(null);
  const [retire, setRetire] = React.useState<{
    ats: string;
    token: string;
    name: string;
    text: string;
  } | null>(null);
  const [retireBusy, setRetireBusy] = React.useState(false);
  const [retireError, setRetireError] = React.useState<string | null>(null);
  /** The link field of each gone board, by `ats:token`. */
  const [moveState, setMoveState] = React.useState<
    Record<string, { error?: string; busy?: boolean }>
  >({});
  const resetToken = React.useRef(0);
  const [paletteJobs, setPaletteJobs] = React.useState<PaletteJob[]>([]);
  const [pendingJob, setPendingJob] = React.useState<{ id: string; token: number } | null>(null);
  const [tuneToken, setTuneToken] = React.useState(0);
  const liveRanking = React.useRef('');
  const scoringNote = React.useRef<string | undefined>(undefined);
  const watchKind = React.useRef<'scout' | 'refresh'>('scout');
  const watched = React.useRef<number | null>(null);

  React.useEffect(() => setCard(scout), [scout]);

  const running = starting || card?.running === true || watched.current !== null;

  React.useEffect(() => {
    const id = watched.current;
    if (id === null && !running) return;
    let stop = false;
    const tick = async () => {
      const watch = watched.current;
      if (watch !== null) {
        const state = await fetchRun(watch);
        if (stop || !state) return;
        if (state.progress) {
          setLiveProgress(state.progress);
          setCard((c) =>
            c
              ? {
                  ...c,
                  running: state.running,
                  progress: state.progress,
                }
              : c,
          );
        }
        if (!state.running) {
          watched.current = null;
          setStarting(false);
          setLiveProgress(null);
          const note = scoringNote.current;
          scoringNote.current = undefined;
          const next = await fetchCard();
          if (next) setCard(next);
          if (state.ok === false) {
            toast('Scout failed', {
              description: state.error ?? next?.notices[0]?.text,
              icon: <TriangleAlert className="text-danger" />,
            });
          } else {
            const boards = state.boardsOk ?? state.boards ?? next?.boards ?? 0;
            const found = state.inserted ?? next?.newLastRun ?? 0;
            const closed = state.closed ?? 0;
            const shortlisted = state.closedShortlisted ?? 0;
            const errors = state.errorCount ?? 0;
            const refreshed = watchKind.current === 'refresh';
            toast(refreshed ? 'Listings refreshed' : 'Scout finished', {
              description: `${formatCount(boards)} boards checked, ${formatCount(found)} new jobs, ${formatCount(closed)} closed, ${formatCount(shortlisted)} of them shortlisted${
                errors ? `, ${formatCount(errors)} errors` : ''
              }${note ? ', scoring skipped (no API key)' : ''}`,
              icon: refreshed ? (
                <RefreshCw className="text-strong" />
              ) : (
                <Radar className="text-strong" />
              ),
            });
          }
          router.refresh();
        }
        return;
      }
      if (running) {
        const next = await fetchCard();
        if (!stop && next) setCard(next);
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [running, router]);

  const startRun = React.useCallback(
    (kind: 'scout' | 'refresh') => {
      if (running) {
        toast('A scout is already running');
        return;
      }
      watchKind.current = kind;
      setStarting(true);
      setCard((c) =>
        c
          ? { ...c, running: true, progress: { done: 0, total: c.boards, found: 0, unit: 'Board' } }
          : c,
      );
      const start = kind === 'refresh' ? refreshListings : runScoutNow;
      void start().then((result) => {
        if (!result.ok) {
          setStarting(false);
          setCard((c) => (c ? { ...c, running: false, progress: null } : c));
          toast(kind === 'refresh' ? 'Refresh failed' : 'Scout failed', {
            description: result.error,
            icon: <TriangleAlert className="text-danger" />,
          });
          return;
        }
        scoringNote.current = result.scoringNote;
        watched.current = result.runId;
        setStarting(true);
      });
    },
    [running],
  );
  const runScout = React.useCallback(() => startRun('scout'), [startRun]);
  const refresh = React.useCallback(() => startRun('refresh'), [startRun]);
  const onNoticeAction = React.useCallback(
    (index: number) => {
      const notice = card?.notices[index];
      if (!notice?.retire) return;
      setRetireError(null);
      setRetireBusy(false);
      setRetire({ ...notice.retire, text: notice.text });
    },
    [card],
  );
  const confirmRetire = React.useCallback(async () => {
    if (!retire) return;
    setRetireBusy(true);
    setRetireError(null);
    const result = await turnOffBoard({ ats: retire.ats, token: retire.token });
    if (!result.ok) {
      setRetireBusy(false);
      setRetireError(result.error);
      return;
    }
    const name = result.name;
    setRetireBusy(false);
    setRetire(null);
    const next = await fetchCard();
    if (next) setCard(next);
    router.refresh();
    toast(`Turned off ${name}`, {
      description: 'Later scouts skip this board. Jobs already stored stay.',
    });
  }, [retire, router]);

  const finishMove = React.useCallback(
    async (key: string, result: MoveBoardResult) => {
      if (!result.ok) {
        setMoveState((all) => ({ ...all, [key]: { error: result.error } }));
        return;
      }
      setMoveState((all) => ({ ...all, [key]: {} }));
      const next = await fetchCard();
      if (next) setCard(next);
      router.refresh();
      toast(`Moved ${result.from} to ${result.to}`, {
        description: 'The next scout fetches the new board. Its jobs keep their scores and status.',
      });
    },
    [router],
  );
  const onCandidate = React.useCallback(
    async (index: number, candidateIndex: number) => {
      const notice = card?.notices[index];
      const candidate = notice?.relocate?.candidates[candidateIndex];
      if (!notice?.retire || !candidate) return;
      const key = `${notice.retire.ats}:${notice.retire.token}`;
      setMoveState((all) => ({ ...all, [key]: { busy: true } }));
      const result = await moveBoardToCandidate({
        ats: notice.retire.ats,
        token: notice.retire.token,
        to: { ats: candidate.ats, token: candidate.token },
      });
      await finishMove(key, result);
    },
    [card, finishMove],
  );
  const onLink = React.useCallback(
    async (index: number, url: string) => {
      const notice = card?.notices[index];
      if (!notice?.retire) return;
      const key = `${notice.retire.ats}:${notice.retire.token}`;
      setMoveState((all) => ({ ...all, [key]: { busy: true } }));
      const result = await moveBoardToLink({
        ats: notice.retire.ats,
        token: notice.retire.token,
        url,
      });
      await finishMove(key, result);
    },
    [card, finishMove],
  );

  const openMobileNav = React.useCallback(() => setMobileNav(true), []);
  const openReset = React.useCallback(() => {
    const token = resetToken.current + 1;
    resetToken.current = token;
    setMobileNav(false);
    setResetPhase('confirm');
    setResetError(null);
    setResetPlan(null);
    setResetBusy(true);
    setResetOpen(true);
    void loadResetPlan().then((result) => {
      if (resetToken.current !== token) return;
      setResetBusy(false);
      if (!result.ok) setResetError(result.error);
      else setResetPlan(result.plan);
    });
  }, []);
  const confirmResetDialog = React.useCallback(async () => {
    setResetBusy(true);
    setResetError(null);
    const result = await confirmReset();
    setResetBusy(false);
    if (!result.ok) {
      setResetError(result.error);
      return;
    }
    setResetPlan(result.after);
    setResetPhase('done');
    router.refresh();
  }, [router]);
  const clearPending = React.useCallback(() => setPendingJob(null), []);
  const setLiveRanking = React.useCallback((next: string) => {
    liveRanking.current = next;
  }, []);
  const adjustCounts = React.useCallback(
    (delta: Partial<Record<keyof ShellCounts, number>>) => {
      const cur = shownRef.current;
      if (!cur) return;
      const next: Partial<ShellCounts> = {};
      for (const key of Object.keys(delta) as (keyof ShellCounts)[]) {
        next[key] = Math.max(0, cur[key] + (delta[key] ?? 0));
      }
      triage.setCounts(next);
    },
    [triage],
  );
  const ctx = React.useMemo(
    () => ({
      openMobileNav,
      runScout,
      refreshListings: refresh,
      triage,
      pendingJob,
      clearPending,
      tuneToken,
      setLiveRanking,
      adjustCounts,
    }),
    [
      openMobileNav,
      runScout,
      refresh,
      triage,
      pendingJob,
      clearPending,
      tuneToken,
      setLiveRanking,
      adjustCounts,
    ],
  );

  const openPalette = React.useCallback(() => setPaletteOpen(true), []);

  // ⌘K only toggles the dialog. Fetch whenever it opens, including from the hotkey.
  React.useEffect(() => {
    if (!paletteOpen) return;
    const q = liveRanking.current;
    let stop = false;
    void fetch(`/api/palette-jobs${q ? `?${q}` : ''}`, { cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<PaletteJob[]>) : []))
      .then((jobs) => {
        if (!stop) setPaletteJobs(Array.isArray(jobs) ? jobs : []);
      })
      .catch(() => {
        if (!stop) setPaletteJobs([]);
      });
    return () => {
      stop = true;
    };
  }, [paletteOpen]);

  useHotkeys({
    'mod+k': () => setPaletteOpen((open) => !open),
    'mod+b': () => toggleSidebar(),
    '?': () => setShortcutsOpen((open) => !open),
  });

  const jumpToJob = (job: PaletteJob) => {
    setPendingJob({ id: job.id, token: Date.now() });
    router.push(paletteJobHref(query, job, whereDefault));
  };

  const jobGroup: PaletteGroup | null =
    paletteJobs.length === 0
      ? null
      : {
          heading: 'Jobs',
          items: paletteJobs.map((job) => ({
            id: `job-${job.id}`,
            label: job.title,
            keywords: [job.company, job.location],
            hint: `${job.company} · ${job.score}`,
            icon: <CompanyLogo name={job.company} src={job.logoUrl} size={20} />,
            onSelect: () => jumpToJob(job),
          })),
        };
  const paletteGroups: PaletteGroup[] = [
    {
      heading: 'Go to',
      items: [
        {
          id: 'go-top',
          label: 'Top matches',
          icon: <Sparkles className="size-4 text-fg-3" />,
          onSelect: () => router.push(`/${query}`),
        },
        {
          id: 'go-new',
          label: 'New today',
          icon: <Inbox className="size-4 text-fg-3" />,
          onSelect: () => router.push(`/new${query}`),
        },
        {
          id: 'go-short',
          label: 'Shortlist',
          icon: <Bookmark className="size-4 text-fg-3" />,
          onSelect: () => router.push(`/shortlist${query}`),
        },
        {
          id: 'go-unscored',
          label: 'Unscored',
          icon: <CircleDashed className="size-4 text-fg-3" />,
          onSelect: () => router.push(`/unscored${query}`),
        },
        {
          id: 'go-apps',
          label: 'In progress',
          icon: <FileText className="size-4 text-fg-3" />,
          onSelect: () => router.push('/applications'),
        },
        {
          id: 'go-submitted',
          label: 'Submitted',
          icon: <Send className="size-4 text-fg-3" />,
          onSelect: () => router.push('/applications/submitted'),
        },
        {
          id: 'go-due',
          label: 'Follow-ups',
          icon: <BellRing className="size-4 text-fg-3" />,
          onSelect: () => router.push('/applications/follow-ups'),
        },
        {
          id: 'go-logos',
          label: 'Company logos',
          icon: <Images className="size-4 text-fg-3" />,
          onSelect: () => router.push('/companies'),
        },
        {
          id: 'go-settings',
          label: 'Settings',
          keywords: ['profile', 'answers', 'self-id', 'preferences'],
          icon: <Settings className="size-4 text-fg-3" />,
          onSelect: () => router.push(SETTINGS_HREF),
        },
      ],
    },
    {
      heading: 'Actions',
      items: [
        {
          id: 'act-scout',
          label: 'Run scout now',
          icon: <Radar className="size-4 text-fg-3" />,
          onSelect: () => runScout(),
        },
        {
          id: 'act-tune',
          label: 'Tune ranking weights',
          icon: <SlidersHorizontal className="size-4 text-fg-3" />,
          shortcut: ['T'],
          onSelect: () => {
            setTuneToken((n) => n + 1);
            router.push(`/${query}`);
          },
        },
        {
          id: 'act-density',
          label: readDensity() === 'compact' ? 'Use comfortable rows' : 'Use compact rows',
          icon: <Rows3 className="size-4 text-fg-3" />,
          shortcut: ['D'],
          onSelect: () => toggleStoredDensity(),
        },
        {
          id: 'act-sidebar',
          label: sidebarPreference === 'rail' ? 'Expand sidebar' : 'Collapse sidebar',
          keywords: ['navigation', 'rail', 'icon'],
          icon:
            sidebarPreference === 'rail' ? (
              <PanelLeftOpen className="size-4 text-fg-3" />
            ) : (
              <PanelLeftClose className="size-4 text-fg-3" />
            ),
          shortcut: ['⌘', 'B'],
          onSelect: () => toggleSidebar(),
        },
        {
          id: 'act-keys',
          label: 'Keyboard shortcuts',
          icon: <Keyboard className="size-4 text-fg-3" />,
          shortcut: ['?'],
          onSelect: () => setShortcutsOpen(true),
        },
      ],
    },
    ...(jobGroup ? [jobGroup] : []),
  ];
  const sections = sectionsFor(shown, query, logoEditor.missing ?? shown?.logos, openReset);
  const footer = (c: boolean) =>
    card ? (
      <div className="space-y-2">
        <ScoutCard
          collapsed={c}
          lastRunLabel={card.lastRunLabel}
          boards={card.boards}
          newLastRun={card.newLastRun}
          progress={
            running
              ? (liveProgress ?? card.progress ?? { done: 0, total: card.boards, found: 0 })
              : null
          }
          onRun={runScout}
          onRefresh={refresh}
          status={card.status}
          notices={card.notices.map((notice) => {
            if (!notice.retire) return notice.text;
            const action = `Turn off ${notice.retire.name}`;
            if (!notice.relocate) return { text: notice.text, action };
            return {
              text: notice.text,
              action,
              board: notice.retire.name,
              looked: notice.relocate.looked ?? undefined,
              candidates: notice.relocate.candidates.map((c) => ({
                label: c.label,
                detail: c.detail,
              })),
              link: moveState[`${notice.retire.ats}:${notice.retire.token}`] ?? {},
            };
          })}
          onNoticeAction={onNoticeAction}
          onCandidate={onCandidate}
          onLink={onLink}
        />
        {c ? null : (
          <div className="px-1 text-2xs text-fg-4">
            <span className="tnum">{formatCount(card.modelCalls)} model calls this month</span>
          </div>
        )}
      </div>
    ) : null;

  return (
    <Ctx.Provider value={ctx}>
      <MotionConfig reducedMotion="user">
        <LogoDomainProvider domains={foundLogos}>
          <TooltipProvider>
            <div className="flex h-dvh overflow-hidden bg-canvas text-fg">
              {phone ? null : (
                <AppSidebar
                  sections={sections}
                  activeHref={activeHref}
                  collapsed={collapsed}
                  onToggleCollapsed={toggleSidebar}
                  onSearch={openPalette}
                  footer={footer(collapsed)}
                  user={user ?? undefined}
                  className="max-md:hidden"
                />
              )}
              <main className="relative my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-card max-md:m-0 max-md:rounded-none max-md:border-0">
                <LogoLookup
                  clientId={logos?.clientId ?? null}
                  names={logos?.names ?? []}
                  onFound={noteLogo}
                />
                <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
              </main>
            </div>

            <Dialog open={mobileNav} onOpenChange={setMobileNav}>
              <DialogContent
                className="left-0 top-0 h-full w-[280px] max-w-none translate-x-0 rounded-none rounded-r-xl border-y-0 border-l-0 p-0 pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] [--chamfer:0px] data-[state=open]:animate-drawer-in"
                overlayClassName="bg-black/60"
              >
                <DialogTitle className="sr-only">Navigation</DialogTitle>
                <DialogDescription className="sr-only">Views and applications</DialogDescription>
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: closes the drawer after a link is followed; links handle their own keys */}
                <div
                  onClick={(e) => (e.target as HTMLElement).closest('a') && setMobileNav(false)}
                  className="h-full"
                >
                  <AppSidebar
                    sections={sections}
                    activeHref={activeHref}
                    onSearch={() => {
                      setMobileNav(false);
                      openPalette();
                    }}
                    footer={footer(false)}
                    user={user ?? undefined}
                    className="w-full"
                  />
                </div>
              </DialogContent>
            </Dialog>
            <AppToaster />
            <CommandPalette
              open={paletteOpen}
              onOpenChange={setPaletteOpen}
              groups={paletteGroups}
            />
            <ShortcutsDialog
              open={shortcutsOpen}
              onOpenChange={setShortcutsOpen}
              groups={SHORTCUTS}
            />
            <TurnOffBoardDialog
              target={retire}
              busy={retireBusy}
              error={retireError}
              onOpenChange={(open) => {
                if (!open) setRetire(null);
              }}
              onConfirm={() => void confirmRetire()}
            />
            <ResetDialog
              open={resetOpen}
              onOpenChange={(open) => {
                if (open) return;
                resetToken.current += 1;
                setResetOpen(false);
              }}
              plan={resetPlan}
              phase={resetPhase}
              busy={resetBusy}
              error={resetError}
              onConfirm={() => void confirmResetDialog()}
            />
          </TooltipProvider>
        </LogoDomainProvider>
      </MotionConfig>
    </Ctx.Provider>
  );
}

const focusRing =
  'outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-uv-hi';

function boardCause(name: string, text: string): string {
  const prefix = `${name}: `;
  const rest = text.startsWith(prefix) ? text.slice(prefix.length) : text;
  if (!rest) return 'This board failed in the last run.';
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

function TurnOffBoardDialog({
  target,
  busy,
  error,
  onOpenChange,
  onConfirm,
}: {
  target: { name: string; text: string } | null;
  busy: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={target != null} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-md p-0">
        <div className="scanlines-light flex items-start gap-3 border-b border-line px-5 py-4">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-danger-wash ring-1 ring-danger/25">
            <PowerOff className="size-4 text-danger" />
          </span>
          <div className="min-w-0 pt-0.5">
            <DialogTitle className="text-md font-semibold text-fg">
              {target ? `Turn off ${target.name}?` : 'Turn off this board?'}
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs leading-5 text-fg-3">
              {target ? boardCause(target.name, target.text) : 'This board failed in the last run.'}
            </DialogDescription>
          </div>
          <DialogClose
            disabled={busy}
            tabIndex={-1}
            className={`ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-3 hover:bg-surface-3 hover:text-fg ${focusRing}`}
          >
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogClose>
        </div>
        <div className="space-y-2 px-5 py-4 text-sm leading-5 text-fg-2">
          <p>Later scouts skip this board.</p>
          <p>Jobs already stored stay, including any you shortlisted.</p>
          <p>
            To watch it again, set{' '}
            <code className="rounded bg-surface-3 px-1 py-px font-mono text-xs text-fg">
              active: true
            </code>{' '}
            for this board in{' '}
            <code className="whitespace-nowrap rounded bg-surface-3 px-1 py-px font-mono text-xs text-fg">
              companies.yaml
            </code>
            {'.'}
          </p>
        </div>
        {error ? <p className="px-5 pb-3 text-xs text-danger">{error}</p> : null}
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <Button
            type="button"
            variant="outline"
            className={focusRing}
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            className={focusRing}
            disabled={busy || target == null}
            onClick={onConfirm}
          >
            {busy ? 'Turning off…' : 'Turn off'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
