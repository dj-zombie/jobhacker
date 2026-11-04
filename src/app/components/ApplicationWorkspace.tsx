'use client';

import {
  CompanyHeader,
  FillReadiness,
  FillReport,
  RemoteChip,
  ScorePill,
  toast,
} from '@/components/jobhacker';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  Copy,
  Flag,
  LoaderCircle,
  Send,
  TriangleAlert,
  Wand2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import { MobileNavButton, useAdjustCounts } from '../../components/app-shell.js';
import type { FillRow } from '../../core/apply/fill-view.js';
import { LOGO_TILE_PX } from '../../core/brand/logo-url.js';
import { companyLogoSrc } from '../../core/brand/site-icon.js';
import {
  approveDraftAction,
  markSubmittedAction,
  openAndFill,
  setApplicationStatusAction,
} from '../lib/actions.js';
import { STATUS_CHIP, STATUS_LABEL, STATUS_ORDER, statusChipClass } from '../lib/status.js';
import { headerLogosFor } from '../lib/triage.js';
import type { WorkspaceData } from '../lib/workspace-types.js';
import { useLogoEditor } from './LogoEditor.js';
import {
  ActivityPanel,
  AnswersEditor,
  CopyPastePanel,
  CoverEditor,
  ResumePanel,
} from './WorkspacePanels.js';

const TABS = ['apply', 'resume', 'cover', 'answers', 'activity'] as const;
const KEEP_MOUNTED = 'pt-5 data-[state=inactive]:hidden';
type Tab = (typeof TABS)[number];

function isTab(value: string): value is Tab {
  return (TABS as readonly string[]).includes(value);
}

