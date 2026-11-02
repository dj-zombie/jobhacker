import { BandDot, EmptyState, PageHeader } from '@/components/jobhacker';
import { buttonVariants } from '@/components/ui/button';
import { formatCount } from '@/lib/format';
import { ListChecks, ListOrdered, type LucideIcon, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { MobileNavButton } from '../../components/app-shell.js';
import { type ListFilters, QUEUE_STATUSES, type QueueStatus } from '../../core/db/repo/scores.js';
import { VERDICTS, type Verdict } from '../../core/db/schema.js';
import type { Funnel } from '../../core/pipeline/funnel.js';
import { decodeWeights } from '../lib/format.js';
import {
  type QueueView,
  brandfetchClientId,
  getFunnel,
  getQueueCompanies,
  getQueueRows,
  getUiConfig,
} from '../lib/queries.js';
import { field } from '../lib/styles.js';
import { QueueClient } from './QueueClient.js';
import { WeightsPanel } from './WeightsPanel.js';

export interface LegacySearchParams {
  /** `review` or `ranked`. */
  view?: string;
  /** The queue's earlier tab parameter. */
  tab?: string;
  verdict?: string;
  company?: string;
  since?: string;
  status?: string;
  /** Slider weights, `w=3,2,2,2,4,1`; absent = the weights saved in criteria.yaml. */
  w?: string;
}

const VIEW_META: Record<
  QueueView,
  { title: string; icon: LucideIcon; empty: string; emptyBody: string }
> = {
  review: {
    title: 'To review',
    icon: ListChecks,
    empty: 'Nothing to review',
    emptyBody: 'Widen the filters above, or run a scout.',
  },
  ranked: {
    title: 'All scored',
    icon: ListOrdered,
    empty: 'No scored jobs match',
    emptyBody: 'Run `pnpm cli score`, or widen the filters above.',
  },
};

/**
 * The J4 queue's To review and All scored views. J6 stopped routing to them: `/?view=review`
 * and `/?view=ranked` redirect to Top matches, whose tune panel is the weights UI.
 */
export function LegacyQueue({ sp, view }: { sp: LegacySearchParams; view: QueueView }) {
  const meta = VIEW_META[view];
  const config = getUiConfig();
  if (!config.ok) {
    return (
      <>
        <PageHeader icon={meta.icon} title={meta.title} leading={<MobileNavButton />} />
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

  const filters = toFilters(sp, view);
  const saved = config.criteria.weights;
  const weights = decodeWeights(sp.w) ?? saved;
  const verdict = toVerdict(sp.verdict);
  const rows = getQueueRows(config, view, { weights, filters, verdict });
  const companies = getQueueCompanies(config);
  const funnel = getFunnel(config);

  const viewHref = (v: QueueView) => {
    const p = new URLSearchParams(
      Object.entries(sp).filter(([k, val]) => typeof val === 'string' && k !== 'tab') as [
        string,
        string,
      ][],
    );
    p.set('view', v);
    return `/?${p.toString()}`;
  };

  return (
    <>
      <PageHeader
        icon={meta.icon}
        title={meta.title}
        count={formatCount(rows.length)}
        leading={<MobileNavButton />}
        actions={(['review', 'ranked'] as const).map((v) => (
          <Link
            key={v}
            href={viewHref(v)}
            aria-current={view === v ? 'page' : undefined}
            className={buttonVariants({
              variant: view === v ? 'secondary' : 'ghost',
              size: 'sm',
            })}
          >
            {VIEW_META[v].title}
          </Link>
        ))}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 max-md:px-3">
        {funnel ? <FunnelLine f={funnel} /> : null}

        {view === 'ranked' ? <WeightsPanel saved={saved} current={weights} /> : null}

        <form method="get" className="mb-4 flex flex-wrap items-end gap-3 text-sm">
          <input type="hidden" name="view" value={view} />
          {sp.w ? <input type="hidden" name="w" value={sp.w} /> : null}
          {view === 'ranked' ? (
            <Field label="Verdict">
              <select name="verdict" defaultValue={sp.verdict ?? ''} className={field}>
                <option value="">any</option>
                {VERDICTS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label="Company">
            <select name="company" defaultValue={sp.company ?? ''} className={field}>
              <option value="">any</option>
              {companies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Posted within">
            <select
              name="since"
              defaultValue={sp.since ?? (view === 'review' ? '45' : '')}
              className={field}
            >
              <option value="">any time</option>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="45">45 days</option>
              <option value="90">90 days</option>
            </select>
          </Field>
          <Field label="Status">
            <select name="status" defaultValue={sp.status ?? ''} className={field}>
              <option value="">all</option>
              {QUEUE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            Apply filters
          </button>
        </form>

        {view === 'review' ? (
          <p className="mb-3 px-1 text-xs text-fg-3">
            {filters.sinceDays
              ? `Posted in the last ${filters.sinceDays} days. `
              : 'Any posting age. '}
            No model score yet. Greenhouse, Lever and Ashby first, then remote, then prescore.
            Showing {rows.length}.
          </p>
        ) : null}
        <QueueClient
          rows={rows}
          mode={view === 'ranked' ? 'ranked' : 'unscored'}
          empty={<EmptyState icon={meta.icon} title={meta.empty} body={meta.emptyBody} />}
          logoClientId={brandfetchClientId()}
        />
      </div>
    </>
  );
}

/** The old header's funnel, kept at the top of the earlier queue views. */
function FunnelLine({ f }: { f: Funnel }) {
  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-fg-3"
      data-testid="funnel"
    >
      <Count label="jobs" value={f.total} />
      <Count
        label="gated"
        value={f.gatedTotal}
        title={`closed ${f.gated.closed} · duplicate ${f.gated.duplicate} · blocklisted ${f.gated.blocklist} · too old ${f.gated.age}`}
      />
      <Count
        label="not yet gated"
        value={f.notYetGated}
        title="must be 0 after gate reconciliation"
      />
      <Count label="passed" value={f.passed} />
      <Count
        label="scored"
        value={f.scored.total}
        title={`${f.scored.current} current, ${f.scored.stale} stale`}
      />
      <span className="inline-flex items-center gap-1.5">
        <BandDot band="strong" />
        <span className="tnum text-fg">{formatCount(f.scored.bands.strong)}</span> strong
      </span>
      <span className="inline-flex items-center gap-1.5">
        <BandDot band="maybe" />
        <span className="tnum text-fg">{formatCount(f.scored.bands.maybe)}</span> maybe
      </span>
      <span className="inline-flex items-center gap-1.5">
        <BandDot band="no" />
        <span className="tnum text-fg">{formatCount(f.scored.bands.no)}</span> weak
      </span>
      <Count
        label="unscored"
        value={f.unscored.total}
        title={`${f.unscored.byState.pending} pending · ${f.unscored.byState.run_cap} run cap · ${f.unscored.byState.llm_error} error`}
      />
    </div>
  );
}

function Count({ label, value, title }: { label: string; value: number; title?: string }) {
  return (
    <span title={title}>
      <span className="tnum text-fg">{formatCount(value)}</span> {label}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed in as `children`
    <label className="flex flex-col gap-1">
      <span className="text-xs text-fg-3">{label}</span>
      {children}
    </label>
  );
}

function toVerdict(raw: string | undefined): Verdict | undefined {
  return raw && (VERDICTS as readonly string[]).includes(raw) ? (raw as Verdict) : undefined;
}

function toFilters(sp: LegacySearchParams, view: QueueView): ListFilters {
  const filters: ListFilters = {};
  if (sp.company) filters.company = sp.company;
  if (sp.since) {
    const n = Number(sp.since);
    if (Number.isFinite(n) && n > 0) filters.sinceDays = n;
  } else if (view === 'review' && sp.since === undefined) {
    filters.sinceDays = 45;
  }
  if (sp.status && (QUEUE_STATUSES as readonly string[]).includes(sp.status)) {
    filters.statuses = [sp.status as QueueStatus];
  }
  return filters;
}
