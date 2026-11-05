'use client';

import {
  BAND_SHORT,
  CompanyLogo,
  EmptyState,
  PageHeader,
  Segmented,
  toast,
} from '@/components/jobhacker';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Images } from 'lucide-react';
import * as React from 'react';
import { MobileNavButton } from '../../components/app-shell.js';
import type { LogoCompany } from '../../core/brand/logo-set.js';
import { LOGO_TILE_PX } from '../../core/brand/logo-url.js';
import { companyLogoSrc } from '../../core/brand/site-icon.js';
import { setCompanyLogo } from '../lib/actions.js';
import { useLogoEditor } from './LogoEditor.js';

type Segment = 'needs' | 'confirmed' | 'all';

function inSegment(row: LogoCompany, segment: Segment): boolean {
  if (segment === 'all') return true;
  if (segment === 'confirmed') return row.state === 'confirmed' || row.state === 'none';
  return row.state === 'found' || row.state == null;
}

function provenance(row: LogoCompany): string | null {
  if (row.state === 'none') return 'No logo';
  if (row.state === 'confirmed') return 'Picked by you';
  if (row.state === 'found') return 'Found in a posting';
  return null;
}

const BAND_TEXT = { strong: 'text-strong', maybe: 'text-maybe' } as const;

function tileSrc(row: LogoCompany, clientId: string | null): string | null {
  if (row.state === 'none' || !row.domain) return null;
  return companyLogoSrc({
    domain: row.domain,
    source: row.source,
    markUrl: row.markUrl,
    clientId,
    size: LOGO_TILE_PX,
  });
}

/** The Company logos page. The counter is companies whose tile actually loaded. */
export function CompanyLogos({ rows, clientId }: { rows: LogoCompany[]; clientId: string | null }) {
  const { edits, note, setMissing, openPicker } = useLogoEditor();
  const [segment, setSegment] = React.useState<Segment>('needs');
  const [loaded, setLoaded] = React.useState<Readonly<Record<string, string>>>({});
  const merged = React.useMemo(
    () =>
      rows.map((row) => {
        const edit = edits.get(row.name);
        return edit
          ? {
              ...row,
              domain: edit.domain,
              state: edit.state,
              source: edit.source,
              markUrl: edit.markUrl,
            }
          : row;
      }),
    [rows, edits],
  );
  const missing = merged.filter((row) => row.state !== 'none' && !row.domain).length;
  React.useEffect(() => setMissing(missing), [missing, setMissing]);

  const visible = merged.filter((row) => inSegment(row, segment));
  const counted = visible.filter((row) => row.state !== 'none');
  const showing = counted.filter((row) => loaded[row.name] === tileSrc(row, clientId)).length;

  const mark = (name: string, src: string, status: 'loaded' | 'failed') => {
    setLoaded((prev) => {
      if (status === 'loaded' && prev[name] === src) return prev;
      if (status === 'failed' && prev[name] == null) return prev;
      const next = { ...prev };
      if (status === 'loaded') next[name] = src;
      else delete next[name];
      return next;
    });
  };

  const choose = async (row: LogoCompany, kind: 'confirm' | 'none') => {
    const result = await setCompanyLogo(row.name, { kind });
    if (!result.ok) {
      toast("Couldn't save that logo", { description: result.error });
      return;
    }
    note(row.name, {
      domain: result.logo.domain,
      state: result.logo.state,
      source: result.logo.source,
      markUrl: result.logo.markUrl,
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        icon={Images}
        kicker="Setup"
        title="Company logos"
        art="/art/deck-alien.webp"
        leading={<MobileNavButton />}
        actions={
          <span
            className="text-sm text-fg-2"
            data-logos-showing={showing}
            data-logos-listed={counted.length}
            data-logos-missing={missing}
          >
            Logos showing: <span className="tnum font-medium text-fg">{showing}</span> of{' '}
            <span className="tnum font-medium text-fg">{counted.length}</span>
          </span>
        }
      >
        <Segmented
          aria-label="Logo segments"
          value={segment}
          onChange={setSegment}
          options={[
            {
              value: 'needs',
              label: 'Needs a look',
              count: merged.filter((row) => inSegment(row, 'needs')).length,
            },
            {
              value: 'confirmed',
              label: 'Confirmed',
              count: merged.filter((row) => inSegment(row, 'confirmed')).length,
            },
            { value: 'all', label: 'All', count: merged.length },
          ]}
        />
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-5 py-5 max-md:px-4">
          {visible.length === 0 ? (
            <EmptyState
              icon={Images}
              title="Nothing in this view"
              body="Every company here has been answered."
            />
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface-1 shadow-card">
              {visible.map((row) => {
                const src = tileSrc(row, clientId);
                const source = provenance(row);
                return (
                  <li
                    key={row.companyKey}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
                  >
                    <CompanyLogo
                      name={row.name}
                      src={src}
                      size={40}
                      onStatus={src ? (status) => mark(row.name, src, status) : undefined}
                    />
                    <div className="min-w-0 flex-1 basis-40">
                      <div className="truncate text-base font-medium text-fg">{row.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-fg-3">
                        <span className="text-fg-2">{row.domain ?? 'No domain yet'}</span>
                        {source ? <span>{source}</span> : null}
                      </div>
                    </div>
                    <span className={cn('text-xs font-medium', BAND_TEXT[row.band])}>
                      {BAND_SHORT[row.band]}
                    </span>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={row.state !== 'found' || !row.domain}
                        onClick={() => void choose(row, 'confirm')}
                      >
                        Looks right
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => openPicker(row.name)}
                      >
                        Change
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={row.state === 'none'}
                        onClick={() => void choose(row, 'none')}
                      >
                        No logo
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
