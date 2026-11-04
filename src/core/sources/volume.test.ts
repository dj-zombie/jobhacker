import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type Http, HttpError } from '../util/http.js';
import { nullLogger } from '../util/logger.js';
import { breezyAdapter } from './breezy.js';
import { discoverBoards } from './discover.js';
import { parseHiringComments, pickHiringStory } from './hn.js';
import { parseJsearch } from './jsearch.js';
import { polymerAdapter } from './polymer.js';
import { generateQueries, queriesForRun } from './query-gen.js';
import { smartRecruitersAdapter } from './smartrecruiters.js';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(`tests/fixtures/${name}`, 'utf8'));
}

describe('new board adapters', () => {
  it('parses the live SmartRecruiters, Breezy and Polymer fixtures', () => {
    const company = {
      smartrecruiters: {
        name: 'SmartRecruiters',
        ats: 'smartrecruiters' as const,
        token: 'smartrecruiters',
      },
      breezy: { name: 'RhynoCare', ats: 'breezy' as const, token: 'rhynocare' },
      polymer: { name: 'Aperture Labs', ats: 'polymer' as const, token: 'aperturelabs' },
    };
    const sr = smartRecruitersAdapter.parse(fixture('smartrecruiters-smartrecruiters.json'));
    expect(sr.postings).toHaveLength(1);
    const srJob = smartRecruitersAdapter.normalize(sr.postings[0]!, company.smartrecruiters);
    expect(srJob.title).toBe('Engineering Team Lead SRE');
    expect(srJob.remoteType).toBe('remote');
    expect(srJob.url).toContain('jobs.smartrecruiters.com');

    const bz = breezyAdapter.parse(fixture('breezy-rhynocare.json'));
    expect(bz.postings).toHaveLength(1);
    const bzJob = breezyAdapter.normalize(bz.postings[0]!, company.breezy);
    expect(bzJob.url).toContain('rhynocare.breezy.hr');
    expect(bzJob.employmentType).toBe('full_time');

    const poly = polymerAdapter.parse(fixture('polymer-aperturelabs.json'));
    expect(poly.postings).toHaveLength(1);
    const polyJob = polymerAdapter.normalize(poly.postings[0]!, company.polymer);
    expect(polyJob.applyUrl).toContain('jobs.polymer.co');
  });
});

describe('generateQueries', () => {
  it('reads role phrases and remote/US from the prose sections', () => {
    const queries = generateQueries(
      [
        '## Roles I want',
        'Senior frontend and audio software.',
        '## Where I can work',
        'US-remote first.',
      ].join('\n'),
      '2026-10-23T00:00:00.000Z',
    );
    expect(queries.map((q) => q.titles[0])).toEqual([
      'senior frontend engineer',
      'audio software engineer',
    ]);
    expect(queries[0]?.remoteOnly).toBe(true);
    expect(queries[0]?.location).toBe('United States');
    expect(queries[0]?.since.startsWith('2026-09')).toBe(true);
  });

  it('runs each title remote and in each place, and rotates one run’s share of the budget', () => {
    const places = [
      { area: 'portland', location: 'Portland, OR' },
      { area: 'phoenix', location: 'Phoenix, AZ' },
    ];
    const queries = generateQueries(
      '## Roles I want\nSenior frontend and audio software.\n## Where I can work\nRemote within the US works.',
      '2026-10-25T00:00:00.000Z',
      places,
    );
    const label = (q: { area?: string; titles: string[]; location?: string }) =>
      `${q.area}: ${q.titles[0]} @ ${q.location}`;
    expect(queries.map(label)).toEqual([
      'remote: senior frontend engineer @ United States',
      'portland: senior frontend engineer @ Portland, OR',
      'phoenix: senior frontend engineer @ Phoenix, AZ',
      'remote: audio software engineer @ United States',
      'portland: audio software engineer @ Portland, OR',
      'phoenix: audio software engineer @ Phoenix, AZ',
    ]);
    expect(queries.filter((q) => q.area !== 'remote').every((q) => !q.remoteOnly)).toBe(true);

    // Two calls a run, as many as there are titles: three runs cover all six queries once.
    const runs = [0, 2, 4].map((calls) => queriesForRun(queries, calls, 2).map(label));
    expect(runs.flat().sort()).toEqual(queries.map(label).sort());
    expect(queriesForRun(queries, 7, 2).map((q) => q.area)).toEqual(['portland', 'phoenix']);
  });
});

