'use client';

import {
  AnimatedNumber,
  BAND_TEXT,
  type Band,
  BandDot,
  type BootLine,
  BootLog,
  FunnelMeter,
  PageHeader,
  ResourceMeter,
  ScanReport,
  ScoreHistogram,
  ScoutCard,
} from '@/components/jobhacker';
import { Button, buttonVariants } from '@/components/ui/button';
import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  ArrowRight,
  BellRing,
  Briefcase,
  ChevronRight,
  CircleDashed,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  Crosshair,
  FileText,
  Globe,
  Images,
  Inbox,
  type LucideIcon,
  MapPin,
  Radar,
  Radio,
  Send,
  Server,
  Signal,
  StickyNote,
  Target,
  Timer,
} from 'lucide-react';
import Link from 'next/link';
import {
  MobileNavButton,
  useRefreshListings,
  useRunScout,
  useScoutLive,
} from '../../components/app-shell.js';
import type { DashboardData, FollowUpDue, InFlightApp } from '../lib/dashboard-types.js';
import type { ScoutCardView } from '../lib/shell-types.js';
import { STATUS_CHIP, STATUS_LABEL, statusChipClass } from '../lib/status.js';
import { CompanyTile } from './LogoEditor.js';

/** The fill-coverage and time-to-submit goals (AGENTS § what it's for). */
const FILL_TARGET = 80;
const TIME_TARGET = 5;

/** A whole-percent ratio for the status-line budget gauges. */
function pctOf(used: number | undefined, budget: number | undefined): number {
  return budget ? Math.round(((used ?? 0) / budget) * 100) : 0;
}

/** Each section and its panels carry one accent, so the console reads as color-coded subsystems. */
type Accent = 'brand' | 'info' | 'strong' | 'maybe' | 'neutral';
const ACCENT: Record<Accent, { icon: string; chip: string }> = {
  brand: { icon: 'text-brand-hi', chip: 'bg-brand-wash ring-brand/25' },
  info: { icon: 'text-info', chip: 'bg-info-wash ring-info/25' },
  strong: { icon: 'text-strong', chip: 'bg-strong-wash ring-strong/25' },
  maybe: { icon: 'text-maybe', chip: 'bg-maybe-wash ring-maybe/25' },
  neutral: { icon: 'text-fg-2', chip: 'bg-surface-3 ring-line-2' },
};

/**
 * The recon-console dashboard at `/` (J23). Presentational: the server (`getDashboard`) hands in
 * `data`, and the scout actions and live state come from the shell. Mirrors the prototype's
 * `DashboardView`, with the Mission board on real applications.
 */
