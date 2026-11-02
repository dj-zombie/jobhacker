'use client';

import { CompanyLogo } from '@/components/jobhacker';
import { Button } from '@/components/ui/button';
import * as React from 'react';

const SRC =
  'https://cdn.brandfetch.io/domain/linear.example/w/128/h/128/fallback/404/type/icon?c=stand-in';

/**
 * Proves a tile reports `loaded` once when the same image is already in the page.
 * Nothing links here. The J10 browser check mounts the tile after the preload.
 */
export default function LogoReportPage() {
  const [mounted, setMounted] = React.useState(false);
  const [reports, setReports] = React.useState(0);
  return (
    <main className="p-6">
      <img src={SRC} alt="" width={40} height={40} data-preload="1" />
      <Button type="button" className="mt-4" onClick={() => setMounted(true)}>
        Mount tile
      </Button>
      <p className="mt-3 text-sm text-fg" data-reports={reports}>
        {reports}
      </p>
      {mounted ? (
        <CompanyLogo name="Linear" src={SRC} size={40} onStatus={() => setReports((n) => n + 1)} />
      ) : null}
    </main>
  );
}
