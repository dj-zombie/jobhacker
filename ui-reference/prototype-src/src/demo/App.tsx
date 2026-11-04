import * as React from "react";
import {
  Bookmark,
  BellRing,
  CircleDashed,
  FileText,
  Eraser,
  Images,
  Inbox,
  Keyboard,
  Radar,
  RefreshCw,
  Rows3,
  Send,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  AppSidebar,
  AppToaster,
  CommandPalette,
  CompanyLogo,
  ResetDialog,
  type ResetCounts,
  ScoutCard,
  ShortcutsDialog,
  toast,
  type NavSection,
  type PaletteGroup,
  type ScoutNoticeItem,
  type ScoutStatus,
} from "@/components/jobhacker";
import { formatCompact, formatCount } from "@/lib/format";
import { STATS } from "./data";
import { demoLogoUrl } from "./logos";
import { initialState, inWhere, rank, bandFor, reducer, type Action, type State } from "./model";
import { companyLogoRows, logosMissing, useLogoOverrides, useLogoPicker } from "./logo-store";
import { navigate, usePath } from "./router";
import { TriageView } from "./views/TriageView";
import { ApplicationsView } from "./views/ApplicationsView";
import { CompanyLogosView } from "./views/CompanyLogosView";
import { LogoPickerDialog } from "./views/LogoPickerDialog";
import { WorkspaceView } from "./views/WorkspaceView";

interface DemoCtx {
  state: State;
  dispatch: React.Dispatch<Action>;
  isMobile: boolean;
  openPalette: () => void;
  openMobileNav: () => void;
  runScout: () => void;
  refreshListings: () => void;
}

const Ctx = React.createContext<DemoCtx | null>(null);

// `?scout=attention` or `?scout=failed` shows the scout card's warning states (frame 26).
// `?scout=moved` is a gone board with a board found for it (frame 40); `?scout=gone` has none,
// so the card offers the link field (frames 41 and 42).
const SCOUT_DEMO = typeof location !== "undefined" ? new URLSearchParams(location.search).get("scout") : null;
const GONE_LOOKED = "Looked on Lever, Ashby, SmartRecruiters, Breezy and Polymer, and in your search results";
const SCOUT_STATE: { status: ScoutStatus; notices: ScoutNoticeItem[] } =
  SCOUT_DEMO === "failed"
    ? { status: "failed", notices: ["The 6:00 scout stopped: database is locked"] }
    : SCOUT_DEMO === "attention"
      ? { status: "attention", notices: ["JSearch is at its monthly budget", "3 boards failed in the last run"] }
      : SCOUT_DEMO === "moved"
        ? {
            status: "attention",
            notices: [
              {
                text: "Brightline: the Ashby board returned 404. The listing page is gone.",
                board: "Brightline",
                looked:
                  "Looked on Greenhouse, Lever, SmartRecruiters, Breezy and Polymer, and in your search results: found 1 board",
                candidates: [{ label: "Ashby · brightline-labs", detail: "12 postings · Brightline Labs" }],
                link: {},
                action: "Turn off Brightline",
              },
            ],
          }
        : SCOUT_DEMO === "gone"
          ? {
              status: "attention",
              notices: [
                {
                  text: "Northwind: the Greenhouse board returned 404. The listing page is gone.",
                  board: "Northwind",
                  looked: `${GONE_LOOKED}: no new board`,
                  link: {},
                  action: "Turn off Northwind",
                },
              ],
            }
          : { status: "ok", notices: [] };

/** The demo's stand-in for the server's check: a known ATS host with a board token. */
function demoBoardLink(url: string): boolean {
  return /^https?:\/\/(job-boards(\.eu)?\.greenhouse\.io|boards\.greenhouse\.io|jobs(\.eu)?\.lever\.co|jobs\.ashbyhq\.com)\/[A-Za-z0-9]/.test(
    url,
  );
}
export function useDemo(): DemoCtx {
  const c = React.useContext(Ctx);
  if (!c) throw new Error("useDemo outside provider");
  return c;
}

