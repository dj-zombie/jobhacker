'use client';

import * as React from 'react';
import { brandSearchUrl } from '../../core/brand/logo-url.js';
import { recordBrandDomain } from '../lib/actions.js';

const LogoDomains = React.createContext<ReadonlyMap<string, string>>(new Map());

export function LogoDomainProvider({
  domains,
  children,
}: {
  domains: ReadonlyMap<string, string>;
  children: React.ReactNode;
}) {
  return <LogoDomains.Provider value={domains}>{children}</LogoDomains.Provider>;
}

export function useLogoDomains(): ReadonlyMap<string, string> {
  return React.useContext(LogoDomains);
}

const GAP_MS = 1600;
const TRIED_KEY = 'jh-logo-tried';
const BLOCKED_KEY = 'jh-logo-blocked';

function readTried(): Set<string> {
  try {
    const raw = sessionStorage.getItem(TRIED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer);
        reject(new DOMException('aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

/**
 * Looks up logo-set companies the job text didn't name. Brand Search runs in
 * the browser, one name at a time, and only an unambiguous match is stored.
 * Playwright sets `navigator.webdriver`, and this stays idle there.
 */
export function LogoLookup({
  clientId,
  names,
  onFound,
}: {
  clientId: string | null;
  names: readonly string[];
  onFound: (name: string, domain: string) => void;
}) {
  const [left, setLeft] = React.useState<number | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const key = names.join('\n');
  const namesRef = React.useRef(names);
  namesRef.current = names;
  const onFoundRef = React.useRef(onFound);
  onFoundRef.current = onFound;

  React.useEffect(() => {
    const pending = key === '' ? [] : namesRef.current;
    if (typeof navigator !== 'undefined' && navigator.webdriver) return;
    if (!clientId || pending.length === 0) return;
    if (sessionStorage.getItem(BLOCKED_KEY) === '1') {
      setNote('Logo lookup is paused until the next visit.');
      return;
    }
    const ctrl = new AbortController();
    const tried = readTried();
    const queue = pending.filter((name) => !tried.has(name));
    if (queue.length === 0) return;
    let cancelled = false;

    const run = async () => {
      for (let i = 0; i < queue.length; i++) {
        if (cancelled) return;
        const name = queue[i];
        if (!name) continue;
        setLeft(queue.length - i);
        const url = brandSearchUrl(name, clientId);
        if (!url) continue;
        let response: Response;
        try {
          response = await fetch(url, {
            signal: ctrl.signal,
            credentials: 'omit',
            referrerPolicy: 'strict-origin-when-cross-origin',
          });
        } catch {
          if (cancelled || ctrl.signal.aborted) return;
          sessionStorage.setItem(BLOCKED_KEY, '1');
          setNote('Logo lookup stopped. Reload the page to try the rest.');
          setLeft(null);
          return;
        }
        if (response.status === 429 || response.status === 503) {
          setNote('Logo lookup is waiting out a rate limit. Reload in a few minutes.');
          setLeft(null);
          return;
        }
        tried.add(name);
        sessionStorage.setItem(TRIED_KEY, JSON.stringify([...tried]));
        if (response.ok) {
          let body: unknown = null;
          try {
            body = await response.json();
          } catch {
            body = null;
          }
          const saved = await recordBrandDomain(name, body);
          if (saved.domain) onFoundRef.current(name, saved.domain);
        }
        if (i < queue.length - 1) await sleep(GAP_MS, ctrl.signal);
      }
      if (!cancelled) setLeft(null);
    };

    run().catch(() => {
      if (!cancelled) setLeft(null);
    });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [clientId, key]);

  if (left == null && !note) return null;
  return (
    <p className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-line bg-surface-2 px-3 py-1 text-2xs text-fg-3 shadow-pop">
      {left != null ? `Finding logos · ${left} to go` : note}
    </p>
  );
}
