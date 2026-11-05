import { REPO_URL } from './links';

type Page = 'demo' | 'about' | 'form' | 'missing';

const LINK =
  'rounded-sm text-fg-2 underline-offset-2 transition-colors hover:text-fg hover:underline';

/** One line above every page: this is a demo, on fictional data, and where to read more. */
export function DemoBanner({ page }: { page: Page }) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-3 border-b border-line bg-surface-1 px-3 text-xs text-fg-3">
      <span className="hud-label shrink-0 rounded-sm bg-brand-wash px-1.5 text-brand-hi">Demo</span>
      <span className="min-w-0 truncate">
        <span className="max-sm:hidden">
          A fictional candidate and sample jobs. Nothing you do here is saved or sent.
        </span>
        <span className="sm:hidden">
          {page === 'demo' ? 'Sample data. Nothing is saved.' : 'Sample data'}
        </span>
      </span>
      <nav aria-label="Site" className="ml-auto flex shrink-0 items-center gap-3">
        {page !== 'demo' ? (
          <a className={LINK} href="/">
            Try the demo
          </a>
        ) : null}
        {page !== 'about' ? (
          <a className={LINK} href="/about/">
            About
          </a>
        ) : null}
        <a className={LINK} href={REPO_URL}>
          GitHub
        </a>
      </nav>
    </div>
  );
}
