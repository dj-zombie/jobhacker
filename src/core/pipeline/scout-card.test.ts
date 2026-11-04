import { describe, expect, it } from 'vitest';
import type { Criteria } from '../config/schemas.js';
import { type Db, createMigratedTestDb } from '../db/client.js';
import { companiesRepo } from '../db/repo/companies.js';
import { eventsRepo } from '../db/repo/events.js';
import { runsRepo } from '../db/repo/runs.js';
import { chargeCall } from '../sources/budget.js';
import { seedJobs, testCriteria } from '../testing/fixtures.js';
import { fixedClock } from '../util/clock.js';
import { scoutCard, scoutCheckedWords, scoutStaleBanner } from './scout-card.js';

const NOW = '2026-10-25T12:00:00.000Z';
const clock = fixedClock(NOW);

function criteria(overrides: { jsearchBudget?: number } = {}): Criteria {
  return {
    ...testCriteria(),
    sources: {
      boards: { enabled: ['greenhouse'] },
      search: {
        jsearch: { enabled: true, monthly_call_budget: overrides.jsearchBudget ?? 200 },
        jobspipe: { enabled: false, monthly_call_budget: 0, monthly_credit_budget: 0 },
        hn: { enabled: true, monthly_call_budget: 100 },
      },
      workday: { enabled: false },
    },
  };
}

function finishedRun(db: Db, ok: boolean, stats: unknown, error: string | null = null): void {
  const runs = runsRepo(db, fixedClock('2026-10-25T10:00:00.000Z'));
  const id = runs.start('scout');
  runsRepo(db, fixedClock('2026-10-25T10:15:00.000Z')).finish(id, { ok, stats, error });
}

