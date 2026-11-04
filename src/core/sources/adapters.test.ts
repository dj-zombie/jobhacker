import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Http } from '../util/http.js';
import { ashbyAdapter, ashbyBoardUrl } from './ashby.js';
import { greenhouseAdapter, greenhouseBoardUrl, greenhouseCompanyName } from './greenhouse.js';
import { leverAdapter, leverBoardUrl } from './lever.js';

function readFixture(name: string): unknown {
  const raw: unknown = JSON.parse(readFileSync(`tests/fixtures/${name}`, 'utf8'));
  return raw;
}

function recordingHttp(body: unknown): { http: Http; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    http: {
      async postJson() {
        throw new Error('postJson is not used by this fake');
      },
      async getJson(url: string) {
        urls.push(url);
        return body;
      },
    },
  };
}

describe('greenhouse adapter', () => {
  const fixture = readFixture('greenhouse-discord.json');

  it('parses the live fixture and keeps the public id, not internal_job_id', () => {
    const parsed = greenhouseAdapter.parse(fixture);
    expect(parsed.skipped).toEqual([]);
    expect(parsed.postings).toHaveLength(2);

    const onsite = parsed.postings.find((job) => job.id === 8806482002);
    const remote = parsed.postings.find((job) => job.id === 8464570002);
    expect(onsite).toBeDefined();
    expect(remote).toBeDefined();
    if (!onsite || !remote) return;

    const company = { name: 'Discord', ats: 'greenhouse' as const, token: 'discord' };
    const onsiteJob = greenhouseAdapter.normalize(onsite, company);
    const remoteJob = greenhouseAdapter.normalize(remote, company);

    expect(onsiteJob.externalId).toBe('8806482002');
    expect(onsiteJob.externalId).not.toBe(String(onsite.internal_job_id));
    expect(onsiteJob.remoteType).toBe('onsite');
    expect(onsiteJob.locationRaw).toBe('San Francisco Bay Area');
    expect(onsiteJob.descriptionText).toContain('play video games');
    expect(onsiteJob.descriptionText).not.toMatch(/&lt;|<[a-z]/i);
    expect(onsiteJob.compMin).toBeNull();
    expect(onsiteJob.postedAt).toBe('2026-09-15T16:52:11.000Z');

    expect(remoteJob.externalId).toBe('8464570002');
    expect(remoteJob.remoteType).toBe('remote');
    expect(remoteJob.title).toBe('Staff Software Engineer - Consumer Revenue');
    expect(remoteJob.postedAt).toBe('2026-09-02T23:29:30.000Z');
    expect(greenhouseCompanyName(fixture)).toBe('Discord');
  });

  it('ignores unknown fields, skips one bad posting, and refuses a board that parses as nothing', () => {
    const raw = readFixture('greenhouse-discord.json') as { jobs: unknown[] };
    const jobs = raw.jobs;
    const first = jobs[0];
    if (first && typeof first === 'object') {
      (first as { futureField?: boolean }).futureField = true;
    }
    jobs.push({ id: 1 });
    const parsed = greenhouseAdapter.parse(raw);
    expect(parsed.postings).toHaveLength(2);
    expect(parsed.skipped).toHaveLength(1);
    expect(parsed.skipped[0]).toMatch(/title/);

    expect(() => greenhouseAdapter.parse({ jobs: [{ id: 1 }, { title: 'No id' }] })).toThrow(
      /none could be parsed/,
    );
    expect(() => greenhouseAdapter.parse({ error: 'nope' })).toThrow(/greenhouse board payload/);
  });

  it('requests the public jobs endpoint', async () => {
    const { http, urls } = recordingHttp({ jobs: [] });
    await greenhouseAdapter.fetchBoard('discord', http);
    expect(urls).toEqual([greenhouseBoardUrl('discord')]);
    expect(greenhouseBoardUrl('discord')).toBe(
      'https://boards-api.greenhouse.io/v1/boards/discord/jobs?content=true',
    );
    await expect(greenhouseAdapter.fetchBoard('bad token', http)).rejects.toThrow(
      /invalid board token/,
    );
  });
});

