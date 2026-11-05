'use client';

import { CompanyLogo, toast } from '@/components/jobhacker';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ImageOff } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';
import { LOGO_TILE_PX, brandSearchUrl } from '../../core/brand/logo-url.js';
import {
  companyLogoSrc,
  pageOrigins,
  registrableHost,
  siteIconFromHtml,
} from '../../core/brand/site-icon.js';
import { setCompanyLogo } from '../lib/actions.js';

/** A logo Kris just set, keyed by the company name the rows already show. */
export interface LogoEdit {
  domain: string | null;
  state: 'confirmed' | 'none';
  source: string;
  markUrl: string | null;
}

interface LogoEditorValue {
  edits: ReadonlyMap<string, LogoEdit>;
  missing: number | null;
  setMissing: (count: number) => void;
  note: (name: string, edit: LogoEdit) => void;
  openPicker: (name: string) => void;
}

const EMPTY = new Map<string, LogoEdit>();

const LogoEditorContext = React.createContext<LogoEditorValue>({
  edits: EMPTY,
  missing: null,
  setMissing: () => {},
  note: () => {},
  openPicker: () => {},
});

export function useLogoEditor(): LogoEditorValue {
  return React.useContext(LogoEditorContext);
}

/** A company tile that follows a picker change without a reload. */
export function CompanyTile({
  name,
  domain,
  logoSource = null,
  markUrl = null,
  clientId,
  size,
}: {
  name: string;
  domain: string | null;
  logoSource?: string | null;
  markUrl?: string | null;
  clientId: string | null;
  size: number;
}) {
  const edit = useLogoEditor().edits.get(name);
  const resolved = edit
    ? { domain: edit.domain, source: edit.source, markUrl: edit.markUrl }
    : { domain, source: logoSource, markUrl };
  return (
    <CompanyLogo
      name={name}
      size={size}
      src={companyLogoSrc({ ...resolved, clientId, size: LOGO_TILE_PX })}
    />
  );
}

const hitSchema = z
  .object({
    name: z.string().nullable().optional(),
    domain: z.string(),
    brandId: z.string().nullable().optional(),
    icon: z.string().nullable().optional(),
  })
  .strip();

interface SearchHit {
  name: string;
  domain: string;
  brandId: string | null;
  icon: string | null;
}

function parseHits(body: unknown): SearchHit[] {
  if (!Array.isArray(body)) return [];
  const hits: SearchHit[] = [];
  for (const item of body.slice(0, 5)) {
    const parsed = hitSchema.safeParse(item);
    if (!parsed.success) continue;
    const icon = parsed.data.icon?.startsWith('https://') ? parsed.data.icon : null;
    hits.push({
      name: parsed.data.name?.trim() || parsed.data.domain,
      domain: parsed.data.domain,
      brandId: parsed.data.brandId ?? null,
      icon,
    });
  }
  return hits;
}

const MISSING_ID = 'Brandfetch client ID is missing. Add BRANDFETCH_CLIENT_ID to .env.';
const SEARCH_FAILED =
  "Brand Search didn't answer. Type a domain, or mark this company as having no logo.";

/**
 * Brand Search from the browser, and the one dialog every logo tile opens.
 * Kit components don't fetch, so the request stays here.
 */
export function LogoEditor({
  clientId,
  children,
}: {
  clientId: string | null;
  children: React.ReactNode;
}) {
  const [edits, setEdits] = React.useState<ReadonlyMap<string, LogoEdit>>(EMPTY);
  const [missing, setMissing] = React.useState<number | null>(null);
  const [picker, setPicker] = React.useState<string | null>(null);
  const note = React.useCallback((name: string, edit: LogoEdit) => {
    setEdits((prev) => {
      const next = new Map(prev);
      next.set(name, edit);
      return next;
    });
  }, []);
  const value = React.useMemo<LogoEditorValue>(
    () => ({
      edits,
      missing,
      setMissing,
      note,
      openPicker: setPicker,
    }),
    [edits, missing, note],
  );

  return (
    <LogoEditorContext.Provider value={value}>
      {children}
      <LogoPicker
        company={picker}
        clientId={clientId}
        onClose={() => setPicker(null)}
        onSaved={note}
      />
    </LogoEditorContext.Provider>
  );
}

