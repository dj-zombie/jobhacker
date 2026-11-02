import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import type { ReactNode } from 'react';
import './globals.css';
import { AppShell } from '../components/app-shell.js';
import { whereDefault } from '../core/pipeline/areas.js';
import { DbErrorState } from './components/DbErrorState.js';
import {
  getDbHealth,
  getLogoLookup,
  getScoutCard,
  getShellCounts,
  getUiConfig,
} from './lib/queries.js';

export const metadata = {
  title: 'JobHacker',
  description: 'Local-first job-search assistant',
  // The reference has no favicon, and a real one would need literal colors outside the tokens.
  // An empty icon stops the browser asking for /favicon.ico and logging a 404.
  icons: { icon: 'data:,' },
};

export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  const health = getDbHealth();
  const config = getUiConfig();
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        {health.ok ? (
          <AppShell
            counts={getShellCounts(config)}
            scout={getScoutCard(config)}
            user={config.ok ? config.user : null}
            logos={getLogoLookup(config)}
            whereDefault={config.ok ? whereDefault(config.criteria) : []}
          >
            {children}
          </AppShell>
        ) : (
          <AppShell counts={null} scout={null} user={config.ok ? config.user : null}>
            <DbErrorState health={health} />
          </AppShell>
        )}
      </body>
    </html>
  );
}