describe('search parsers', () => {
  it('keeps a hiring comment and drops a short reply', () => {
    const hits = parseHiringComments(
      {
        page: 0,
        nbPages: 1,
        hits: [
          { objectID: '1', comment_text: 'Hi', created_at: '2026-10-20T00:00:00.000Z' },
          {
            objectID: '2',
            created_at: '2026-10-20T00:00:00.000Z',
            comment_text:
              'Treat Health | Full-stack Engineer | Helsinki | ONSITE<p>We build clinical software and need someone who has shipped React.</p>',
          },
        ],
      },
      '2026-09-01T00:00:00.000Z',
    );
    expect(hits.done).toBe(true);
    expect(hits.hits).toHaveLength(1);
    expect(hits.hits[0]?.companyName).toBe('Treat Health');
    expect(hits.hits[0]?.posting.ats).toBe('hn');
  });

  it('picks the Who is hiring story', () => {
    expect(
      pickHiringStory({
        hits: [
          { objectID: '9', title: 'Ask HN: Who is hiring? (October 2026)' },
          { objectID: '8', title: 'Something else' },
        ],
      }),
    ).toBe('9');
  });

  it('parses a JSearch data array', () => {
    const hits = parseJsearch({
      data: [
        {
          job_id: 'abc',
          job_title: 'Senior Frontend Engineer',
          employer_name: 'Example, Inc.',
          job_apply_link: 'https://boards.greenhouse.io/example/jobs/1',
          job_description: '<p>React</p>',
          job_is_remote: true,
          job_country: 'United States',
        },
      ],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.companyName).toBe('Example, Inc.');
    expect(hits[0]?.posting.descriptionText).toContain('React');
    expect(hits[0]?.posting.remoteType).toBe('remote');
  });
});

describe('discoverBoards', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('appends a board that returns postings and caches a 404', async () => {
    dir = mkdtempSync(join(tmpdir(), 'jobhacker-discover-'));
    writeFileSync(join(dir, 'companies.yaml'), 'companies: []\n');
    const seed = join(dir, 'seed.txt');
    writeFileSync(seed, 'greenhouse/discord\nno-such-board\n');
    const http: Http = {
      async postJson() {
        throw new Error('postJson is not used by this fake');
      },
      async getJson(url: string) {
        if (url.includes('/discord/')) return fixture('greenhouse-discord.json');
        throw new HttpError(`HTTP 404 from ${url}`, url, 404);
      },
    };
    const stats = await discoverBoards({
      seedPath: seed,
      http,
      log: nullLogger(),
      enabled: ['greenhouse'],
      dir,
      cachePath: join(dir, 'cache.json'),
    });
    expect(stats.added).toBe(1);
    expect(stats.misses).toBe(2);
    const yaml = readFileSync(join(dir, 'companies.yaml'), 'utf8');
    expect(yaml).toContain('discord');
    expect(yaml).not.toContain('no-such-board');

    const again = await discoverBoards({
      seedPath: seed,
      http: {
        async postJson() {
          throw new Error('postJson is not used by this fake');
        },
        async getJson() {
          throw new Error('should not probe a cached token');
        },
      },
      log: nullLogger(),
      enabled: ['greenhouse'],
      dir,
      cachePath: join(dir, 'cache.json'),
    });
    expect(again.cached).toBe(3);
    expect(again.probed).toBe(0);
  });

  it('probes a multi-word name joined as well as hyphenated, and stops at the first hit', async () => {
    dir = mkdtempSync(join(tmpdir(), 'jobhacker-discover-'));
    writeFileSync(join(dir, 'companies.yaml'), 'companies: []\n');
    const seed = join(dir, 'seed.txt');
    writeFileSync(seed, 'Riot Games\nDiscord\n');
    const probed: string[] = [];
    const http: Http = {
      async postJson() {
        throw new Error('postJson is not used by this fake');
      },
      async getJson(url: string) {
        probed.push(url);
        if (url.includes('/boards/riotgames/') || url.includes('/boards/discord/')) {
          return fixture('greenhouse-discord.json');
        }
        throw new HttpError(`HTTP 404 from ${url}`, url, 404);
      },
    };
    const stats = await discoverBoards({
      seedPath: seed,
      http,
      log: nullLogger(),
      enabled: ['greenhouse'],
      dir,
      cachePath: join(dir, 'cache.json'),
    });
    expect(probed.map((url) => new URL(url).pathname.split('/')[3])).toEqual([
      'riot-games',
      'riotgames',
      'discord',
    ]);
    expect(stats.added).toBe(2);
    expect(stats.misses).toBe(1);
    expect(readFileSync(join(dir, 'companies.yaml'), 'utf8')).toContain('token: riotgames');
  });
});