function shortDate(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? iso
    : at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function failed(title: string, error?: string) {
  toast(title, { description: error, icon: <TriangleAlert className="text-danger" /> });
}

/** Why the copy-paste answers are open, or what they're for when they aren't. */
function fallbackReason(data: WorkspaceData): string {
  if (!data.fill.hasAdapter) {
    return "There's no form filler built for this site, so Open & fill maps what it can from your profile. Copy the rest from here.";
  }
  if (data.filled && data.fill.rows.length === 0) {
    return 'Open & fill found no fields on that page. Copy these into the form.';
  }
  if (data.fill.fallbackOpen) return 'Most fields came back blank. Copy these into the form.';
  return "For a field the fill didn't reach.";
}

/**
 * `/applications/[id]` (J7): one application, leading with what Open & fill wrote into the
 * form. Kris reviews it here and submits in Chrome himself; nothing here can submit.
 */
export function ApplicationWorkspace({
  data,
  logoClientId,
}: {
  data: WorkspaceData;
  logoClientId: string | null;
}) {
  const router = useRouter();
  const logoEditor = useLogoEditor();
  const adjustCounts = useAdjustCounts();
  const [tab, setTab] = React.useState<Tab>('apply');
  const [filling, setFilling] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [chromeDown, setChromeDown] = React.useState<string | null>(null);
  const [approving, setApproving] = React.useState<ReadonlySet<string>>(new Set());
  const [answerFocus, setAnswerFocus] = React.useState<{ key: string; signal: number } | null>(
    null,
  );
  const [coverFocus, setCoverFocus] = React.useState(0);
  // A write shows at once; the refresh that follows can take a second or two.
  const [shown, setShown] = React.useState({ status: data.status, submitted: false });
  const [lastStatus, setLastStatus] = React.useState(data.status);
  if (data.status !== lastStatus) {
    setLastStatus(data.status);
    setShown((s) => ({ ...s, status: data.status }));
  }
  const { jobId, applicationId, company } = data;
  const status = shown.status;
  const submitted = (data.submittedAt !== null || shown.submitted) && status !== 'prepped';

  const edit = logoEditor.edits.get(company);
  const logo = edit
    ? { domain: edit.domain, logoSource: edit.source, markUrl: edit.markUrl }
    : data.logo;
  const headerLogos = headerLogosFor(logo, logoClientId);
  const artUrl = companyLogoSrc({
    domain: logo.domain,
    source: logo.logoSource,
    markUrl: logo.markUrl,
    clientId: logoClientId,
    size: LOGO_TILE_PX,
  });

  // An answer approved here moves to Filled before the server confirms it.
  const rows: FillRow[] = data.fill.rows.map((row) =>
    row.state === 'review' && row.approvalKey && approving.has(row.approvalKey)
      ? { ...row, state: 'filled' }
      : row,
  );
  const count = (state: FillRow['state']) => rows.filter((r) => r.state === state).length;
  const review = count('review');
  const reviewKeys = new Set(
    rows.flatMap((r) => (r.state === 'review' && r.answerKey ? [r.answerKey] : [])),
  );
  const rowById = (id: string) => rows.find((r) => r.id === id);

  const goToAnswer = (key: string) => {
    setTab('answers');
    setAnswerFocus((prev) => ({ key, signal: (prev?.signal ?? 0) + 1 }));
  };

  const approve = async (id: string) => {
    const key = rowById(id)?.approvalKey;
    if (!key) return;
    setApproving((prev) => new Set(prev).add(key));
    const res = await approveDraftAction(applicationId, key);
    if (res.ok) {
      router.refresh();
      return;
    }
    setApproving((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    failed("Couldn't save that approval", res.error);
  };

  const editAnswer = (id: string) => {
    const row = rowById(id);
    if (row?.answerKey) goToAnswer(row.answerKey);
    else
      toast('This draft is your profile summary', {
        description: 'Change it on the form in Chrome, or in profile.yaml.',
      });
  };

  const addAnswer = (id: string) => {
    const row = rowById(id);
    if (!row) return;
    if (row.fix === 'answer' && row.answerKey) return goToAnswer(row.answerKey);
    if (row.fix === 'cover') {
      setTab('cover');
      setCoverFocus((n) => n + 1);
      return;
    }
    if (row.fix === 'profile') {
      toast('Add it to profile.yaml', {
        description: `${row.label} comes from your profile, so an answer here won't fill it.`,
      });
      return;
    }
    toast('Fill this one on the form in Chrome', { description: row.note ?? row.label });
  };

  const fill = async () => {
    setFilling(true);
    setChromeDown(null);
    const res = await openAndFill(jobId);
    setFilling(false);
    if (res.ok) {
      const filled =
        (res.report?.filled.length ?? 0) + (res.report?.self_identification.length ?? 0);
      const drafted = res.report?.filled.filter((f) => f.via === 'draft').length ?? 0;
      toast(
        res.fallback ? 'Opened the application in Chrome' : 'Filled the application in Chrome',
        {
          description: res.fallback
            ? 'No fields found to fill. Nothing was submitted.'
            : `${filled} fields filled${drafted ? `, ${drafted} drafted for review` : ''}. Nothing was submitted.`,
          icon: <Wand2 className="text-info" />,
        },
      );
      setTab('apply');
      router.refresh();
    } else if (res.needsChrome) {
      setChromeDown(res.launchCommand ?? '');
      setTab('apply');
      toast("Chrome isn't running", { description: 'Start it, then press Open & fill again.' });
    } else {
      failed("Couldn't fill the application", res.error);
    }
  };

  const markSubmitted = async () => {
    setSubmitting(true);
    const res = await markSubmittedAction(jobId);
    setSubmitting(false);
    if (!res.ok) return failed("Couldn't mark it submitted", res.error);
    if (!res.already && status === 'prepped') {
      adjustCounts({ inProgress: -1, submitted: 1 });
    }
    setShown((s) => ({ status: s.status === 'prepped' ? 'submitted' : s.status, submitted: true }));
    toast(res.already ? 'Already marked submitted' : 'Marked submitted', {
      description: res.followUpAt
        ? `Follow-up reminder set for ${shortDate(res.followUpAt)}.`
        : undefined,
      icon: <Send className="text-strong" />,
    });
    router.refresh();
  };

  const moveTo = async (next: string) => {
    if (next === status) return;
    const res = await setApplicationStatusAction(jobId, next);
    if (!res.ok) return failed("Couldn't change the status", res.error);
    if (status !== next) {
      const wasPrep = status === 'prepped';
      const nowPrep = next === 'prepped';
      adjustCounts({
        inProgress: (nowPrep ? 1 : 0) - (wasPrep ? 1 : 0),
        submitted: (nowPrep ? 0 : 1) - (wasPrep ? 0 : 1),
      });
    }
    setShown((s) => ({ ...s, status: next }));
    toast(`Moved to ${STATUS_LABEL[next] ?? next}`);
    router.refresh();
  };

  const statusChip = (
    <span className={cn(STATUS_CHIP, statusChipClass(status))}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <MobileNavButton />
        <Link href={data.backHref} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          <ChevronLeft />
          Applications
        </Link>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="Change status">
                <Flag />
                <span className="max-sm:hidden">Status</span>
                <ChevronDown className="text-fg-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Move to</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={status} onValueChange={(v) => void moveTo(v)}>
                {STATUS_ORDER.map((status) => (
                  <DropdownMenuRadioItem key={status} value={status}>
                    {STATUS_LABEL[status]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <a
            href={`/job/${jobId}/posting`}
            target="_blank"
            rel="noreferrer"
            aria-label="Open posting"
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            <ArrowUpRight />
            <span className="max-sm:hidden">Open posting</span>
          </a>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void fill()}
            disabled={filling || submitted}
          >
            {filling ? <LoaderCircle className="animate-spin" /> : <Wand2 />}
            {filling ? 'Filling in Chrome' : 'Open & fill'}
          </Button>
          <Button
            size="sm"
            onClick={() => void markSubmitted()}
            disabled={submitted || submitting || filling}
          >
            {submitted ? <Check /> : <Send />}
            {submitted ? 'Submitted' : 'Mark submitted'}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <CompanyHeader
          company={company}
          title={data.title}
          titleAs="h1"
          artUrl={artUrl}
          coverUrl={headerLogos.logoTileUrl}
          markOnDark={headerLogos.logoSymbolOnDarkUrl}
          markOnLight={headerLogos.logoSymbolOnLightUrl}
          wordmarkOnDark={headerLogos.logoWordmarkOnDarkUrl}
          wordmarkOnLight={headerLogos.logoWordmarkOnLightUrl}
          onEditLogo={() => logoEditor.openPicker(company)}
          contentClassName="mx-auto max-w-4xl"
          facts={[
            { label: 'Location', value: <span className="truncate">{data.location}</span> },
            { label: 'Work', value: <RemoteChip remote={data.remote} /> },
            { label: 'Status', value: statusChip },
            ...(data.score != null && data.band
              ? [{ label: 'Score', value: <ScorePill score={data.score} band={data.band} /> }]
              : []),
          ]}
        >
          <div className="mx-auto max-w-4xl px-6 py-6 max-md:px-4">
            {chromeDown !== null ? <ChromeDownNotice message={chromeDown} /> : null}
            {data.filled ? (
              <FillReadiness
                filled={count('filled')}
                review={review}
                blank={count('blank')}
                requiredBlank={data.fill.requiredBlank}
                resumeAttached={data.fill.resumeAttached}
                phase={status === 'prepped' ? undefined : (STATUS_LABEL[status] ?? status)}
              />
            ) : (
              <NotFilledYet />
            )}

            <Tabs value={tab} onValueChange={(v) => isTab(v) && setTab(v)} className="mt-6">
              <TabsList value={tab} className="max-md:flex-wrap">
                <TabsTrigger value="apply">
                  Apply
                  {review ? (
                    <span className="rounded-full bg-maybe-wash px-1.5 text-2xs font-semibold tnum text-maybe">
                      {review}
                    </span>
                  ) : null}
                </TabsTrigger>
                <TabsTrigger value="resume">Resume</TabsTrigger>
                <TabsTrigger value="cover">Cover note</TabsTrigger>
                <TabsTrigger value="answers">Answers</TabsTrigger>
                <TabsTrigger value="activity">Activity</TabsTrigger>
              </TabsList>

              <TabsContent value="apply" className="pt-5">
                {data.filled ? (
                  <FillReport
                    fields={rows}
                    onApprove={(id) => void approve(id)}
                    onEdit={editAnswer}
                    onAddAnswer={addAnswer}
                    onCopy={() => toast('Copied', { description: 'Paste it into the form.' })}
                    selfIdNote={data.fill.selfIdNote}
                  />
                ) : null}
                <CopyPastePanel
                  rows={data.copyRows}
                  open={data.fill.fallbackOpen}
                  reason={fallbackReason(data)}
                />
              </TabsContent>

              <TabsContent value="resume" className="pt-5">
                <ResumePanel
                  jobId={jobId}
                  pdfUrl={data.resume.pdfUrl}
                  html={data.resume.html}
                  fileName={data.resume.fileName}
                  provided={data.resume.provided}
                />
              </TabsContent>

              {/* The editing tabs stay mounted, so a tab switch never drops unsaved edits. */}
              <TabsContent value="cover" forceMount className={KEEP_MOUNTED}>
                <CoverEditor jobId={jobId} saved={data.coverNote} focusSignal={coverFocus} />
              </TabsContent>

              <TabsContent value="answers" forceMount className={KEEP_MOUNTED}>
                <AnswersEditor
                  jobId={jobId}
                  answers={data.answers}
                  reviewKeys={reviewKeys}
                  focus={answerFocus}
                />
              </TabsContent>

              <TabsContent value="activity" forceMount className={KEEP_MOUNTED}>
                <ActivityPanel
                  jobId={jobId}
                  followUpDate={data.followUpDate}
                  notes={data.notes}
                  groups={data.activity}
                />
              </TabsContent>
            </Tabs>
          </div>
        </CompanyHeader>
      </div>
    </div>
  );
}

function NotFilledYet() {
  return (
    <div className="surface-card rounded-xl p-5 max-md:p-4">
      <div className="text-lg font-semibold tracking-tight text-fg">Not filled yet</div>
      <p className="mt-0.5 text-sm text-fg-2">
        Open &amp; fill opens the form in your Chrome and fills it from your profile and answers.
        Nothing is submitted: you look it over and click submit yourself.
      </p>
    </div>
  );
}

function ChromeDownNotice({ message }: { message: string }) {
  const command = 'pnpm cli chrome';
  return (
    <div className="mb-4 rounded-xl border border-maybe/30 bg-maybe-wash p-4 text-sm animate-rise-in">
      <div className="font-medium text-maybe">Chrome isn't running with remote debugging</div>
      <p className="mt-1 text-fg-2">
        Start it from the project folder, then press Open &amp; fill again.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-surface-1 px-3 py-2 font-mono text-xs text-fg">
          {command}
        </code>
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(command);
            } catch {
              // The clipboard can be refused; the toast still says what was meant.
            }
            toast('Copied', { description: 'Paste it into Terminal.' });
          }}
        >
          <Copy />
          Copy command
        </Button>
      </div>
      {message ? (
        <details className="mt-3 text-xs text-fg-3">
          <summary className="cursor-pointer select-none">The full message</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words font-mono">{message}</pre>
        </details>
      ) : null}
    </div>
  );
}
