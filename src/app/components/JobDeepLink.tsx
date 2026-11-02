'use client';

import {
  JobDetail,
  PageHeader,
  type TriageAction,
  parseDescription,
  toast,
  toastUndo,
  useHotkeys,
} from '@/components/jobhacker';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ArrowLeft, Briefcase, FileText, History, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { MobileNavButton, useTriageStore } from '../../components/app-shell.js';
import { LOGO_TILE_PX } from '../../core/brand/logo-url.js';
import { companyLogoSrc } from '../../core/brand/site-icon.js';
import type { ScoreRunState } from '../../core/pipeline/score-run.js';
import {
  type TriageWriteResult,
  prepJob,
  startScoreJob,
  triageJobAction,
  undoTriageAction,
} from '../lib/actions.js';
import type { EventEntry } from '../lib/activity.js';
import {
  type PlaceInfo,
  type Ranking,
  type TriageDetailData,
  headerLogosFor,
  toDetailData,
} from '../lib/triage.js';
import { useLogoEditor } from './LogoEditor.js';

const ACTION_PAST = { shortlist: 'Shortlisted', skip: 'Skipped', archive: 'Archived' } as const;

/**
 * `/job/[id]` (J5): a deep link to one job, rendering the triage views' `JobDetail` at full width.
 * Actions write straight away and re-read the page; the job's history sits behind a header menu.
 */
export function JobDeepLink({
  detail,
  places,
  ranking,
  nowMs,
  events,
  logoClientId,
}: {
  detail: TriageDetailData;
  places: PlaceInfo[];
  ranking: Ranking;
  nowMs: number;
  events: EventEntry[];
  logoClientId: string | null;
}) {
  const router = useRouter();
  const store = useTriageStore();
  const logoEdits = useLogoEditor();
  const logoEdit = logoEdits.edits.get(detail.row.company);
  const [busy, setBusy] = React.useState(false);
  const jobId = detail.row.id;
  const label = `${detail.row.title} · ${detail.row.company}`;
  const placeMap = React.useMemo(() => new Map(places.map((p) => [p.id, p] as const)), [places]);
  const job = React.useMemo(() => {
    const base = {
      ...toDetailData(detail, ranking, placeMap, nowMs, logoClientId),
      description: parseDescription(detail.description),
    };
    if (!logoEdit) return base;
    return {
      ...base,
      logoUrl: companyLogoSrc({
        domain: logoEdit.domain,
        source: logoEdit.source,
        markUrl: logoEdit.markUrl,
        clientId: logoClientId,
        size: LOGO_TILE_PX,
      }),
      ...headerLogosFor(
        { domain: logoEdit.domain, logoSource: logoEdit.source, markUrl: logoEdit.markUrl },
        logoClientId,
      ),
    };
  }, [detail, ranking, placeMap, nowMs, logoClientId, logoEdit]);

  const settle = (res: TriageWriteResult, done: string, onUndo?: () => void) => {
    if (!res.ok) {
      toast("Couldn't save that", {
        description: res.error,
        icon: <TriangleAlert className="text-danger" />,
      });
      return;
    }
    store.setStatus(jobId, res.to);
    store.markWrite();
    router.refresh();
    if (onUndo) toastUndo(done, onUndo, { description: label });
    else toast(done, { description: label });
  };

  const undo = () => {
    void undoTriageAction(jobId).then((res) => settle(res, 'Restored'));
  };

  const act = (action: TriageAction) => {
    if (action === 'open') {
      window.open(`/job/${jobId}/posting`, '_blank', 'noopener,noreferrer');
      return;
    }
    void triageJobAction(jobId, action).then((res) => settle(res, ACTION_PAST[action], undo));
  };

  const prepare = async () => {
    if (busy) return;
    setBusy(true);
    const id = toast.loading('Preparing application', {
      description: `${detail.row.title} at ${detail.row.company}. Tailoring the resume, cover note and answers.`,
    });
    const res = await prepJob(jobId);
    setBusy(false);
    if (res.ok) {
      toast('Prepared application', { id, description: label, icon: <FileText /> });
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
  };

  const score = async () => {
    if (busy) return;
    setBusy(true);
    const id = toast.loading('Scoring this job', { description: label });
    const started = await startScoreJob(jobId);
    if (!started.ok) {
      setBusy(false);
      toast("Couldn't start scoring", { id, description: started.error });
      return;
    }
    let run: ScoreRunState | null = null;
    while (!run || run.running) {
      await new Promise((r) => window.setTimeout(r, 1000));
      const res = await fetch(`/api/score-run/${started.runId}`, { cache: 'no-store' }).catch(
        () => null,
      );
      if (res?.ok) run = (await res.json()) as ScoreRunState;
    }
    setBusy(false);
    toast(run.progress.done > 0 ? 'Scored' : "Couldn't score this job", {
      id,
      description: run.error ?? label,
    });
    router.refresh();
  };

  useHotkeys({
    s: () => act('shortlist'),
    x: () => act('skip'),
    a: () => act('archive'),
    o: () => act('open'),
  });

  const application = detail.application;
  const primary = application
    ? {
        label: 'Open application',
        icon: <FileText />,
        onClick: () => router.push(`/applications/${application.id}`),
      }
    : detail.row.status === 'shortlisted'
      ? {
          label: busy ? 'Preparing…' : 'Prepare application',
          icon: <FileText />,
          onClick: () => void prepare(),
        }
      : undefined;

  return (
    <>
      <PageHeader
        icon={Briefcase}
        title="Job"
        leading={
          <>
            <MobileNavButton />
            <Link
              href="/"
              aria-label="Back to Top matches"
              className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
            >
              <ArrowLeft aria-hidden />
            </Link>
          </>
        }
        actions={
          events.length ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <History />
                  History
                  <span className="tnum text-fg-3">{events.length}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 w-80 overflow-y-auto">
                <DropdownMenuLabel>History</DropdownMenuLabel>
                <ol className="px-2 pb-1.5 text-xs">
                  {events.map((e) => (
                    <li key={e.id} className="py-1">
                      <span className="tnum text-fg-3">{when(e.at)}</span>{' '}
                      <span className="text-fg-2">{e.label}</span>
                      {e.detail ? <span className="text-fg-3"> · {e.detail}</span> : null}
                    </li>
                  ))}
                </ol>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null
        }
      />
      <div className="min-h-0 flex-1">
        <JobDetail
          job={job}
          onAction={act}
          onEditLogo={() => logoEdits.openPicker(detail.row.company)}
          onScore={job.score == null ? () => void score() : undefined}
          primary={primary}
        />
      </div>
    </>
  );
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}