describe('scoutCard', () => {
  it('is ok with no notices before any scout', () => {
    const { db } = createMigratedTestDb();
    const card = scoutCard(db, clock, criteria());
    expect(card).toMatchObject({ status: 'ok', notices: [], lastRun: null, running: false });
  });

  it('is ok after a clean run, with the boards and the new jobs of that run', () => {
    const { db } = createMigratedTestDb();
    seedJobs(db, clock, [{ title: 'A' }]);
    finishedRun(db, true, { inserted: 7, errors: [] });
    const card = scoutCard(db, clock, criteria());
    expect(card).toMatchObject({
      status: 'ok',
      notices: [],
      running: false,
      boards: 1,
      newLastRun: 7,
      lastRun: { startedAt: '2026-10-25T10:00:00.000Z', finishedAt: '2026-10-25T10:15:00.000Z' },
    });
  });

  it('asks for attention when the last run had board and search errors', () => {
    const { db } = createMigratedTestDb();
    finishedRun(db, true, {
      errors: [
        {
          company: 'Immunefi',
          ats: 'greenhouse',
          token: 'immunefi',
          message:
            'HTTP 404 from https://boards-api.greenhouse.io/v1/boards/immunefi/jobs?content=true: {"status":404,"error":"Job not found"}',
        },
        {
          company: 'Coinhako',
          ats: 'ashby',
          token: 'coinhako',
          message:
            'HTTP 404 from https://api.ashbyhq.com/posting-api/job-board/coinhako?includeCompensation=true: Not Found',
        },
        {
          company: 'Slow',
          ats: 'lever',
          token: 'slow',
          message: 'HTTP 503 from https://api.lever.co/v0/postings/slow',
        },
        {
          company: 'jsearch',
          ats: 'jsearch',
          token: 'search',
          message: 'HTTP 500 from https://jsearch.example/search',
        },
      ],
    });
    const card = scoutCard(db, clock, criteria());
    expect(card.status).toBe('attention');
    expect(card.notices).toEqual([
      {
        text: 'Immunefi: the Greenhouse board returned 404. The listing page is gone.',
        retire: { ats: 'greenhouse', token: 'immunefi', name: 'Immunefi' },
        relocate: { looked: null, candidates: [] },
      },
      {
        text: 'Coinhako: the Ashby board returned 404. The listing page is gone.',
        retire: { ats: 'ashby', token: 'coinhako', name: 'Coinhako' },
        relocate: { looked: null, candidates: [] },
      },
      {
        text: "Slow: the Lever board's server failed (503). Run scout again.",
      },
      { text: 'JSearch failed: the server returned 500. Run scout again.' },
    ]);
  });

  it('says whether to retry or turn the board off', () => {
    const { db } = createMigratedTestDb();
    finishedRun(db, true, {
      errors: [
        {
          company: 'Net',
          ats: 'greenhouse',
          token: 'net',
          message: 'network error for https://boards-api.greenhouse.io/v1/boards/net/jobs: timeout',
        },
        {
          company: 'Parse',
          ats: 'ashby',
          token: 'parse',
          message: 'ashby board returned 4 postings but none could be parsed (missing id)',
        },
        {
          company: 'Locked',
          ats: 'lever',
          token: 'locked',
          message: 'HTTP 403 from https://api.lever.co/v0/postings/locked',
        },
        {
          company: 'Odd',
          ats: 'breezy',
          token: 'odd',
          message: 'HTTP 418 from https://example.test/boards/odd: short and stout',
        },
        {
          company: 'jsearch',
          ats: 'jsearch',
          token: 'search',
          message: 'JSEARCH_API_KEY is not set; jsearch skipped',
        },
        {
          company: 'hn',
          ats: 'hn',
          token: 'search',
          message: 'hn listing was not read to the end, so nothing was closed',
        },
      ],
    });
    expect(scoutCard(db, clock, criteria()).notices).toEqual([
      { text: 'Net: the Greenhouse board did not respond. Run scout again.' },
      {
        text: 'Parse: the Ashby board answered, but none of its postings could be read. Run scout again.',
      },
      {
        text: 'Locked: the Lever board refused the request (403). It may no longer be public.',
        retire: { ats: 'lever', token: 'locked', name: 'Locked' },
      },
      {
        text: 'Odd: the Breezy board failed (HTTP 418 from short and stout). Run scout again.',
      },
      { text: 'JSearch failed: the API key is not set. Add it and run scout again.' },
      {
        text: 'Hacker News failed: the listing was not read to the end, so nothing was closed. Run scout again.',
      },
    ]);
  });

  it('drops a board that has already been turned off', () => {
    const { db } = createMigratedTestDb();
    companiesRepo(db, clock).upsert({
      name: 'Immunefi',
      ats: 'greenhouse',
      token: 'immunefi',
      active: false,
      tags: [],
    });
    finishedRun(db, true, {
      errors: [
        {
          company: 'Immunefi',
          ats: 'greenhouse',
          token: 'immunefi',
          message: 'HTTP 404 from https://boards-api.greenhouse.io/v1/boards/immunefi/jobs',
        },
        {
          company: 'Coinhako',
          ats: 'ashby',
          token: 'coinhako',
          message: 'HTTP 404 from https://api.ashbyhq.com/posting-api/job-board/coinhako',
        },
      ],
    });
    const card = scoutCard(db, clock, criteria());
    expect(card.notices).toEqual([
      {
        text: 'Coinhako: the Ashby board returned 404. The listing page is gone.',
        retire: { ats: 'ashby', token: 'coinhako', name: 'Coinhako' },
        relocate: { looked: null, candidates: [] },
      },
    ]);
  });

  it("shows where relocation looked, and what it found, on a gone board's notice", () => {
    const { db } = createMigratedTestDb();
    finishedRun(db, true, {
      errors: [
        {
          company: 'Coinhako',
          ats: 'ashby',
          token: 'coinhako',
          message: 'HTTP 404 from https://api.ashbyhq.com/posting-api/job-board/coinhako',
        },
        {
          company: 'Immunefi',
          ats: 'greenhouse',
          token: 'immunefi',
          message: 'HTTP 404 from https://boards-api.greenhouse.io/v1/boards/immunefi/jobs',
        },
      ],
      relocation: [
        {
          ats: 'ashby',
          token: 'coinhako',
          name: 'Coinhako',
          looked: ['greenhouse', 'lever', 'smartrecruiters'],
          matched_hits: 1,
          unanswered: [],
          candidates: [
            {
              ats: 'ashby',
              token: 'sbi-coinhako',
              name: 'SBI Coinhako',
              postings: 10,
              via: 'search',
            },
          ],
        },
        {
          ats: 'greenhouse',
          token: 'immunefi',
          name: 'Immunefi',
          looked: ['lever', 'ashby', 'smartrecruiters'],
          matched_hits: 0,
          unanswered: [],
          candidates: [],
        },
      ],
    });
    expect(scoutCard(db, clock, criteria()).notices).toEqual([
      {
        text: 'Coinhako: the Ashby board returned 404. The listing page is gone.',
        retire: { ats: 'ashby', token: 'coinhako', name: 'Coinhako' },
        relocate: {
          looked:
            'Looked on Greenhouse, Lever and SmartRecruiters, and in your search results: found 1 board',
          candidates: [{ ats: 'ashby', token: 'sbi-coinhako', name: 'SBI Coinhako', postings: 10 }],
        },
      },
      {
        text: 'Immunefi: the Greenhouse board returned 404. The listing page is gone.',
        retire: { ats: 'greenhouse', token: 'immunefi', name: 'Immunefi' },
        relocate: {
          looked:
            'Looked on Lever, Ashby and SmartRecruiters, and in your search results: no new board',
          candidates: [],
        },
      },
    ]);
  });

  it('fails when the last run failed, naming the error', () => {
    const { db } = createMigratedTestDb();
    finishedRun(db, false, null, 'database is locked\nstack…');
    const card = scoutCard(db, clock, criteria());
    expect(card.status).toBe('failed');
    expect(card.notices).toEqual([{ text: 'The last scout failed: database is locked' }]);
  });

  it('is running, with progress, while a recent run has no finish time', () => {
    const { db } = createMigratedTestDb();
    runsRepo(db, fixedClock('2026-10-25T11:50:00.000Z')).start('scout');
    seedJobs(db, fixedClock('2026-10-25T11:55:00.000Z'), [{ title: 'A' }, { title: 'B' }]);
    const card = scoutCard(db, clock, criteria());
    expect(card).toMatchObject({
      status: 'ok',
      running: true,
      progress: { done: 1, total: 1, found: 2, unit: 'Board' },
    });
  });

  it('fails when a run started hours ago never finished', () => {
    const { db } = createMigratedTestDb();
    runsRepo(db, fixedClock('2026-10-25T06:00:00.000Z')).start('scout');
    const card = scoutCard(db, clock, criteria());
    expect(card).toMatchObject({
      status: 'failed',
      running: false,
      progress: null,
      notices: [{ text: 'The last scout never finished' }],
    });
  });

  it('asks for attention when a search source is at its monthly budget', () => {
    const { db } = createMigratedTestDb();
    for (let i = 0; i < 3; i++) chargeCall(db, 'jsearch', NOW, 3, 0);
    const card = scoutCard(db, clock, criteria({ jsearchBudget: 3 }));
    expect(card.status).toBe('attention');
    expect(card.notices).toEqual([{ text: 'JSearch is at its monthly budget' }]);
  });

  it('counts the model calls this month, and model spend alone is never a notice', () => {
    const { db } = createMigratedTestDb();
    const events = eventsRepo(db, clock);
    events.append({
      type: 'llm_usage',
      payload: { model: 'claude-haiku-5-5', input_tokens: 100_000_000, output_tokens: 1_000_000 },
    });
    events.append({ type: 'llm_usage', payload: { model: 'claude-haiku-5-5', calls: 2 } });
    const card = scoutCard(db, clock, criteria());
    expect(card.status).toBe('ok');
    expect(card.notices).toEqual([]);
    expect(card.modelCalls).toBe(3);
  });
});

