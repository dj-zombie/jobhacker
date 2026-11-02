import { EmptyState, PageHeader, ScorePill } from '@/components/jobhacker';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  BellRing,
  ChevronRight,
  FileText,
  type LucideIcon,
  MessagesSquare,
  Send,
  TriangleAlert,
  Trophy,
} from 'lucide-react';
import Link from 'next/link';
import { MobileNavButton } from '../../components/app-shell.js';
import type { ApplicationList } from '../../core/pipeline/tracker.js';
import { brandfetchClientId, getApplicationList, getUiConfig } from '../lib/queries.js';
import { STATUS_CHIP, STATUS_LABEL, statusChipClass } from '../lib/status.js';
import type { ApplicationRowView, StageCounts } from '../lib/workspace-types.js';
import { CompanyTile } from './LogoEditor.js';

const META: Record<ApplicationList, { title: string; icon: LucideIcon }> = {
  'in-progress': { title: 'In progress', icon: FileText },
  submitted: { title: 'Submitted', icon: Send },
  'follow-ups': { title: 'Follow-ups', icon: BellRing },
};

const STAGES: {
  key: keyof StageCounts;
  label: string;
  icon: LucideIcon;
  href: string | null;
  tone: string;
  list: ApplicationList | null;
}[] = [
  {
    key: 'prepped',
    label: 'Prepped',
    icon: FileText,
    href: '/applications',
    tone: 'text-brand-hi',
    list: 'in-progress',
  },
  {
    key: 'submitted',
    label: 'Submitted',
    icon: Send,
    href: '/applications/submitted',
    tone: 'text-strong',
    list: 'submitted',
  },
  {
    key: 'interviewing',
    label: 'Interviewing',
    icon: MessagesSquare,
    href: null,
    tone: 'text-info',
    list: null,
  },
  { key: 'offer', label: 'Offer', icon: Trophy, href: null, tone: 'text-maybe', list: null },
];

/**
 * The pipeline (J7): `/applications` (in progress), `/applications/submitted` and
 * `/applications/follow-ups`, as the reference's stage cards over one list.
 */
