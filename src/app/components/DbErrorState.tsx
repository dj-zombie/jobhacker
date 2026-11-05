import { EmptyState, PageHeader } from '@/components/jobhacker';
import { DatabaseZap } from 'lucide-react';
import { MobileNavButton } from '../../components/app-shell.js';
import type { DbHealth } from '../lib/queries.js';

/** Shown on every page when the database is missing or can't be opened. Never a stack trace. */
export function DbErrorState({ health }: { health: Extract<DbHealth, { ok: false }> }) {
  return (
    <>
      <PageHeader icon={DatabaseZap} title="No database" leading={<MobileNavButton />} />
      <EmptyState
        still
        icon={DatabaseZap}
        title="JobHacker can't open its database"
        body={
          <>
            {health.problem} It looked for{' '}
            <code className="font-mono text-fg-2 break-all">{health.path}</code>
            {health.absolutePath !== health.path ? (
              <>
                , which is{' '}
                <code className="font-mono text-fg-2 break-all">{health.absolutePath}</code>
              </>
            ) : null}
            . Run this in the repo, then reload:
          </>
        }
        action={
          <div className="space-y-2">
            <pre className="rounded-md border border-line-2 bg-surface-2 px-3 py-2 font-mono text-sm text-fg">
              {health.command}
            </pre>
            <p className="max-w-sm text-xs text-fg-3">
              If you moved the database, set <code className="font-mono">DATABASE_PATH</code> in{' '}
              <code className="font-mono">.env</code> to where it is now.
            </p>
          </div>
        }
      />
    </>
  );
}