const DAY_MS = 86_400_000;

function finishedScout(db: Db, finishedIso: string): void {
  const start = new Date(Date.parse(finishedIso) - 60_000).toISOString();
  const id = runsRepo(db, fixedClock(start)).start('scout');
  runsRepo(db, fixedClock(finishedIso)).finish(id, { ok: true, stats: {} });
}

describe('scoutStaleBanner', () => {
  it('a finished scout 8 days ago returns a banner', () => {
    const { db } = createMigratedTestDb();
    const finishedAt = new Date(Date.parse(NOW) - 8 * DAY_MS).toISOString();
    finishedScout(db, finishedAt);
    expect(scoutStaleBanner(db, clock)).toEqual({ checkedAt: finishedAt });
    expect(scoutCheckedWords('2026-10-26T12:47:00.000Z')).toBe('26 Oct 2026');
  });

  it('a finished scout 6 days ago returns none', () => {
    const { db } = createMigratedTestDb();
    finishedScout(db, new Date(Date.parse(NOW) - 6 * DAY_MS).toISOString());
    expect(scoutStaleBanner(db, clock)).toBeNull();
  });

  it('no finished scout returns a banner', () => {
    const { db } = createMigratedTestDb();
    const id = runsRepo(db, clock).start('scout');
    expect(runsRepo(db, clock).get(id)?.finishedAt).toBeNull();
    expect(scoutStaleBanner(db, clock)).toEqual({ checkedAt: null });
  });

  it('a run still going does not count as the last check', () => {
    const { db } = createMigratedTestDb();
    const finishedAt = new Date(Date.parse(NOW) - 8 * DAY_MS).toISOString();
    finishedScout(db, finishedAt);
    runsRepo(db, clock).start('scout');
    expect(scoutStaleBanner(db, clock)).toEqual({ checkedAt: finishedAt });
  });
});