export function Dashboard({
  data,
  scout,
  clientId,
}: {
  data: DashboardData;
  scout: ScoutCardView | null;
  clientId: string | null;
}) {
  const runScout = useRunScout();
  const refresh = useRefreshListings();
  const live = useScoutLive();
  const scoutState = live ?? {
    lastRunLabel: scout?.lastRunLabel ?? '—',
    boards: scout?.boards ?? data.boards.active,
    newLastRun: scout?.newLastRun ?? 0,
    progress: scout?.running ? (scout.progress ?? null) : null,
    running: scout?.running ?? false,
  };
  const running = scoutState.running;

  const places = data.sector.filter((s) => s.kind !== 'rest').map((s) => s.id);
  const boot: BootLine[] = [
    { tone: 'ok', tag: 'OK', text: 'jobhacker v1 · recon console online' },
    {
      tone: 'ok',
      tag: 'OK',
      text: `db mounted ro · ${formatCount(data.funnel[0]?.value ?? 0)} records · weights loaded`,
    },
    {
      tone: 'ok',
      tag: 'OK',
      text: `last sweep ${scoutState.lastRunLabel.toLowerCase()} · ${formatCount(scoutState.newLastRun)} new`,
    },
  ];
  const headline = places.length
    ? `SIGINT // ${data.signal.strong} strong · ${data.signal.maybe} maybe locked in sector {${places.join(', ')}}`
    : `SIGINT // ${data.signal.strong} strong · ${data.signal.maybe} maybe in play`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        icon={Radar}
        kicker="Recon"
        title="Command"
        art="/art/deck-hacker.webp"
        glitchKey={running ? 'live' : 'idle'}
        leading={<MobileNavButton />}
        actions={
          <Button size="sm" onClick={runScout} disabled={running}>
            <Radar />
            {running ? 'Scouting' : 'Run scout'}
          </Button>
        }
        toolbar={
          <StatusLine
            live={running}
            lastRun={scoutState.lastRunLabel}
            boards={data.boards.active}
            queue={data.scored.unscored}
            inPlay={data.signal.matches}
            usd={data.spend.usd}
            jsearchPct={pctOf(data.spend.sources[0]?.calls, data.spend.sources[0]?.budget)}
            jobspipePct={pctOf(data.spend.sources[1]?.credits, data.spend.sources[1]?.creditBudget)}
          />
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-5 px-5 py-5 max-md:px-4 2xl:px-8">
          <BootLog
            lines={boot}
            headline={headline}
            epigraph="The quieter you become, the more you are able to hear."
            live={running}
          />

          {/* SIGNAL -------------------------------------------------------- */}
          <section>
            <SectionHeader icon={Signal} accent="brand" label="Signal" sub="act now" />
            <div className="grid gap-4 lg:grid-cols-12">
              <Panel
                title="Matches in play"
                icon={Crosshair}
                accent="brand"
                className="lg:col-span-8"
              >
                <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2.5">
                      <AnimatedNumber
                        value={data.signal.matches}
                        startFrom={0}
                        format={(n) => formatCount(Math.round(n))}
                        className="font-display text-5xl font-semibold leading-none tnum text-fg max-md:text-4xl"
                      />
                      <span className="hud-label text-fg-4">
                        of {formatCount(data.signal.scored)} scored
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-fg-3">
                      Strong and Maybe under your saved weights.
                    </p>
                  </div>
                  <div className="flex gap-6 lg:gap-9">
                    <BandStat band="strong" label="Strong" value={data.signal.strong} />
                    <BandStat band="maybe" label="Maybe" value={data.signal.maybe} />
                    <BandStat band="no" label="Weak" value={data.signal.weak} />
                  </div>
                </div>
                <div className="mt-5 flex h-2.5 w-full overflow-hidden rounded-xs bg-surface-3">
                  <span className="bg-strong" style={{ flexGrow: data.signal.strong }} />
                  <span className="bg-maybe" style={{ flexGrow: data.signal.maybe }} />
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <Link href="/matches" className={buttonVariants({ size: 'sm' })}>
                    Triage matches
                    <ArrowRight />
                  </Link>
                  <p className="flex items-center gap-1.5 text-2xs text-fg-4">
                    <Target aria-hidden className="size-3.5 text-brand-hi" />
                    All {data.inWhere.strong + data.inWhere.maybe} sit in your places
                  </p>
                </div>
              </Panel>

              <div className="grid gap-3 lg:col-span-4">
                <JumpCard
                  icon={Inbox}
                  label="New today"
                  value={data.today.newToday}
                  sub="first seen in 24h"
                  href="/new"
                />
                <JumpCard
                  icon={CircleDashed}
                  label="Unscored backlog"
                  value={data.scored.unscored}
                  sub="waiting for a score"
                  href="/unscored"
                />
                <JumpCard
                  icon={BellRing}
                  label="Follow-ups due"
                  value={data.today.followUpsDue}
                  sub="due today"
                  tone={data.today.followUpsDue ? 'text-maybe' : undefined}
                  href="/applications/follow-ups"
                />
              </div>
            </div>
          </section>

          {/* MISSION ------------------------------------------------------- */}
          <section>
            <SectionHeader
              icon={Briefcase}
              accent="maybe"
              label="Mission"
              sub="applications in flight"
            />
            <div className="grid gap-4 lg:grid-cols-12">
              <Panel
                title="Applications in flight"
                icon={Briefcase}
                accent="maybe"
                className="lg:col-span-8"
                action={<PanelLink href="/applications">All applications</PanelLink>}
              >
                <AppBoard
                  apps={data.inFlight}
                  openCount={data.openCount}
                  needAction={data.needAction}
                  clientId={clientId}
                />
              </Panel>
              <div className="grid min-w-0 content-start gap-4 lg:col-span-4">
                <Panel title="Pipeline" icon={FileText} accent="maybe">
                  <PipelineList apply={data.apply} />
                </Panel>
                <Panel title="Time to submit" icon={Timer} accent="maybe">
                  <TimeMeter
                    medianMinutes={data.time.medianMinutes}
                    submissions={data.time.submissions}
                  />
                </Panel>
                <Panel title="Fill coverage" icon={ClipboardCheck} accent="maybe">
                  <FillBars rows={data.fill} />
                </Panel>
              </div>
            </div>
          </section>

          {/* RECON --------------------------------------------------------- */}
          <section>
            <SectionHeader
              icon={Radar}
              accent="info"
              label="Recon pipeline"
              sub="signal out of noise"
            />
            <div className="grid gap-4 lg:grid-cols-12">
              <Panel title="Signal funnel" icon={Signal} accent="info" className="lg:col-span-4">
                <FunnelMeter stages={data.funnel} />
              </Panel>
              <Panel
                title="Score spectrum"
                icon={Crosshair}
                accent="info"
                className="lg:col-span-8"
              >
                <p className="mb-1 font-mono text-2xs tnum text-fg-4">
                  {formatCount(data.signal.scored)} scored · bands at {data.thresholds.maybe} /{' '}
                  {data.thresholds.strong}
                </p>
                <ScoreHistogram scores={data.scores} thresholds={data.thresholds} height={168} />
              </Panel>
              <Panel title="Source sweep" icon={Server} accent="info" className="lg:col-span-7">
                <ScanReport
                  rows={data.boards.byAts.map((b) => ({ service: b.ats, count: b.count }))}
                  unit="boards"
                  caption={`JHMAP 1.0 · ${data.boards.active} hosts up across ${data.boards.byAts.length} services`}
                  footer={`${formatCount(data.funnel[0]?.value ?? 0)} postings harvested · ${formatCount(
                    data.funnel[1]?.value ?? 0,
                  )} live`}
                />
              </Panel>
              <Panel title="Search reach" icon={Radio} accent="info" className="lg:col-span-5">
                {data.searchOnly.bySource.length > 0 ? (
                  <ScanReport
                    rows={data.searchOnly.bySource.map((s) => ({
                      service: s.source,
                      count: s.count,
                    }))}
                    unit="posts"
                    caption={`+${formatCount(data.searchOnly.total)} only from search`}
                    footer="beyond the board sweep"
                  />
                ) : (
                  <p className="font-mono text-2xs text-fg-4">
                    No search-only postings yet — every stored job also came from a board sweep.
                  </p>
                )}
              </Panel>
            </div>
          </section>

          {/* SECTOR -------------------------------------------------------- */}
          <section>
            <SectionHeader icon={MapPin} accent="strong" label="Sector" sub="where" />
            <div className="grid gap-4 lg:grid-cols-12">
              <Panel
                title="Open jobs by sector"
                icon={MapPin}
                accent="strong"
                className="lg:col-span-8"
              >
                {data.sector.length > 0 ? (
                  <SectorBars rows={data.sector} />
                ) : (
                  <p className="text-xs text-fg-4">
                    Places aren&rsquo;t set up yet, so there&rsquo;s nothing to break down by
                    sector.
                  </p>
                )}
              </Panel>
              <Panel title="In your places" icon={Target} accent="strong" className="lg:col-span-4">
                <div className="flex items-baseline gap-2.5">
                  <AnimatedNumber
                    value={data.inWhere.strong + data.inWhere.maybe}
                    startFrom={0}
                    format={(n) => formatCount(Math.round(n))}
                    className="font-display text-4xl font-semibold leading-none tnum text-fg"
                  />
                  <span className="hud-label text-fg-4">matches</span>
                </div>
                <div className="mt-3 flex gap-6">
                  <BandStat band="strong" label="Strong" value={data.inWhere.strong} />
                  <BandStat band="maybe" label="Maybe" value={data.inWhere.maybe} />
                </div>
                <p className="mt-3 text-2xs leading-relaxed text-fg-4">
                  Matches in the places in your where filter.
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
                  lastRunLabel={scoutState.lastRunLabel}
                  boards={scoutState.boards}
                  newLastRun={scoutState.newLastRun}
                  progress={scoutState.progress}
                  onRun={runScout}
                  onRefresh={refresh}
                />
              </div>
              <Panel
                title="Budget · this month"
                icon={CircleDollarSign}
                accent="neutral"
                className="lg:col-span-4"
              >
                <div className="space-y-3">
                  <ResourceMeter
                    label="JSearch calls"
                    value={data.spend.sources[0]?.calls ?? 0}
                    max={data.spend.sources[0]?.budget ?? 0}
                  />
                  <ResourceMeter
                    label="JobsPipe credits"
                    value={data.spend.sources[1]?.credits ?? 0}
                    max={data.spend.sources[1]?.creditBudget ?? 0}
                    unit="cr"
                  />
                  <div className="flex items-baseline justify-between border-t border-line pt-2.5">
                    <span className="hud-label text-fg-3">Model calls</span>
                    <span className="font-mono text-2xs tnum text-fg-2">
                      {formatCount(data.spend.modelCalls)} · est ${data.spend.usd.toFixed(2)}
                    </span>
                  </div>
                </div>
              </Panel>
              <Panel title="Coverage" icon={Images} accent="neutral" className="lg:col-span-4">
                <div className="space-y-3">
                  <ResourceMeter
                    label="Company logos"
                    value={data.logos.withDomain}
                    max={data.logos.companies}
                    warnAt={1.1}
                  />
                  <div className="flex items-baseline justify-between text-2xs">
                    <span className="hud-label text-fg-3">Confirmed</span>
                    <span className="font-mono tnum text-fg-2">{data.logos.confirmed}</span>
                  </div>
                  <div className="flex items-baseline justify-between border-t border-line pt-2.5 text-2xs">
                    <span className="hud-label text-fg-3">Scored</span>
                    <span className="font-mono tnum text-fg-2">
                      {formatCount(data.scored.current)} current · {data.scored.stale} stale
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
            'size-1.5 rounded-full',
            live
              ? 'animate-blink bg-brand-hi shadow-neon'
              : 'bg-strong shadow-[0_0_6px_var(--color-strong)]',
          )}
        />
        <span className="text-fg-4">uplink</span>
        <span className={live ? 'text-brand-hi' : 'text-strong'}>{live ? 'sweep' : 'ok'}</span>
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
        <span className={jsearchPct >= 85 ? 'text-danger' : undefined}>{jsearchPct}%</span>
      </StatusSeg>
      <StatusDiv />
      <StatusSeg>
        <span className="text-fg-4">jobspipe</span>
        <span className={jobspipePct >= 85 ? 'text-danger' : undefined}>{jobspipePct}%</span>
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
  accent = 'brand',
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
        className={cn(
          'inline-flex size-9 shrink-0 items-center justify-center rounded-lg ring-1',
          ACCENT[accent].chip,
        )}
      >
        <Icon className={cn('size-5', ACCENT[accent].icon)} />
      </span>
      <div className="min-w-0">
        <h2 className="font-display text-sm font-semibold uppercase leading-none tracking-wider text-fg">
          {label}
        </h2>
        {sub ? <span className="hud-label mt-1 block text-fg-4">{sub}</span> : null}
      </div>
      <span aria-hidden className="ml-1 h-px flex-1 bg-line-2" />
    </div>
  );
}