function useMediaQuery(q: string): boolean {
  const get = () => (typeof window !== "undefined" ? window.matchMedia(q).matches : false);
  const [m, setM] = React.useState(get);
  React.useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

const RESET_BEFORE: ResetCounts = {
  jobs: 11374,
  jobsWithApplication: 5,
  jobsWithoutApplication: 11369,
  jobScores: 1108,
  applications: 5,
  companyDomains: 48,
  sourceUsage: 8,
  companiesRemoved: 120,
  runs: 12,
  eventsRemoved: 640,
};

const RESET_AFTER: ResetCounts = {
  jobs: 5,
  jobsWithApplication: 5,
  jobsWithoutApplication: 0,
  jobScores: 0,
  applications: 5,
  companyDomains: 48,
  sourceUsage: 8,
  companiesRemoved: 0,
  runs: 0,
  eventsRemoved: 0,
};

export const SHORTCUTS = [
  {
    heading: "Triage",
    items: [
      { keys: ["J"], label: "Next job" },
      { keys: ["K"], label: "Previous job" },
      { keys: ["S"], label: "Shortlist" },
      { keys: ["X"], label: "Skip" },
      { keys: ["A"], label: "Archive" },
      { keys: ["O"], label: "Open posting" },
      { keys: ["U"], label: "Undo last action" },
    ],
  },
  {
    heading: "Views",
    items: [
      { keys: ["1"], label: "All matches" },
      { keys: ["2"], label: "Strong only" },
      { keys: ["3"], label: "Maybe only" },
      { keys: ["T"], label: "Tune ranking" },
      { keys: ["D"], label: "Toggle density" },
    ],
  },
  {
    heading: "Anywhere",
    items: [
      { keys: ["⌘", "K"], label: "Search and commands" },
      { keys: ["?"], label: "This list" },
      { keys: ["Esc"], label: "Close panel or dialog" },
    ],
  },
];

export function App() {
  const path = usePath();
  const [state, dispatch] = React.useReducer(reducer, initialState);
  const logoOverrides = useLogoOverrides();
  const pickerCompany = useLogoPicker();
  const missingLogos = React.useMemo(
    () => logosMissing(companyLogoRows(state.jobs, state.weights, state.thresholds, logoOverrides)),
    [state.jobs, state.weights, state.thresholds, logoOverrides],
  );
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [mobileNav, setMobileNav] = React.useState(false);
  const [resetOpen, setResetOpen] = React.useState(false);
  const [resetPhase, setResetPhase] = React.useState<"confirm" | "done">("confirm");
  const [scoutNotices, setScoutNotices] = React.useState<ScoutNoticeItem[]>(SCOUT_STATE.notices);
  const isMobile = useMediaQuery("(max-width: 767px)");
  const moveBoard = (index: number, to: string) => {
    setScoutNotices((all) => all.filter((_, i) => i !== index));
    toast.success(`Moved to ${to}. Its jobs follow on the next scout.`);
  };
  const pasteLink = (index: number, url: string) => {
    if (demoBoardLink(url)) {
      moveBoard(index, url.replace(/^https?:\/\//, ""));
      return;
    }
    setScoutNotices((all) =>
      all.map((notice, i) =>
        i === index && typeof notice !== "string"
          ? {
              ...notice,
              link: {
                error: "That link isn't a board JobHacker can read. Nothing changed.",
              },
            }
          : notice,
      ),
    );
  };
  const collapsed = useMediaQuery("(max-width: 1279px)");

  // Global shortcuts that work on every view.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (!typing && e.key === "?" && !paletteOpen) {
        e.preventDefault();
        setShortcutsOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen]);

  const runScout = React.useCallback(() => {
    if (state.scout) return;
    const total = STATS.boards;
    let done = 0;
    let found = 0;
    dispatch({ type: "scout", progress: { done, total, found } });
    const id = window.setInterval(() => {
      done = Math.min(total, done + 9 + Math.round(Math.random() * 6));
      if (Math.random() < 0.28) found += 1;
      dispatch({ type: "scout", progress: { done, total, found } });
      if (done >= total) {
        window.clearInterval(id);
        dispatch({ type: "scoutDone", found });
        toast("Scout finished", {
          description: `${total} boards checked, ${found} new jobs, no errors`,
          icon: <Radar className="text-strong" />,
        });
      }
    }, 110);
  }, [state.scout]);

  const refreshListings = React.useCallback(() => {
    if (state.scout) {
      toast("A scout is already running");
      return;
    }
    toast("Listings refreshed", {
      description: "0 boards checked, 0 new jobs, 0 closed, 0 of them shortlisted",
      icon: <RefreshCw className="text-strong" />,
    });
  }, [state.scout]);

  // Sidebar counts
  const counts = React.useMemo(() => {
    let strong = 0;
    let maybe = 0;
    let fresh = 0;
    let shortlist = 0;
    for (const j of state.jobs) {
      if (!inWhere(j, state.where)) continue;
      if (j.state === "shortlisted") shortlist++;
      if (j.state !== "new") continue;
      if (j.ageHours < 24) fresh++;
      if (!j.dims) continue;
      const b = bandFor(rank(j.dims, state.weights), state.thresholds);
      if (b === "strong") strong++;
      else if (b === "maybe") maybe++;
    }
    const inProgress = state.apps.filter((a) => a.status === "prepped").length;
    const submitted = state.apps.filter((a) => a.status === "submitted").length;
    return { matches: strong + maybe, fresh, shortlist, inProgress, submitted };
  }, [state.jobs, state.weights, state.thresholds, state.apps, state.where]);

  const activeHref = path.startsWith("/applications")
    ? path === "/applications"
      ? "/applications"
      : "/applications"
    : path;

  const sections: NavSection[] = [
    {
      label: "Triage",
      items: [
        { href: "/", label: "Top matches", icon: Sparkles, count: formatCount(counts.matches), countTone: "brand" },
        { href: "/new", label: "New today", icon: Inbox, count: formatCount(counts.fresh) },
        { href: "/shortlist", label: "Shortlist", icon: Bookmark, count: counts.shortlist || undefined },
        { href: "/unscored", label: "Unscored", icon: CircleDashed, count: formatCompact(state.unscoredCount) },
      ],
    },
    {
      label: "Applications",
      items: [
        { href: "/applications", label: "In progress", icon: FileText, count: counts.inProgress },
        { href: "/applications/submitted", label: "Submitted", icon: Send, count: counts.submitted },
        { href: "/applications/follow-ups", label: "Follow-ups", icon: BellRing, count: 0 },
      ],
    },
    {
      label: "Setup",
      items: [
        { href: "/companies", label: "Company logos", icon: Images, count: missingLogos },
        {
          label: "Start fresh",
          icon: Eraser,
          onSelect: () => {
            setMobileNav(false);
            setResetPhase("confirm");
            setResetOpen(true);
          },
        },
      ],
    },
  ];

  const sidebarFooter = (c: boolean) => (
    <div className="space-y-2">
      <ScoutCard
        collapsed={c}
        lastRunLabel={state.lastRun}
        boards={STATS.boards}
        newLastRun={state.newLastRun}
        progress={state.scout}
        onRun={runScout}
        onRefresh={refreshListings}
        status={scoutNotices.length ? SCOUT_STATE.status : "ok"}
        notices={scoutNotices}
        onCandidate={(index, ci) => {
          const notice = scoutNotices[index];
          const candidate = typeof notice === "string" ? undefined : notice?.candidates?.[ci];
          if (candidate) moveBoard(index, candidate.label);
        }}
        onLink={pasteLink}
      />
      {c ? null : (
        <div className="flex items-center justify-between px-1 text-2xs text-fg-4">
          <span className="tnum">{formatCount(state.apiCalls)} model calls this month</span>
          <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-fg-3 ring-1 ring-line">Prototype</span>
        </div>
      )}
    </div>
  );

  const paletteGroups: PaletteGroup[] = React.useMemo(() => {
    const jobs = state.jobs
      .filter((j) => j.dims && j.state === "new")
      .map((j) => ({ j, score: rank(j.dims!, state.weights) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 40);
    return [
      {
        heading: "Jobs",
        items: jobs.map(({ j, score }) => ({
          id: `job-${j.id}`,
          label: j.title,
          keywords: [j.company, j.location],
          hint: `${j.company} · ${score}`,
          icon: <CompanyLogo name={j.company} src={demoLogoUrl(j.company)} size={20} />,
          onSelect: () => {
            navigate("/");
            if (!inWhere(j, state.where)) dispatch({ type: "where", where: [] });
            dispatch({ type: "segment", segment: bandFor(score, state.thresholds) === "no" ? "weak" : "matches" });
            dispatch({ type: "select", view: "top", id: j.id });
            dispatch({ type: "mobileDetail", open: true });
          },
        })),
      },
      {
        heading: "Go to",
        items: [
          { id: "go-top", label: "Top matches", icon: <Sparkles className="size-4 text-fg-3" />, onSelect: () => navigate("/") },
          { id: "go-new", label: "New today", icon: <Inbox className="size-4 text-fg-3" />, onSelect: () => navigate("/new") },
          { id: "go-short", label: "Shortlist", icon: <Bookmark className="size-4 text-fg-3" />, onSelect: () => navigate("/shortlist") },
          { id: "go-unscored", label: "Unscored", icon: <CircleDashed className="size-4 text-fg-3" />, onSelect: () => navigate("/unscored") },
          { id: "go-apps", label: "Applications", icon: <FileText className="size-4 text-fg-3" />, onSelect: () => navigate("/applications") },
        ],
      },
      {
        heading: "Actions",
        items: [
          { id: "act-scout", label: "Run scout now", icon: <Radar className="size-4 text-fg-3" />, onSelect: runScout },
          {
            id: "act-tune",
            label: "Tune ranking weights",
            icon: <SlidersHorizontal className="size-4 text-fg-3" />,
            shortcut: ["T"],
            onSelect: () => {
              navigate("/");
              dispatch({ type: "tune", open: true });
            },
          },
          {
            id: "act-density",
            label: state.density === "compact" ? "Use comfortable rows" : "Use compact rows",
            icon: <Rows3 className="size-4 text-fg-3" />,
            shortcut: ["D"],
            onSelect: () => dispatch({ type: "density", density: state.density === "compact" ? "comfortable" : "compact" }),
          },
          {
            id: "act-keys",
            label: "Keyboard shortcuts",
            icon: <Keyboard className="size-4 text-fg-3" />,
            shortcut: ["?"],
            onSelect: () => setShortcutsOpen(true),
          },
        ],
      },
    ];
  }, [state.jobs, state.weights, state.thresholds, state.density, state.where, runScout]);

  let view: React.ReactNode;
  if (path === "/") view = <TriageView key="top" view="top" />;
  else if (path === "/new") view = <TriageView key="new" view="new" />;
  else if (path === "/shortlist") view = <TriageView key="shortlist" view="shortlist" />;
  else if (path === "/unscored") view = <TriageView key="unscored" view="unscored" />;
  else if (path === "/applications") view = <ApplicationsView filter="in-progress" />;
  else if (path === "/applications/submitted") view = <ApplicationsView filter="submitted" />;
  else if (path === "/applications/follow-ups") view = <ApplicationsView filter="follow-ups" />;
  else if (path.startsWith("/applications/")) view = <WorkspaceView appId={path.split("/")[2] ?? ""} />;
  else if (path === "/companies") view = <CompanyLogosView />;
  else view = <TriageView view="top" />;

  const activeNav =
    path === "/applications/submitted" || path === "/applications/follow-ups"
      ? path
      : path.startsWith("/applications")
        ? "/applications"
        : activeHref;

  return (
    <Ctx.Provider
      value={{
        state,
        dispatch,
        isMobile,
        openPalette: () => setPaletteOpen(true),
        openMobileNav: () => setMobileNav(true),
        runScout,
        refreshListings,
      }}
    >
      <TooltipProvider>
        <div className="flex h-full overflow-hidden bg-canvas text-fg">
          {isMobile ? null : (
            <AppSidebar
              sections={sections}
              activeHref={activeNav}
              collapsed={collapsed}
              onSearch={() => setPaletteOpen(true)}
              footer={sidebarFooter(collapsed)}
              user={{ name: "Kris Tester", initials: "KT" }}
            />
          )}
          <main
            className={
              isMobile
                ? "relative flex min-w-0 flex-1 flex-col overflow-hidden bg-panel"
                : "relative my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-card"
            }
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -top-48 left-[20%] h-96 w-[720px] max-w-full rounded-full opacity-70 blur-3xl"
              style={{
                background:
                  "radial-gradient(closest-side, color-mix(in oklab, var(--color-brand) 16%, transparent), transparent)",
              }}
            />
            <div className="relative flex min-h-0 flex-1 flex-col">{view}</div>
          </main>
        </div>

        <Dialog open={mobileNav} onOpenChange={setMobileNav}>
          <DialogContent
            className="left-0 top-0 h-full w-[280px] pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] max-w-none translate-x-0 rounded-none rounded-r-xl border-y-0 border-l-0 p-0 data-[state=open]:animate-drawer-in"
            overlayClassName="bg-black/60"
          >
            <DialogTitle className="sr-only">Navigation</DialogTitle>
            <DialogDescription className="sr-only">Views and applications</DialogDescription>
            <div onClick={(e) => (e.target as HTMLElement).closest("a") && setMobileNav(false)} className="h-full">
              <AppSidebar
                sections={sections}
                activeHref={activeNav}
                onSearch={() => {
                  setMobileNav(false);
                  setPaletteOpen(true);
                }}
                footer={sidebarFooter(false)}
                user={{ name: "Kris Tester", initials: "KT" }}
                className="w-full"
              />
            </div>
          </DialogContent>
        </Dialog>

        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} groups={paletteGroups} />
        <LogoPickerDialog company={pickerCompany} />
        <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} groups={SHORTCUTS} />
        <ResetDialog
          open={resetOpen}
          onOpenChange={(open) => {
            setResetOpen(open);
            if (!open) setResetPhase("confirm");
          }}
          plan={resetPhase === "done" ? RESET_AFTER : RESET_BEFORE}
          phase={resetPhase}
          onConfirm={() => setResetPhase("done")}
        />
        <AppToaster />
      </TooltipProvider>
    </Ctx.Provider>
  );
}
