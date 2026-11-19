import type * as React from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BellRing,
  Briefcase,
  CalendarClock,
  ChevronRight,
  CircleDashed,
  CircleDollarSign,
  ClipboardCheck,
  CornerDownRight,
  Crosshair,
  FileText,
  Globe,
  Images,
  Inbox,
  type LucideIcon,
  MapPin,
  Menu,
  Paperclip,
  Radar,
  Radio,
  Search,
  Send,
  Server,
  Signal,
  Target,
  Timer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  AnimatedNumber,
  BAND_TEXT,
  BandDot,
  BootLog,
  CompanyLogo,
  FunnelMeter,
  PageHeader,
  ResourceMeter,
  ScanReport,
  ScoreHistogram,
  ScoutCard,
  type Band,
  type BootLine,
} from "@/components/jobhacker";
import { useDemo } from "../App";
import { DEFAULT_THRESHOLDS, type AppContact, type AppTask } from "../data";
import { type DashboardModel, type InFlightApp, dashboardModel } from "../model";
import { navigate } from "../router";
import { StatusChip } from "./ApplicationsView";
import deckHacker from "@/art/deck-hacker.webp";

/** The fill-coverage and time-to-submit goals, from the tool's purpose (AGENTS § what it's for). */
const FILL_TARGET = 80;
const TIME_TARGET = 5;

/** A whole-percent ratio for the status-line budget gauges. */
function pctOf(used: number | undefined, budget: number | undefined): number {
  return budget ? Math.round(((used ?? 0) / budget) * 100) : 0;
}

/** Each section and its panels carry one accent, so the console reads as color-coded subsystems. */
type Accent = "brand" | "info" | "strong" | "maybe" | "neutral";
const ACCENT: Record<Accent, { icon: string; chip: string }> = {
  brand: { icon: "text-brand-hi", chip: "bg-brand-wash ring-brand/25" },
  info: { icon: "text-info", chip: "bg-info-wash ring-info/25" },
  strong: { icon: "text-strong", chip: "bg-strong-wash ring-strong/25" },
  maybe: { icon: "text-maybe", chip: "bg-maybe-wash ring-maybe/25" },
  neutral: { icon: "text-fg-2", chip: "bg-surface-3 ring-line-2" },
};

