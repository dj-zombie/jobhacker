import { describe, expect, it } from 'vitest';
import {
  canonicalArxivAbs,
  createNoteLinkReader,
  groundingFromArxivHtml,
  groundingFromPage,
  linkInNote,
  publicPageUrl,
  resetLinkFetchGap,
} from './citations.js';

const PAGE = [
  '<meta name="citation_title" content="CLAP: Learning Audio Concepts From Natural Language Supervision" />',
  '<meta name="citation_author" content="Elizalde, Benjamin" />',
  '<meta name="citation_date" content="2022/06/09" />',
  '<meta name="citation_arxiv_id" content="2206.04769" />',
  '<meta name="citation_abstract" content="We evaluated 16 tasks." />',
].join('');

describe('linkInNote', () => {
  it('keeps the first public https link and drops a trailing period', () => {
    expect(linkInNote('See https://arxiv.org/abs/2206.04769. Excited about it.')).toEqual({
      ok: true,
      url: 'https://arxiv.org/abs/2206.04769',
    });
    expect(linkInNote('No link here.')).toBeNull();
  });

  it('rejects a private host and does not treat it as absent', () => {
    expect(linkInNote('https://127.0.0.1/secret')).toEqual({
      ok: false,
      reason: 'that link is not a public page',
    });
    expect(linkInNote('https://localhost/paper')).toEqual({
      ok: false,
      reason: 'that link is not a public page',
    });
    expect(publicPageUrl('https://fc.example.com/a')).toBe('https://fc.example.com/a');
  });
});

describe('groundingFromPage', () => {
  it('uses the arXiv record when the link is an abstract', () => {
    const grounding = groundingFromPage(PAGE, 'https://arxiv.org/pdf/2206.04769');
    expect(grounding?.numbers).toBe('2206.04769');
    expect(grounding?.terms).toContain('Elizalde, Benjamin');
  });

  it('keeps the wording of another page and none of its numbers', () => {
    const html = '<p>Ada Lovelace wrote the notes on the analytical engine in 1843.</p>';
    const grounding = groundingFromPage(html, 'https://example.com/notes');
    expect(grounding?.terms).toContain('Ada Lovelace');
    expect(grounding?.numbers).toBe('');
  });
});

describe('createNoteLinkReader', () => {
  it('reads an arXiv pdf link as the abstract', async () => {
    resetLinkFetchGap();
    const fetched: string[] = [];
    const read = createNoteLinkReader({
      fetch: async (url) => {
        fetched.push(String(url));
        return new Response(PAGE, { status: 200, headers: { 'content-type': 'text/html' } });
      },
      now: () => 9_000,
      sleep: async () => {},
    });
    const page = await read('https://arxiv.org/pdf/2206.04769v2');
    expect(fetched).toEqual(['https://arxiv.org/abs/2206.04769']);
    expect(page?.terms).toContain('Elizalde, Benjamin');
    expect(await read('https://192.168.0.1/paper')).toBeNull();
  });
});

describe('canonicalArxivAbs', () => {
  it('keeps an abstract id and rewrites a pdf link', () => {
    expect(canonicalArxivAbs('https://arxiv.org/abs/2206.04769')).toBe(
      'https://arxiv.org/abs/2206.04769',
    );
    expect(canonicalArxivAbs('https://arxiv.org/pdf/2206.04769v2')).toBe(
      'https://arxiv.org/abs/2206.04769',
    );
    expect(canonicalArxivAbs('https://export.arxiv.org/html/2206.04769')).toBe(
      'https://arxiv.org/abs/2206.04769',
    );
  });

  it('rejects anything that is not that page', () => {
    expect(canonicalArxivAbs('http://arxiv.org/abs/2206.04769')).toBeNull();
    expect(canonicalArxivAbs('https://example.com/abs/2206.04769')).toBeNull();
    expect(canonicalArxivAbs('https://arxiv.org/search/?query=clap')).toBeNull();
    expect(canonicalArxivAbs('not a url')).toBeNull();
  });
});

describe('groundingFromArxivHtml', () => {
  it('keeps the title, authors, abstract, and id, and drops the year', () => {
    const grounding = groundingFromArxivHtml(PAGE, 'https://arxiv.org/abs/2206.04769');
    expect(grounding?.terms).toContain('Elizalde, Benjamin');
    expect(grounding?.terms).toContain('We evaluated 16 tasks.');
    expect(grounding?.terms).toContain('arXiv');
    expect(grounding?.numbers).toBe('2206.04769');
    expect(grounding?.numbers).not.toContain('2022');
    expect(grounding?.numbers).not.toContain('16');
  });

  it('returns null for a page with no citation', () => {
    expect(
      groundingFromArxivHtml(
        '<html><title>Error</title></html>',
        'https://arxiv.org/abs/2206.04769',
      ),
    ).toBeNull();
  });
});