export function ApplicationsList({ list }: { list: ApplicationList }) {
  const meta = META[list];
  const config = getUiConfig();
  const header = (count?: number) => (
    <PageHeader
      icon={meta.icon}
      title={meta.title}
      count={count}
      leading={<MobileNavButton />}
      actions={
        <a href="/applications/export" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          Export CSV
        </a>
      }
    />
  );

  if (!config.ok) {
    return (
      <>
        {header()}
        <EmptyState
          icon={TriangleAlert}
          title="The config has an error"
          body={
            <pre className="mt-2 max-w-xl whitespace-pre-wrap rounded-md border border-danger/30 bg-danger-wash p-3 text-left font-mono text-xs text-danger">
              {config.error}
            </pre>
          }
        />
      </>
    );
  }

  const data = getApplicationList(config, list);
  const clientId = brandfetchClientId();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header(data.rows.length)}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-5 py-5 max-md:px-4">
          <ol className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {STAGES.map((stage, i) => (
              <li key={stage.key} className="relative">
                <StageCard
                  stage={stage}
                  count={data.stages[stage.key]}
                  active={stage.list === list}
                />
                {i < STAGES.length - 1 ? (
                  <ChevronRight
                    aria-hidden
                    className="absolute -right-2.5 top-1/2 z-10 hidden size-4 -translate-y-1/2 text-fg-4 lg:block"
                  />
                ) : null}
              </li>
            ))}
          </ol>

          {data.rows.length === 0 ? (
            <EmptyState
              className="py-16"
              icon={list === 'follow-ups' ? BellRing : list === 'submitted' ? Send : FileText}
              {...emptyCopy(list, data.nextFollowUp)}
            />
          ) : (
            <ul className="mt-5 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface-1 shadow-card">
              {data.rows.map((row) => (
                <Row key={row.applicationId} row={row} clientId={clientId} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function emptyCopy(
  list: ApplicationList,
  next: { company: string; date: string } | null,
): { title: string; body: string } {
  if (list === 'follow-ups') {
    return {
      title: 'No follow-ups due',
      body: next
        ? `${next.company}'s follow-up comes due on ${next.date}. It will show up here that morning.`
        : 'When you mark an application submitted, its follow-up shows up here on the day it comes due.',
    };
  }
  if (list === 'submitted') {
    return {
      title: 'Nothing here yet',
      body: 'Applications move here when you mark them submitted.',
    };
  }
  return {
    title: 'Nothing in progress',
    body: 'Shortlist a job and prepare an application to start one.',
  };
}

function StageCard({
  stage,
  count,
  active,
}: {
  stage: (typeof STAGES)[number];
  count: number;
  active: boolean;
}) {
  const Icon = stage.icon;
  const body = (
    <>
      <span className="inline-flex size-8 items-center justify-center rounded-lg bg-surface-3 ring-1 ring-line-2">
        <Icon className={cn('size-4', stage.tone)} />
      </span>
      <span className="min-w-0">
        <span className="block text-2xs text-fg-3">{stage.label}</span>
        <span className="block text-xl font-semibold leading-tight tnum text-fg">{count}</span>
      </span>
    </>
  );
  const base =
    'surface-card flex w-full items-center gap-3 rounded-xl p-3.5 text-left transition-colors';
  if (!stage.href) {
    return <div className={cn(base, count === 0 && 'opacity-70')}>{body}</div>;
  }
  return (
    <Link
      href={stage.href}
      aria-current={active ? 'page' : undefined}
      className={cn(base, active ? 'ring-1 ring-brand/40' : 'hover:bg-surface-2')}
    >
      {body}
    </Link>
  );
}

function Row({ row, clientId }: { row: ApplicationRowView; clientId: string | null }) {
  const p = row.progress;
  return (
    <li>
      <Link
        href={`/applications/${row.applicationId}`}
        className="group flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
      >
        <CompanyTile
          name={row.company}
          domain={row.logo.domain}
          logoSource={row.logo.logoSource}
          markUrl={row.logo.markUrl}
          clientId={clientId}
          size={36}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-base font-medium text-fg">{row.title}</span>
            <span className={cn(STATUS_CHIP, statusChipClass(row.status))}>
              {STATUS_LABEL[row.status] ?? row.status}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-fg-3">
            <span className="text-fg-2">{row.company}</span>
            <span>Updated {row.updatedLabel}</span>
            {row.followUpLabel ? (
              <span className={cn(row.followUpDue && 'font-medium text-maybe')}>
                {row.followUpDue ? 'Follow-up due' : 'Follow up'} {row.followUpLabel}
              </span>
            ) : null}
          </div>
        </div>
        <div className="hidden w-40 shrink-0 sm:block">
          {p ? (
            <>
              <div className="flex items-baseline justify-between text-2xs text-fg-3">
                <span>{p.label}</span>
                <span className="tnum text-fg-2">
                  {p.filled}/{p.total}
                </span>
              </div>
              <div className="mt-1 flex h-1 gap-0.5">
                <div className="rounded-full bg-strong" style={{ flexGrow: p.filled - p.review }} />
                {p.review ? (
                  <div className="rounded-full bg-maybe" style={{ flexGrow: p.review }} />
                ) : null}
                {p.total - p.filled ? (
                  <div
                    className="rounded-full bg-surface-4"
                    style={{ flexGrow: p.total - p.filled }}
                  />
                ) : null}
              </div>
            </>
          ) : (
            <span className="text-2xs text-fg-3">Not filled yet</span>
          )}
        </div>
        <span className="hidden w-12 shrink-0 justify-end md:flex">
          {row.score != null && row.band ? <ScorePill score={row.score} band={row.band} /> : null}
        </span>
        <ChevronRight className="size-4 shrink-0 text-fg-4 transition-transform group-hover:translate-x-0.5 group-hover:text-fg-2" />
      </Link>
    </li>
  );
}
