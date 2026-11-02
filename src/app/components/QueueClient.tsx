'use client';
import { Kbd, PrescoreMeter, RemoteChip, ScorePill, StateChip } from '@/components/jobhacker';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { triage } from '../lib/actions.js';
import {
  type QueueItem,
  bandOf,
  compLabel,
  locationLabel,
  remoteTypeOf,
  triageStateOf,
} from '../lib/format.js';
import { CompanyTile } from './LogoEditor.js';

type JobStatus = QueueItem['status'];

/**
 * The review queue with keyboard triage (FR-6): `j`/`k` move, `s` shortlist,
 * `x` skip, `a` archive, `o` open the posting, Enter/→ open the detail page.
 * Triage calls the server action (which persists and revalidates) and updates
 * the row optimistically so the status chip changes without a reload.
 */
export function QueueClient({
  rows,
  mode,
  empty,
  logoClientId,
}: {
  rows: QueueItem[];
  mode: 'ranked' | 'unscored';
  empty: React.ReactNode;
  logoClientId: string | null;
}) {
  const [active, setActive] = useState(0);
  const [statuses, setStatuses] = useState<Record<number, JobStatus>>({});
  const [, startTransition] = useTransition();
  const router = useRouter();
  const rowRefs = useRef<Array<HTMLLIElement | null>>([]);

  const statusOf = useCallback(
    (row: QueueItem): JobStatus => statuses[row.jobId] ?? row.status,
    [statuses],
  );

  const doTriage = useCallback((row: QueueItem, action: 'shortlist' | 'skip' | 'archive') => {
    const to: JobStatus =
      action === 'shortlist' ? 'shortlisted' : action === 'skip' ? 'skipped' : 'archived';
    setStatuses((prev) => ({ ...prev, [row.jobId]: to }));
    startTransition(async () => {
      await triage(row.jobId, action);
    });
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      // Ignore typing in form fields (incl. the weight sliders) and activation
      // keys on a focused button, so Enter on "Apply filters" never opens a job.
      if (target && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (rows.length === 0) return;
      const row = rows[active];

      switch (e.key) {
        case 'j':
          e.preventDefault();
          setActive((i) => Math.min(i + 1, rows.length - 1));
          break;
        case 'k':
          e.preventDefault();
          setActive((i) => Math.max(i - 1, 0));
          break;
        case 's':
          if (row) doTriage(row, 'shortlist');
          break;
        case 'x':
          if (row) doTriage(row, 'skip');
          break;
        case 'a':
          if (row) doTriage(row, 'archive');
          break;
        case 'o':
          if (row) window.open(row.url, '_blank', 'noopener');
          break;
        case 'Enter':
        case 'ArrowRight':
          if (row) router.push(`/job/${row.jobId}`);
          break;
        default:
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, rows, doTriage, router]);

  useEffect(() => {
    rowRefs.current[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // Clamp the active index when a filter shrinks the list, so `s`/`x` keep
  // working and the highlight never sits past the end (Known issue [3]).
  useEffect(() => {
    setActive((i) => Math.min(i, Math.max(0, rows.length - 1)));
  }, [rows.length]);

  if (rows.length === 0) return <>{empty}</>;

  return (
    <div>
      <p className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-fg-3">
        <span className="inline-flex items-center gap-1">
          <Kbd>J</Kbd>
          <Kbd>K</Kbd> move
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>S</Kbd> shortlist
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>X</Kbd> skip
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>A</Kbd> archive
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>O</Kbd> open posting
        </span>
        <span className="inline-flex items-center gap-1">
          <Kbd>↵</Kbd> details
        </span>
        {mode === 'ranked' ? (
          <span className="max-md:hidden">
            R T D S L C = role, tech, domain, seniority, logistics, comp (0–5)
          </span>
        ) : null}
      </p>
      <ul className="space-y-0.5" data-testid="queue-rows">
        {rows.map((row, i) => {
          const status = statusOf(row);
          const state = triageStateOf(status);
          const comp = compLabel(row);
          const selected = i === active;
          return (
            // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handled globally above
            <li
              key={row.jobId}
              ref={(el) => {
                rowRefs.current[i] = el;
              }}
              onClick={() => setActive(i)}
              data-job-id={row.jobId}
              className={cn(
                'flex min-h-14 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors',
                selected ? 'bg-surface-2 shadow-hairline ring-1 ring-line-2' : 'hover:bg-surface-1',
              )}
            >
              <span className="flex w-14 shrink-0 justify-start">
                {row.score !== null && row.verdict ? (
                  <span
                    className="inline-flex items-center gap-0.5"
                    title={
                      row.stale
                        ? 'Stale: scored with older preferences, profile or rubric'
                        : undefined
                    }
                  >
                    <ScorePill score={row.score} band={bandOf(row.verdict)} size="sm" />
                    {row.stale ? <span className="text-2xs text-fg-3">*</span> : null}
                  </span>
                ) : row.prescore !== null ? (
                  <PrescoreMeter value={row.prescore} />
                ) : (
                  <span className="text-xs text-fg-4">—</span>
                )}
              </span>
              <CompanyTile
                name={row.company}
                size={28}
                domain={row.domain}
                logoSource={row.logoSource}
                markUrl={row.markUrl}
                clientId={logoClientId}
              />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/job/${row.jobId}`}
                  className="block truncate text-base font-medium text-fg hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {row.title}
                </Link>
                <div className="flex min-w-0 items-center gap-1.5 text-xs text-fg-3">
                  <span className="truncate text-fg-2">{row.company}</span>
                  <span aria-hidden>·</span>
                  <span className="truncate">{locationLabel(row)}</span>
                  {comp !== '—' ? (
                    <>
                      <span aria-hidden>·</span>
                      <span className="shrink-0 tnum">{comp}</span>
                    </>
                  ) : null}
                </div>
              </div>
              {mode === 'ranked' && row.dims ? (
                <span className="hidden shrink-0 font-mono text-2xs text-fg-3 lg:inline">
                  {row.dims}
                </span>
              ) : row.note ? (
                <span className="hidden w-28 shrink-0 truncate text-xs text-fg-3 md:inline">
                  {row.note}
                </span>
              ) : null}
              <RemoteChip remote={remoteTypeOf(row.remoteType)} className="max-sm:hidden" />
              {state ? <StateChip state={state} /> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