function Panel({
  title,
  icon: Icon,
  accent = 'brand',
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
    <section
      className={cn('surface-card chamfer relative min-w-0 rounded-xl p-4 max-md:p-3.5', className)}
    >
      <header className="mb-3 flex items-center gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          {Icon ? (
            <Icon aria-hidden className={cn('size-3.5 shrink-0', ACCENT[accent].icon)} />
          ) : null}
          <span className="hud-label truncate text-fg-3">{title}</span>
        </span>
        <span aria-hidden className="h-px flex-1 bg-line-2" />
        {action ?? null}
      </header>
      {children}
    </section>
  );
}

function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex shrink-0 items-center gap-0.5 whitespace-nowrap text-2xs text-fg-4 outline-none transition-colors hover:text-fg-2 focus-visible:text-fg-2"
    >
      {children}
      <ChevronRight aria-hidden className="size-3" />
    </Link>
  );
}

/** The Mission board: the open applications, urgent first, each with logo, stage, activity, follow-up. */
function AppBoard({
  apps,
  openCount,
  needAction,
  clientId,
}: {
  apps: InFlightApp[];
  openCount: number;
  needAction: number;
  clientId: string | null;
}) {
  if (apps.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 py-8 text-center">
        <Briefcase aria-hidden className="size-5 text-fg-4" />
        <p className="text-sm text-fg-2">Nothing in flight</p>
        <p className="text-2xs text-fg-4">
          Shortlist a job and prepare an application to start one.
        </p>
      </div>
    );
  }
  return (
    <div>
      <p className="mb-2.5 flex items-center gap-2 font-mono text-2xs text-fg-4">
        <span className="text-fg-2">{openCount} open</span>
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
          <li key={app.applicationId}>
            <AppRow app={app} clientId={clientId} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function AppRow({ app, clientId }: { app: InFlightApp; clientId: string | null }) {
  return (
    <Link
      href={`/applications/${app.applicationId}`}
      className={cn(
        'group relative flex w-full items-center gap-3 rounded-lg py-2 pr-2 pl-2.5 text-left transition-colors hover:bg-surface-2 hover:row-wash',
        'outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-uv-hi',
        app.needsAction &&
          'before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-brand-hi before:shadow-neon',
      )}
    >
      <CompanyTile
        name={app.company}
        domain={app.logo.domain}
        logoSource={app.logo.logoSource}
        markUrl={app.logo.markUrl}
        clientId={clientId}
        size={40}
      />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium text-fg">{app.title}</span>
          <span className={cn(STATUS_CHIP, statusChipClass(app.status))}>
            {STATUS_LABEL[app.status] ?? app.status}
          </span>
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-2xs text-fg-3">
          <span className="shrink-0 text-fg-2">{app.company}</span>
          {app.activity ? (
            <>
              <span aria-hidden className="text-fg-4">
                ·
              </span>
              <ActivityLine activity={app.activity} />
            </>
          ) : null}
        </span>
      </span>
      {app.hasNote ? (
        <StickyNote aria-label="Has notes" className="size-3.5 shrink-0 text-fg-4" />
      ) : null}
      {app.followUp ? <FollowUpChip followUp={app.followUp} /> : null}
      <ChevronRight
        aria-hidden
        className="size-4 shrink-0 text-fg-4 transition-transform group-hover:translate-x-0.5 group-hover:text-fg-2"
      />
    </Link>
  );
}

/** The newest logged event for the application — always a real action JobHacker took (invariant 3). */
function ActivityLine({ activity }: { activity: { label: string; at: string } }) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      <Clock3 aria-hidden className="size-3 shrink-0 text-fg-4" />
      <span className="truncate">{activity.label}</span>
      <span aria-hidden className="shrink-0 text-fg-4">
        ·
      </span>
      <span className="shrink-0 tnum text-fg-4">{activity.at}</span>
    </span>
  );
}