describe('lever adapter', () => {
  it('parses the live fixture and lets workplaceType beat the city', () => {
    const parsed = leverAdapter.parse(readFixture('lever-spotify.json'));
    expect(parsed.skipped).toEqual([]);
    expect(parsed.postings).toHaveLength(3);
    const company = { name: 'Spotify', ats: 'lever' as const, token: 'spotify' };

    const remote = parsed.postings.find((job) => job.workplaceType === 'remote');
    const hybrid = parsed.postings.find((job) => job.workplaceType === 'hybrid');
    const onsite = parsed.postings.find((job) => job.workplaceType === 'onsite');
    expect(remote && hybrid && onsite).toBeTruthy();
    if (!remote || !hybrid || !onsite) return;

    const remoteJob = leverAdapter.normalize(remote, company);
    expect(remoteJob.remoteType).toBe('remote');
    expect(remoteJob.locationRaw).toBe('New York, NY');
    expect(remoteJob.employmentType).toBe('full_time');
    expect(remoteJob.url).toBe(remote.hostedUrl);
    expect(remoteJob.applyUrl).toBe(remote.applyUrl);
    expect(remoteJob.descriptionText).toContain("What You'll Do");
    expect(remoteJob.descriptionText).not.toMatch(/<li[\s>]/i);
    expect(remoteJob.externalId).toBe('4310f31c-90e1-4e8d-bdcf-dce39c145b8c');
    expect(remoteJob.postedAt).toBe(new Date(1783608935950).toISOString());

    expect(leverAdapter.normalize(hybrid, company).employmentType).toBe('temporary');
    expect(leverAdapter.normalize(hybrid, company).remoteType).toBe('hybrid');
    expect(leverAdapter.normalize(onsite, company).remoteType).toBe('onsite');
  });

  it('requests the public postings endpoint', async () => {
    const { http, urls } = recordingHttp([]);
    await leverAdapter.fetchBoard('spotify', http);
    expect(urls).toEqual([leverBoardUrl('spotify')]);
    expect(leverBoardUrl('spotify')).toBe('https://api.lever.co/v0/postings/spotify?mode=json');
  });
});

describe('ashby adapter', () => {
  it('parses the live fixture, trims titles, and spans yearly USD salary', () => {
    const parsed = ashbyAdapter.parse(readFixture('ashby-ramp.json'));
    expect(parsed.skipped).toEqual([]);
    expect(parsed.postings).toHaveLength(3);
    const company = { name: 'Ramp', ats: 'ashby' as const, token: 'ramp' };

    const hybrid = parsed.postings.find((job) => job.id === '34413f8d-26bf-4bbc-8ade-eb309a0e2245');
    const remote = parsed.postings.find((job) => job.workplaceType === 'Remote');
    const onsite = parsed.postings.find((job) => job.workplaceType === 'OnSite');
    expect(hybrid && remote && onsite).toBeTruthy();
    if (!hybrid || !remote || !onsite) return;

    const hybridJob = ashbyAdapter.normalize(hybrid, company);
    expect(hybridJob.title).toBe('Security Engineer, Cloud');
    expect(hybridJob.remoteType).toBe('hybrid');
    expect(hybrid.isRemote).toBe(true);
    expect(hybridJob.employmentType).toBe('full_time');
    expect(hybridJob.compMin).toBe(211400);
    expect(hybridJob.compMax).toBe(290600);
    expect(hybridJob.compCurrency).toBe('USD');
    expect(hybridJob.url).toContain('jobs.ashbyhq.com/ramp/');
    expect(hybridJob.applyUrl).toContain('/application');
    expect(hybridJob.descriptionText.length).toBeGreaterThan(40);
    expect(hybridJob.descriptionText).not.toMatch(/<[a-z]/i);

    const remoteJob = ashbyAdapter.normalize(remote, company);
    expect(remoteJob.remoteType).toBe('remote');
    expect(remoteJob.compMin).toBe(190000);
    expect(remoteJob.compMax).toBe(330000);
    expect(remoteJob.compCurrency).toBe('USD');

    expect(ashbyAdapter.normalize(onsite, company).remoteType).toBe('onsite');
    expect(ashbyAdapter.normalize(onsite, company).compMin).toBe(230000);
  });

  it('drops unlisted postings without treating that as a parse failure', () => {
    const raw = readFixture('ashby-ramp.json') as { jobs: Record<string, unknown>[] };
    raw.jobs.push({
      id: 'unlisted',
      title: 'Hidden',
      jobUrl: 'https://jobs.ashbyhq.com/ramp/unlisted',
      isListed: false,
    });
    const parsed = ashbyAdapter.parse(raw);
    expect(parsed.postings).toHaveLength(3);
    expect(parsed.skipped).toEqual([]);
    expect(parsed.postings.some((job) => job.id === 'unlisted')).toBe(false);
  });

  it('requests the public job-board endpoint', async () => {
    const { http, urls } = recordingHttp({ jobs: [] });
    await ashbyAdapter.fetchBoard('ramp', http);
    expect(urls).toEqual([ashbyBoardUrl('ramp')]);
    expect(ashbyBoardUrl('ramp')).toBe(
      'https://api.ashbyhq.com/posting-api/job-board/ramp?includeCompensation=true',
    );
  });
});