function LogoPicker({
  company,
  clientId,
  onClose,
  onSaved,
}: {
  company: string | null;
  clientId: string | null;
  onClose: () => void;
  onSaved: (name: string, edit: LogoEdit) => void;
}) {
  const [query, setQuery] = React.useState(company ?? '');
  const [hits, setHits] = React.useState<SearchHit[]>([]);
  const [searchError, setSearchError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [typed, setTyped] = React.useState('');
  const [typing, setTyping] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [preview, setPreview] = React.useState<{
    input: string;
    icon: string | null;
    state: 'loading' | 'ready' | 'missing';
  } | null>(null);
  const previewRef = React.useRef(preview);
  previewRef.current = preview;

  React.useEffect(() => {
    if (!company) return;
    setQuery(company);
    setTyped('');
    setTyping(false);
    setPreview(null);
    setFormError(null);
    setHits([]);
  }, [company]);

  React.useEffect(() => {
    if (!company) return;
    const ctrl = new AbortController();
    const immediate = query === company;
    const handle = window.setTimeout(
      () => {
        void (async () => {
          if (!clientId) {
            setHits([]);
            setSearchError(MISSING_ID);
            return;
          }
          const url = brandSearchUrl(query, clientId);
          if (!url) {
            setHits([]);
            setSearchError(null);
            return;
          }
          try {
            const response = await fetch(url, {
              signal: ctrl.signal,
              credentials: 'omit',
              referrerPolicy: 'strict-origin-when-cross-origin',
            });
            if (!response.ok) {
              setHits([]);
              setSearchError(SEARCH_FAILED);
              return;
            }
            const body: unknown = await response.json();
            if (ctrl.signal.aborted) return;
            setHits(parseHits(body));
            setSearchError(null);
          } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            if (!ctrl.signal.aborted) {
              setHits([]);
              setSearchError(SEARCH_FAILED);
            }
          }
        })();
      },
      immediate ? 0 : 200,
    );
    return () => {
      ctrl.abort();
      window.clearTimeout(handle);
    };
  }, [company, query, clientId]);

  React.useEffect(() => {
    if (!typing) return;
    const input = typed;
    if (!registrableHost(input)) {
      setPreview(null);
      return;
    }
    const ctrl = new AbortController();
    const handle = window.setTimeout(() => {
      setPreview({ input, icon: null, state: 'loading' });
      void resolveTypedIcon(input, ctrl.signal).then((icon) => {
        if (ctrl.signal.aborted) return;
        setPreview({ input, icon, state: icon ? 'ready' : 'missing' });
      });
    }, 200);
    return () => {
      ctrl.abort();
      window.clearTimeout(handle);
    };
  }, [typed, typing]);

  const save = async (choice: Parameters<typeof setCompanyLogo>[1]) => {
    if (!company || busy) return;
    setBusy(true);
    setFormError(null);
    try {
      const result = await setCompanyLogo(company, choice);
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      onSaved(company, {
        domain: result.logo.domain,
        state: result.logo.state,
        source: result.logo.source,
        markUrl: result.logo.markUrl,
      });
      onClose();
    } catch (err) {
      toast("Couldn't save that logo", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={company != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md p-0">
        <div className="border-b border-line px-4 py-3">
          <DialogTitle className="text-base font-semibold text-fg">Logo for {company}</DialogTitle>
          <DialogDescription className="mt-1 text-xs text-fg-3">
            Pick a suggestion, or type a domain. A typed domain shows that website's own icon.
          </DialogDescription>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Company name"
            className="mt-3 h-9 w-full rounded-md border border-line-2 bg-surface-1 px-3 text-sm text-fg outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-uv-hi"
          />
        </div>
        <ul className="max-h-64 overflow-y-auto py-1">
          {hits.length === 0 && !searchError ? (
            <li className="px-4 py-3 text-sm text-fg-3">
              {query.trim() ? 'No matches.' : 'Searching…'}
            </li>
          ) : hits.length === 0 ? null : (
            hits.map((hit) => (
              <li key={`${hit.brandId ?? ''}-${hit.domain}`}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void save({ kind: 'pick', domain: hit.domain, brandId: hit.brandId })
                  }
                  className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-3 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-uv-hi disabled:opacity-45"
                >
                  <CompanyLogo name={hit.name} src={hit.icon} size={32} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-fg">{hit.name}</span>
                    <span className="block truncate text-xs text-fg-3">{hit.domain}</span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
        {searchError ? <p className="px-4 pb-2 text-xs text-danger">{searchError}</p> : null}
        {formError ? <p className="px-4 pb-2 text-xs text-danger">{formError}</p> : null}
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          {typing ? (
            <form
              className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const current = previewRef.current;
                if (current && current.input === typed && current.state !== 'loading') {
                  void save({ kind: 'type', domain: typed, markUrl: current.icon });
                  return;
                }
                void resolveTypedIcon(typed, AbortSignal.timeout(8000)).then((markUrl) =>
                  save({ kind: 'type', domain: typed, markUrl }),
                );
              }}
            >
              {preview?.input === typed && preview.icon ? (
                <CompanyLogo name={company ?? ''} src={preview.icon} size={32} />
              ) : null}
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                aria-label="Domain"
                placeholder="https://www.example.com"
                className="h-8 min-w-0 flex-1 rounded-md border border-line-2 bg-surface-1 px-2.5 text-sm text-fg outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-uv-hi"
              />
              <Button type="submit" size="sm" disabled={busy}>
                Save
              </Button>
              {preview?.input === typed && preview.state === 'loading' ? (
                <p className="basis-full text-xs text-fg-3">Looking up the site's icon…</p>
              ) : null}
              {preview?.input === typed && preview.state === 'ready' ? (
                <p className="basis-full text-xs text-fg-3">This is the site's own icon.</p>
              ) : null}
              {preview?.input === typed && preview.state === 'missing' ? (
                <p className="basis-full text-xs text-fg-3">
                  No icon on that site. The tile stays a letter.
                </p>
              ) : null}
            </form>
          ) : (
            <Button type="button" variant="secondary" size="sm" onClick={() => setTyping(true)}>
              Type a domain
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            disabled={busy}
            onClick={() => void save({ kind: 'none' })}
          >
            <ImageOff />
            No logo
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const ICON_HEAD = 200_000;

async function readHead(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let out = '';
  try {
    while (out.length < ICON_HEAD) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
      if (out.includes('</head>')) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return out;
}

/** The icon link on a site Kris typed. His browser fetches the page. A failure stays a letter. */
async function resolveTypedIcon(typed: string, signal: AbortSignal): Promise<string | null> {
  const domain = registrableHost(typed);
  if (!domain) return null;
  for (const origin of pageOrigins(typed, domain)) {
    if (signal.aborted) return null;
    try {
      const response = await fetch(origin, {
        signal,
        credentials: 'omit',
        redirect: 'follow',
        referrerPolicy: 'strict-origin-when-cross-origin',
      });
      if (!response.ok) continue;
      const type = response.headers.get('content-type') ?? '';
      if (type && !type.includes('html')) continue;
      const html = await readHead(response);
      if (registrableHost(response.url) !== domain) continue;
      const icon = siteIconFromHtml(html, response.url, domain);
      if (icon) return icon;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
    }
  }
  return null;
}