function FollowUpChip({ followUp }: { followUp: { label: string; due: FollowUpDue } }) {
  const tone =
    followUp.due === 'overdue'
      ? 'bg-danger-wash text-danger ring-danger/30'
      : followUp.due === 'today'
        ? 'bg-brand-wash text-brand-hi ring-brand/25'
        : 'bg-surface-3 text-fg-2 ring-line-2';
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-2xs font-medium ring-1 ring-inset',
        tone,
      )}
    >
      <BellRing aria-hidden className="size-3.5 shrink-0" />
      <span className="hidden lg:inline">Follow up</span>
      <span aria-hidden className="hidden opacity-40 lg:inline">
        ·
      </span>
      <span className="tnum">{followUp.label}</span>
    </span>
  );
}

function PipelineList({ apply }: { apply: DashboardData['apply'] }) {
  const rows: { icon: LucideIcon; label: string; n: number; tone: string }[] = [
    { icon: FileText, label: 'Prepared', n: apply.prepared, tone: 'text-brand-hi' },
    { icon: ClipboardCheck, label: 'Filled', n: apply.filled, tone: 'text-info' },
    { icon: Send, label: 'Submitted', n: apply.submitted, tone: 'text-strong' },
    { icon: BellRing, label: 'Follow-ups due', n: apply.followUpsDue, tone: 'text-maybe' },
  ];
  return (
    <ul className="space-y-2">
      {rows.map(({ icon: Icon, label, n, tone }) => (
        <li key={label} className="flex items-center gap-2.5">
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-3 ring-1 ring-line-2">
            <Icon aria-hidden className={cn('size-3.5', tone)} />
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
        className={cn('mt-0.5 block font-display text-2xl font-semibold tnum', BAND_TEXT[band])}
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
  href,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  sub?: string;
  tone?: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'surface-card chamfer group relative flex w-full items-center gap-3 rounded-xl p-3.5 text-left transition-colors',
        'hover:bg-surface-2 hover:row-wash',
        'outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-uv-hi',
      )}
    >
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-3 ring-1 ring-line-2">
        <Icon aria-hidden className={cn('size-4', tone ?? 'text-brand-hi')} />
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
    </Link>
  );
}

function SectorBars({
  rows,
}: {
  rows: { id: string; label: string; count: number; kind: 'place' | 'remote' | 'rest' }[];
}) {
  const placeMax = Math.max(1, ...rows.filter((r) => r.kind !== 'rest').map((r) => r.count));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const Icon = r.kind === 'remote' ? Globe : MapPin;
        const mine = r.kind !== 'rest';
        return (
          <li key={r.id} className="flex items-center gap-2.5">
            {mine ? (
              <Icon aria-hidden className="size-3.5 shrink-0 text-brand-hi" />
            ) : (
              <span aria-hidden className="size-3.5 shrink-0" />
            )}
            <span className={cn('w-20 shrink-0 text-xs', mine ? 'text-fg-2' : 'text-fg-4')}>
              {r.label}
            </span>
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
            <span
              className={cn(
                'w-16 shrink-0 text-right text-sm tnum',
                mine ? 'text-fg' : 'text-fg-3',
              )}
            >
              {formatCount(r.count)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function TimeMeter({
  medianMinutes,
  submissions,
}: {
  medianMinutes: number | null;
  submissions: number;
}) {
  if (medianMinutes === null) {
    return (
      <div>
        <div className="flex items-baseline gap-2">
          <span className="font-display text-4xl font-semibold leading-none tnum text-fg-3">—</span>
          <span className="hud-label text-fg-4">no times yet</span>
        </div>
        <p className="mt-3 text-2xs text-fg-4">
          {submissions === 0
            ? 'No submissions yet.'
            : `${formatCount(submissions)} submitted, none with a shortlist time.`}
        </p>
      </div>
    );
  }
  const scaleMax = Math.max(medianMinutes, TIME_TARGET) * 1.3;
  const over = medianMinutes > TIME_TARGET;
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <AnimatedNumber
          value={medianMinutes}
          startFrom={0}
          className={cn(
            'font-display text-4xl font-semibold leading-none tnum',
            over ? 'text-maybe' : 'text-strong',
          )}
        />
        <span className="hud-label text-fg-4">min median</span>
      </div>
      <div className="relative mt-3 h-2 w-full overflow-hidden bg-surface-3">
        <span
          className={cn(
            'absolute inset-y-0 left-0 block origin-left animate-bar-grow',
            over ? 'bg-maybe' : 'bg-strong',
          )}
          style={{ width: `${Math.min((medianMinutes / scaleMax) * 100, 100)}%` }}
        />
        <span
          aria-hidden
          className="absolute inset-y-0 w-px bg-fg-2"
          style={{ left: `${(TIME_TARGET / scaleMax) * 100}%` }}
        />
      </div>
      <p className="mt-1.5 text-2xs text-fg-4">
        target &lt; {TIME_TARGET} min · over {formatCount(submissions)} submissions
      </p>
    </div>
  );
}

function FillBars({ rows }: { rows: { ats: string; pct: number; forms: number }[] }) {
  if (rows.length === 0) {
    return <p className="text-2xs text-fg-4">No fill reports yet.</p>;
  }
  const tone = (pct: number) =>
    pct >= FILL_TARGET ? 'bg-strong' : pct >= 50 ? 'bg-maybe' : 'bg-danger';
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.ats} className="flex items-center gap-2.5">
          <span className="w-24 shrink-0 truncate text-xs text-fg-2">{r.ats}</span>
          <span className="relative h-2 min-w-0 flex-1 overflow-hidden bg-surface-3">
            <span
              className={cn(
                'absolute inset-y-0 left-0 block origin-left animate-bar-grow',
                tone(r.pct),
              )}
              style={{ width: `${Math.max(r.pct, 1)}%` }}
            />
            <span
              aria-hidden
              className="absolute inset-y-0 w-px bg-fg-2/60"
              style={{ left: `${FILL_TARGET}%` }}
            />
          </span>
          <span className="w-9 shrink-0 text-right text-xs tnum text-fg">{r.pct}%</span>
        </li>
      ))}
    </ul>
  );
}