describe('createNoteLinkReader redirects', () => {
  const page = '<p>Ada Lovelace wrote the notes on the analytical engine in 1843.</p>';

  it('does not fetch a public link that redirects to a private address', async () => {
    resetLinkFetchGap();
    const fetched: string[] = [];
    const read = createNoteLinkReader({
      fetch: async (url, init) => {
        const target = String(url);
        fetched.push(target);
        const location = 'https://127.0.0.1/secret';
        if (init?.redirect !== 'manual') {
          fetched.push(location);
          return new Response(
            '<p>secret from the local network that must never be read by the drafter</p>',
            { status: 200, headers: { 'content-type': 'text/html' } },
          );
        }
        if (target.includes('127.0.0.1') || target.includes('192.168.')) {
          return new Response(
            '<p>secret from the local network that must never be read by the drafter</p>',
            { status: 200, headers: { 'content-type': 'text/html' } },
          );
        }
        return new Response(null, { status: 302, headers: { location } });
      },
      now: () => 4_000,
      sleep: async () => {},
    });
    expect(await read('https://example.com/go')).toBeNull();
    expect(fetched).toEqual(['https://example.com/go']);
  });

  it('follows a redirect to another public page and reads that page', async () => {
    resetLinkFetchGap();
    const fetched: string[] = [];
    const read = createNoteLinkReader({
      fetch: async (url, init) => {
        const target = String(url);
        fetched.push(target);
        expect(init?.redirect).toBe('manual');
        if (target === 'https://example.com/go') {
          return new Response(null, {
            status: 302,
            headers: { location: 'https://example.com/notes' },
          });
        }
        return new Response(page, { status: 200, headers: { 'content-type': 'text/html' } });
      },
      now: () => 5_000,
      sleep: async () => {},
    });
    const grounding = await read('https://example.com/go');
    expect(fetched).toEqual(['https://example.com/go', 'https://example.com/notes']);
    expect(grounding?.terms).toContain('Ada Lovelace');
    expect(grounding?.numbers).toBe('');
  });

  it('stops after a few hops and never requests the next one', async () => {
    resetLinkFetchGap();
    const fetched: string[] = [];
    const read = createNoteLinkReader({
      fetch: async (url, init) => {
        const target = String(url);
        fetched.push(target);
        if (init?.redirect !== 'manual') {
          return new Response(page, { status: 200, headers: { 'content-type': 'text/html' } });
        }
        const hop = Number(new URL(target).pathname.slice(1));
        return new Response(null, {
          status: 302,
          headers: { location: `https://example.com/${hop + 1}` },
        });
      },
      now: () => 6_000,
      sleep: async () => {},
    });
    expect(await read('https://example.com/0')).toBeNull();
    expect(fetched.length).toBeGreaterThan(1);
    expect(fetched).not.toContain('https://example.com/4');
    expect(fetched[0]).toBe('https://example.com/0');
  });

  it('does not follow a redirect onto the local network', async () => {
    resetLinkFetchGap();
    const fetched: string[] = [];
    const read = createNoteLinkReader({
      fetch: async (url, init) => {
        fetched.push(String(url));
        expect(init?.redirect).toBe('manual');
        return new Response(null, {
          status: 302,
          headers: { location: 'https://192.168.1.20/admin' },
        });
      },
      now: () => 7_000,
      sleep: async () => {},
    });
    expect(await read('https://example.com/lan')).toBeNull();
    expect(fetched).toEqual(['https://example.com/lan']);
  });
});

describe('createNoteLinkReader pacing', () => {
  it('waits a second between two reads', async () => {
    resetLinkFetchGap();
    let now = 1_000;
    const slept: number[] = [];
    const read = createNoteLinkReader({
      fetch: async () =>
        new Response(PAGE, { status: 200, headers: { 'content-type': 'text/html' } }),
      now: () => now,
      sleep: async (ms) => {
        slept.push(ms);
        now += ms;
      },
    });

    expect((await read('https://arxiv.org/abs/2206.04769'))?.numbers).toBe('2206.04769');
    expect((await read('https://arxiv.org/abs/2206.04769'))?.numbers).toBe('2206.04769');
    expect(slept).toEqual([1_000]);
  });

  it('returns null when the page is not html or not ok', async () => {
    resetLinkFetchGap();
    const pdf = createNoteLinkReader({
      fetch: async () =>
        new Response('binary', { status: 200, headers: { 'content-type': 'application/pdf' } }),
      now: () => 5_000,
      sleep: async () => {},
    });
    expect(await pdf('https://arxiv.org/abs/2206.04769')).toBeNull();
    const missing = createNoteLinkReader({
      fetch: async () => new Response('gone', { status: 404 }),
      now: () => 9_000,
      sleep: async () => {},
    });
    expect(await missing('https://example.com/paper')).toBeNull();
  });
});