export function DashboardView() {
  const { state, isMobile, openPalette, openMobileNav, runScout, refreshListings } = useDemo();
  const dash = dashboardModel(state);
  const live = state.scout != null;
  const needAction = dash.inFlight.filter((a) => a.needsAction).length;

  const boot: BootLine[] = [
    { tone: "ok", tag: "OK", text: `jobhacker v1 · recon console online` },
    { tone: "ok", tag: "OK", text: `db mounted ro · ${formatCount(dash.funnel[0]?.value ?? 0)} records · weights loaded` },
    { tone: "ok", tag: "OK", text: `last sweep clean · ${state.newLastRun} new · 0 errors` },
  ];
  const headline = `SIGINT // ${dash.signal.strong} strong · ${dash.signal.maybe} maybe locked in sector {portland, phoenix, remote}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        icon={Radar}
        kicker="Recon"
        title="Command"
        art={deckHacker}
        glitchKey={live ? "live" : "idle"}
        leading={
          isMobile ? (
            <Button variant="ghost" size="icon-sm" aria-label="Open navigation" onClick={openMobileNav}>
              <Menu />
            </Button>
          ) : null
        }
        actions={
          <>
            <Button variant="ghost" size="icon-sm" aria-label="Search and commands" onClick={openPalette}>
              <Search />
            </Button>
            <Button size="sm" onClick={runScout} disabled={live}>
              <Radar />
              {live ? "Scouting" : "Run scout"}
            </Button>
          </>
        }
        toolbar={
          <StatusLine
            live={live}
            lastRun={state.lastRun}
            boards={dash.boards.active}
            queue={dash.scored.unscored}
            inPlay={dash.signal.matches}
            usd={dash.spend.usd}
            jsearchPct={pctOf(dash.spend.sources[0]?.calls, dash.spend.sources[0]?.budget)}
            jobspipePct={pctOf(dash.spend.sources[1]?.credits, dash.spend.sources[1]?.creditBudget)}
          />
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-5 px-5 py-5 max-md:px-4 2xl:px-8">
          <BootLog
            lines={boot}
            headline={headline}
            epigraph="The quieter you become, the more you are able to hear."
            live={live}
          />

          {/* SIGNAL -------------------------------------------------------- */}
          <section>
            <SectionHeader icon={Signal} accent="brand" label="Signal" sub="act now" />
            <div className="grid gap-4 lg:grid-cols-12">
              <Panel title="Matches in play" icon={Crosshair} accent="brand" className="lg:col-span-8">
                <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2.5">
                      <AnimatedNumber
                        value={dash.signal.matches}
                        startFrom={0}
                        format={(n) => formatCount(Math.round(n))}
                        className="font-display text-5xl font-semibold leading-none tnum text-fg max-md:text-4xl"
                      />
                      <span className="hud-label text-fg-4">of {formatCount(dash.signal.scored)} scored</span>
                    </div>
                    <p className="mt-2 text-xs text-fg-3">Strong and Maybe under your saved weights.</p>
                  </div>
                  <div className="flex gap-6 lg:gap-9">
                    <BandStat band="strong" label="Strong" value={dash.signal.strong} />
                    <BandStat band="maybe" label="Maybe" value={dash.signal.maybe} />
                    <BandStat band="no" label="Weak" value={dash.signal.weak} />
                  </div>
                </div>
                <div className="mt-5 flex h-2.5 w-full overflow-hidden rounded-xs bg-surface-3">
                  <span className="bg-strong" style={{ flexGrow: dash.signal.strong }} />
                  <span className="bg-maybe" style={{ flexGrow: dash.signal.maybe }} />
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <Button size="sm" onClick={() => navigate("/matches")}>
                    Triage matches
                    <ArrowRight />
                  </Button>
                  <p className="flex items-center gap-1.5 text-2xs text-fg-4">
                    <Target aria-hidden className="size-3.5 text-brand-hi" />
                    All {dash.inWhere.strong + dash.inWhere.maybe} sit in your places
                  </p>
                </div>
              </Panel>

              <div className="grid gap-3 lg:col-span-4">
                <JumpCard
                  icon={Inbox}
                  label="New today"
                  value={dash.today.newToday}
                  sub="first seen in 24h"
                  onClick={() => navigate("/new")}
                />
                <JumpCard
                  icon={CircleDashed}
                  label="Unscored backlog"
                  value={dash.scored.unscored}
                  sub="waiting for a score"
                  onClick={() => navigate("/unscored")}
                />
                <JumpCard
                  icon={BellRing}
                  label="Follow-ups due"
                  value={dash.today.followUpsDue}
                  sub="due today"
                  tone={dash.today.followUpsDue ? "text-maybe" : undefined}
                  onClick={() => navigate("/applications/follow-ups")}
                />
              </div>
            </div>
          </section>

          {/* MISSION ------------------------------------------------------- */}
          <section>
            <SectionHeader icon={Briefcase} accent="maybe" label="Mission" sub="applications in flight" />
            <div className="grid gap-4 lg:grid-cols-12">
              <Panel
                title="Applications in flight"
                icon={Briefcase}
                accent="maybe"
                className="lg:col-span-8"
                action={<PanelLink onClick={() => navigate("/applications")}>All applications</PanelLink>}
              >
                <AppBoard apps={dash.inFlight} needAction={needAction} onOpen={(id) => navigate(`/applications/${id}`)} />
              </Panel>
              <div className="grid min-w-0 content-start gap-4 lg:col-span-4">
                <Panel title="Pipeline" icon={FileText} accent="maybe">
                  <PipelineList apply={dash.apply} />
                </Panel>
                <Panel title="Time to submit" icon={Timer} accent="maybe">
                  <TimeMeter medianMinutes={dash.time.medianMinutes} submissions={dash.time.submissions} />
                </Panel>
                <Panel title="Fill coverage" icon={ClipboardCheck} accent="maybe">
                  <FillBars rows={dash.fill} />
                </Panel>
              </div>
            </div>
          </section>

          {/* RECON --------------------------------------------------------- */}
          <section>
            <SectionHeader icon={Radar} accent="info" label="Recon pipeline" sub="signal out of noise" />
            <div className="grid gap-4 lg:grid-cols-12">
              <Panel title="Signal funnel" icon={Signal} accent="info" className="lg:col-span-4">
                <FunnelMeter stages={dash.funnel} />
              </Panel>
              <Panel title="Score spectrum" icon={Crosshair} accent="info" className="lg:col-span-8">
                <p className="mb-1 font-mono text-2xs tnum text-fg-4">
                  {formatCount(dash.signal.scored)} scored · bands at {DEFAULT_THRESHOLDS.maybe} / {DEFAULT_THRESHOLDS.strong}
                </p>
                <ScoreHistogram scores={dash.scores} thresholds={DEFAULT_THRESHOLDS} height={168} />
              </Panel>
              <Panel title="Source sweep" icon={Server} accent="info" className="lg:col-span-7">
                <ScanReport
                  rows={dash.boards.byAts.map((b) => ({ service: b.ats, count: b.count }))}
                  unit="boards"
                  caption={`JHMAP 1.0 · ${dash.boards.active} hosts up across ${dash.boards.byAts.length} services`}
                  footer={`${formatCount(dash.funnel[0]?.value ?? 0)} postings harvested · ${formatCount(dash.funnel[1]?.value ?? 0)} live`}
                />
              </Panel>
              <Panel title="Search reach" icon={Radio} accent="info" className="lg:col-span-5">
                <ScanReport
                  rows={dash.searchOnly.bySource.map((s) => ({ service: s.source, count: s.count }))}
                  unit="posts"
                  caption={`+${dash.searchOnly.total} only from search`}
                  footer="beyond the board sweep"
                />
              </Panel>
            </div>
          </section>

          {/* SECTOR -------------------------------------------------------- */}
          <section>
            <SectionHeader icon={MapPin} accent="strong" label="Sector" sub="where" />
            <div className="grid gap-4 lg:grid-cols-12">
              <Panel title="Open jobs by sector" icon={MapPin} accent="strong" className="lg:col-span-8">
                <SectorBars rows={dash.sector} />
              </Panel>
              <Panel title="In your places" icon={Target} accent="strong" className="lg:col-span-4">
                <div className="flex items-baseline gap-2.5">
                  <AnimatedNumber
                    value={dash.inWhere.strong + dash.inWhere.maybe}
                    startFrom={0}
                    format={(n) => formatCount(Math.round(n))}
                    className="font-display text-4xl font-semibold leading-none tnum text-fg"
                  />
                  <span className="hud-label text-fg-4">matches</span>
                </div>
                <div className="mt-3 flex gap-6">
                  <BandStat band="strong" label="Strong" value={dash.inWhere.strong} />
                  <BandStat band="maybe" label="Maybe" value={dash.inWhere.maybe} />
                </div>
                <p className="mt-3 text-2xs leading-relaxed text-fg-4">
                  Matches in Portland, Phoenix or Remote — the places in your where filter.
                </p>
              </Panel>
            </div>
          </section>

          {/* SYSTEMS ------------------------------------------------------- */}
          <section>
            <SectionHeader icon={Server} accent="neutral" label="Systems" sub="ops" />
            <div className="grid gap-4 lg:grid-cols-12">
              <div className="lg:col-span-4">
                <ScoutCard
                  lastRunLabel={state.lastRun}
                  boards={dash.boards.active}
                  newLastRun={state.newLastRun}
                  progress={state.scout}
                  onRun={runScout}
                  onRefresh={refreshListings}
                />
              </div>
              <Panel title="Budget · this month" icon={CircleDollarSign} accent="neutral" className="lg:col-span-4">
                <div className="space-y-3">
                  <ResourceMeter
                    label="JSearch calls"
                    value={dash.spend.sources[0]?.calls ?? 0}
                    max={dash.spend.sources[0]?.budget ?? 0}
                  />
                  <ResourceMeter
                    label="JobsPipe credits"
                    value={dash.spend.sources[1]?.credits ?? 0}
                    max={dash.spend.sources[1]?.creditBudget ?? 0}
                    unit="cr"
                  />
                  <div className="flex items-baseline justify-between border-t border-line pt-2.5">
                    <span className="hud-label text-fg-3">Model calls</span>
                    <span className="font-mono text-2xs tnum text-fg-2">
                      {formatCount(dash.spend.modelCalls)} · est ${dash.spend.usd.toFixed(2)}
                    </span>
                  </div>
                </div>
              </Panel>
              <Panel title="Coverage" icon={Images} accent="neutral" className="lg:col-span-4">
                <div className="space-y-3">
                  <ResourceMeter
                    label="Company logos"
                    value={dash.logos.withDomain}
                    max={dash.logos.companies}
                    warnAt={1.1}
                  />
                  <div className="flex items-baseline justify-between text-2xs">
                    <span className="hud-label text-fg-3">Confirmed</span>
                    <span className="font-mono tnum text-fg-2">{dash.logos.confirmed}</span>
                  </div>
                  <div className="flex items-baseline justify-between border-t border-line pt-2.5 text-2xs">
                    <span className="hud-label text-fg-3">Scored</span>
                    <span className="font-mono tnum text-fg-2">
                      {formatCount(dash.scored.current)} current · {dash.scored.stale} stale
                    </span>
                  </div>
                </div>
              </Panel>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/* ---------- Local pieces ---------- */

/** A tmux-style status line for the deck toolbar: live gauges in one monospace row. */
function StatusLine({
  live,
  lastRun,
  boards,
  queue,
  inPlay,
  usd,
  jsearchPct,
  jobspipePct,
}: {
  live: boolean;
  lastRun: string;
  boards: number;
  queue: number;
  inPlay: number;
  usd: number;
  jsearchPct: number;
  jobspipePct: number;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 font-mono text-2xs tnum text-fg-2">
      <StatusSeg>
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            live ? "animate-blink bg-brand-hi shadow-neon" : "bg-strong shadow-[0_0_6px_var(--color-strong)]",
          )}
        />
        <span className="text-fg-4">uplink</span>
        <span className={live ? "text-brand-hi" : "text-strong"}>{live ? "sweep" : "ok"}</span>
      </StatusSeg>
      <StatusDiv />
      <StatusSeg>
        <span className="text-fg-4">sweep</span>
        {lastRun.toLowerCase()}
      </StatusSeg>
      <StatusDiv />
      <StatusSeg>
        <span className="text-fg-4">boards</span>
        {formatCount(boards)}
      </StatusSeg>
      <StatusDiv />
      <StatusSeg>
        <span className="text-fg-4">queue</span>
        {formatCount(queue)}
      </StatusSeg>
      <StatusDiv />
      <StatusSeg>
        <span className="text-fg-4">in play</span>
        <span className="text-fg">{formatCount(inPlay)}</span>
      </StatusSeg>
      <StatusDiv />
      <StatusSeg>
        <span className="text-fg-4">spend</span>${usd.toFixed(2)}
      </StatusSeg>
      <StatusDiv />
      <StatusSeg>
        <span className="text-fg-4">jsearch</span>
        <span className={jsearchPct >= 85 ? "text-danger" : undefined}>{jsearchPct}%</span>
      </StatusSeg>
      <StatusDiv />
      <StatusSeg>
        <span className="text-fg-4">jobspipe</span>
        <span className={jobspipePct >= 85 ? "text-danger" : undefined}>{jobspipePct}%</span>
      </StatusSeg>
    </div>
  );
}

function StatusSeg({ children }: { children: React.ReactNode }) {
  return <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">{children}</span>;
}

function StatusDiv() {
  return <span aria-hidden className="h-3 w-px shrink-0 bg-line-2" />;
}

function SectionHeader({
  icon: Icon,
  label,
  sub,
  accent = "brand",
}: {
  icon: LucideIcon;
  label: string;
  sub?: string;
  accent?: Accent;
}) {
  return (
    <div className="mb-3.5 flex items-center gap-3">
      <span
        aria-hidden
        className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-lg ring-1", ACCENT[accent].chip)}
      >
        <Icon className={cn("size-5", ACCENT[accent].icon)} />
      </span>
      <div className="min-w-0">
        <h2 className="font-display text-sm font-semibold uppercase leading-none tracking-wider text-fg">{label}</h2>
        {sub ? <span className="hud-label mt-1 block text-fg-4">{sub}</span> : null}
      </div>
      <span aria-hidden className="ml-1 h-px flex-1 bg-line-2" />
    </div>
  );
}

function Panel({
  title,
  icon: Icon,
  accent = "brand",
  className,
  action,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  accent?: Accent;
  className?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("surface-card chamfer relative min-w-0 rounded-xl p-4 max-md:p-3.5", className)}>
      <header className="mb-3 flex items-center gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          {Icon ? <Icon aria-hidden className={cn("size-3.5 shrink-0", ACCENT[accent].icon)} /> : null}
          <span className="hud-label truncate text-fg-3">{title}</span>
        </span>
        <span aria-hidden className="h-px flex-1 bg-line-2" />
        {action ?? null}
      </header>
      {children}
    </section>
  );
}

function PanelLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex shrink-0 items-center gap-0.5 whitespace-nowrap text-2xs text-fg-4 outline-none transition-colors hover:text-fg-2 focus-visible:text-fg-2"
    >
      {children}
      <ChevronRight aria-hidden className="size-3" />
    </button>
  );
}

/** The Mission board: the live applications, urgent first, each with logo, stage, last contact, action. */
function AppBoard({ apps, needAction, onOpen }: { apps: InFlightApp[]; needAction: number; onOpen: (id: string) => void }) {
  return (
    <div>
      <p className="mb-2.5 flex items-center gap-2 font-mono text-2xs text-fg-4">
        <span className="text-fg-2">{apps.length} open</span>
        <span aria-hidden>·</span>
        {needAction ? (
          <span className="flex items-center gap-1 text-brand-hi">
            <BellRing aria-hidden className="size-3" />
            {needAction} need action today
          </span>
        ) : (
          <span>nothing due today</span>
        )}
      </p>
      <ul className="-mx-1.5 space-y-0.5">
        {apps.map((app) => (
          <li key={app.id}>
            <AppRow app={app} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function AppRow({ app, onOpen }: { app: InFlightApp; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(app.id)}
      className={cn(
        "group relative flex w-full items-center gap-3 rounded-lg py-2 pr-2 pl-2.5 text-left transition-colors hover:bg-surface-2 hover:row-wash",
        "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-uv-hi",
        app.needsAction &&
          "before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-brand-hi before:shadow-neon",
      )}
    >
      <CompanyLogo name={app.company} src={app.logoUrl} size={40} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium text-fg">{app.title}</span>
          <StatusChip status={app.status} />
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-2xs text-fg-3">
          <span className="shrink-0 text-fg-2">{app.company}</span>
          {app.contact ? (
            <>
              <span aria-hidden className="text-fg-4">·</span>
              <ContactLine contact={app.contact} />
            </>
          ) : null}
        </span>
      </span>
      {app.task ? <TaskChip task={app.task} /> : null}
      <ChevronRight
        aria-hidden
        className="size-4 shrink-0 text-fg-4 transition-transform group-hover:translate-x-0.5 group-hover:text-fg-2"
      />
    </button>
  );
}

function ContactLine({ contact }: { contact: AppContact }) {
  const Icon = contact.dir === "them" ? CornerDownRight : ArrowUpRight;
  return (
    <span className="flex min-w-0 items-center gap-1">
      <Icon aria-hidden className={cn("size-3 shrink-0", contact.dir === "them" ? "text-info" : "text-fg-4")} />
      <span className="truncate">{contact.label}</span>
      <span aria-hidden className="shrink-0 text-fg-4">·</span>
      <span className="shrink-0 tnum text-fg-4">{contact.at}</span>
    </span>
  );
}

const TASK_ICON: Record<AppTask["kind"], LucideIcon> = {
  followup: BellRing,
  send: Paperclip,
  confirm: CalendarClock,
};

function TaskChip({ task }: { task: AppTask }) {
  const Icon = TASK_ICON[task.kind];
  const tone =
    task.due === "overdue"
      ? "bg-danger-wash text-danger ring-danger/30"
      : task.due === "today"
        ? "bg-brand-wash text-brand-hi ring-brand/25"
        : "bg-surface-3 text-fg-2 ring-line-2";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-2xs font-medium ring-1 ring-inset",
        tone,
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span className="hidden max-w-[13rem] truncate lg:inline">{task.label}</span>
      <span aria-hidden className="hidden opacity-40 lg:inline">·</span>
      <span className="tnum">{task.dueLabel}</span>
    </span>
  );
}

function PipelineList({ apply }: { apply: DashboardModel["apply"] }) {
  const rows: { icon: LucideIcon; label: string; n: number; tone: string }[] = [
    { icon: FileText, label: "Prepared", n: apply.prepared, tone: "text-brand-hi" },
    { icon: ClipboardCheck, label: "Filled", n: apply.filled, tone: "text-info" },
    { icon: Send, label: "Submitted", n: apply.submitted, tone: "text-strong" },
    { icon: BellRing, label: "Follow-ups due", n: apply.followUpsDue, tone: "text-maybe" },
  ];
  return (
    <ul className="space-y-2">
      {rows.map(({ icon: Icon, label, n, tone }) => (
        <li key={label} className="flex items-center gap-2.5">
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-3 ring-1 ring-line-2">
            <Icon aria-hidden className={cn("size-3.5", tone)} />
          </span>
          <span className="flex-1 text-xs text-fg-2">{label}</span>
          <span className="font-display text-lg font-semibold tnum text-fg">{formatCount(n)}</span>
        </li>
      ))}
    </ul>
  );
}

function BandStat({ band, label, value }: { band: Band; label: string; value: number }) {
  return (
    <div className="min-w-0">
      <span className="flex items-center gap-1.5">
        <BandDot band={band} />
        <span className="hud-label text-fg-3">{label}</span>
      </span>
      <AnimatedNumber
        value={value}
        startFrom={0}
        format={(n) => formatCount(Math.round(n))}
        className={cn("mt-0.5 block font-display text-2xl font-semibold tnum", BAND_TEXT[band])}
      />
    </div>
  );
}

function JumpCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  sub?: string;
  tone?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "surface-card chamfer group relative flex w-full items-center gap-3 rounded-xl p-3.5 text-left transition-colors",
        "hover:bg-surface-2 hover:row-wash",
        "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-uv-hi",
      )}
    >
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-3 ring-1 ring-line-2">
        <Icon aria-hidden className={cn("size-4", tone ?? "text-brand-hi")} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="hud-label block text-fg-3">{label}</span>
        <span className="flex items-baseline gap-2">
          <AnimatedNumber
            value={value}
            startFrom={0}
            format={(n) => formatCount(Math.round(n))}
            className="font-display text-2xl font-semibold leading-tight tnum text-fg"
          />
          {sub ? <span className="truncate text-2xs text-fg-4">{sub}</span> : null}
        </span>
      </span>
      <ChevronRight
        aria-hidden
        className="size-4 shrink-0 text-fg-4 transition-transform group-hover:translate-x-0.5 group-hover:text-fg-2"
      />
    </button>
  );
}

function SectorBars({ rows }: { rows: { id: string; label: string; count: number; kind: "place" | "remote" | "rest" }[] }) {
  const placeMax = Math.max(1, ...rows.filter((r) => r.kind !== "rest").map((r) => r.count));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const Icon = r.kind === "remote" ? Globe : MapPin;
        const mine = r.kind !== "rest";
        return (
          <li key={r.id} className="flex items-center gap-2.5">
            {mine ? (
              <Icon aria-hidden className="size-3.5 shrink-0 text-brand-hi" />
            ) : (
              <span aria-hidden className="size-3.5 shrink-0" />
            )}
            <span className={cn("w-20 shrink-0 text-xs", mine ? "text-fg-2" : "text-fg-4")}>{r.label}</span>
            {mine ? (
              <span className="relative h-2 min-w-0 flex-1 overflow-hidden bg-surface-3">
                <span
                  className="absolute inset-y-0 left-0 block origin-left animate-bar-grow bg-brand"
                  style={{ width: `${(r.count / placeMax) * 100}%` }}
                />
              </span>
            ) : (
              <span className="min-w-0 flex-1 text-2xs text-fg-4">outside your places</span>
            )}
            <span className={cn("w-16 shrink-0 text-right text-sm tnum", mine ? "text-fg" : "text-fg-3")}>
              {formatCount(r.count)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function TimeMeter({ medianMinutes, submissions }: { medianMinutes: number; submissions: number }) {
  const scaleMax = Math.max(medianMinutes, TIME_TARGET) * 1.3;
  const over = medianMinutes > TIME_TARGET;
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <AnimatedNumber
          value={medianMinutes}
          startFrom={0}
          className={cn("font-display text-4xl font-semibold leading-none tnum", over ? "text-maybe" : "text-strong")}
        />
        <span className="hud-label text-fg-4">min median</span>
      </div>
      <div className="relative mt-3 h-2 w-full overflow-hidden bg-surface-3">
        <span
          className={cn("absolute inset-y-0 left-0 block origin-left animate-bar-grow", over ? "bg-maybe" : "bg-strong")}
          style={{ width: `${Math.min((medianMinutes / scaleMax) * 100, 100)}%` }}
        />
        <span
          aria-hidden
          className="absolute inset-y-0 w-px bg-fg-2"
          style={{ left: `${(TIME_TARGET / scaleMax) * 100}%` }}
        />
      </div>
      <p className="mt-1.5 text-2xs text-fg-4">
        target &lt; {TIME_TARGET} min · over {submissions} submissions
      </p>
    </div>
  );
}

function FillBars({ rows }: { rows: { ats: string; pct: number; forms: number }[] }) {
  const tone = (pct: number) => (pct >= FILL_TARGET ? "bg-strong" : pct >= 50 ? "bg-maybe" : "bg-danger");
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.ats} className="flex items-center gap-2.5">
          <span className="w-24 shrink-0 truncate text-xs text-fg-2">{r.ats}</span>
          <span className="relative h-2 min-w-0 flex-1 overflow-hidden bg-surface-3">
            <span
              className={cn("absolute inset-y-0 left-0 block origin-left animate-bar-grow", tone(r.pct))}
              style={{ width: `${Math.max(r.pct, 1)}%` }}
            />
            <span aria-hidden className="absolute inset-y-0 w-px bg-fg-2/60" style={{ left: `${FILL_TARGET}%` }} />
          </span>
          <span className="w-9 shrink-0 text-right text-xs tnum text-fg">{r.pct}%</span>
        </li>
      ))}
    </ul>
  );
}
