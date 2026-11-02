import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDb } from '../db/client.js';
import { companiesRepo } from '../db/repo/companies.js';
import { jobsRepo } from '../db/repo/jobs.js';
import { jobs } from '../db/schema.js';
import { callsThisMonth, chargeCall } from '../sources/budget.js';
import { fixedClock } from '../util/clock.js';
import { assignDuplicates } from './dedupe.js';

let sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'];

afterEach(() => {
  sqlite?.close();
});

describe('source budget', () => {
  it('stops at the monthly call budget and does not write the refused call', () => {
    const made = createMigratedTestDb();
    sqlite = made.sqlite;
    expect(chargeCall(made.db, 'jsearch', '2026-10-23T00:00:00.000Z', 2, 0)).toBe(true);
    expect(chargeCall(made.db, 'jsearch', '2026-10-24T00:00:00.000Z', 2, 0)).toBe(true);
    expect(chargeCall(made.db, 'jsearch', '2026-10-25T00:00:00.000Z', 2, 0)).toBe(false);
    expect(callsThisMonth(made.db, 'jsearch', '2026-10-31T00:00:00.000Z')).toBe(2);
    expect(callsThisMonth(made.db, 'jsearch', '2026-11-01T00:00:00.000Z')).toBe(0);
  });
});

describe('assignDuplicates source quality', () => {
  it('keeps the ATS row when a search row of the same job was seen first', () => {
    const made = createMigratedTestDb();
    sqlite = made.sqlite;
    const clock = fixedClock('2026-10-01T00:00:00.000Z');
    const companies = companiesRepo(made.db, clock);
    const searchCo = companies.upsert({
      name: 'Stripe',
      ats: 'jsearch',
      token: 'stripe',
      active: true,
      tags: ['search'],
    });
    const boardCo = companies.upsert({
      name: 'Stripe',
      ats: 'greenhouse',
      token: 'stripe',
      active: true,
      tags: [],
    });
    const writes = jobsRepo(made.db);
    const search = writes.upsert(
      {
        companyId: searchCo.id,
        ats: 'jsearch',
        externalId: 'js-1',
        title: 'Engineer',
        locationRaw: 'Remote',
        remoteType: 'remote',
        employmentType: null,
        url: 'https://example.com/js',
        applyUrl: 'https://example.com/js',
        descriptionText: 'short',
        compMin: null,
        compMax: null,
        compCurrency: null,
        postedAt: null,
        contentHash: 'h1',
        dedupeKey: 'same',
        sourceKind: 'search',
        sourceName: 'jsearch',
        sourceQuality: 'medium',
      },
      '2026-10-01T00:00:00.000Z',
    );
    const board = writes.upsert(
      {
        companyId: boardCo.id,
        ats: 'greenhouse',
        externalId: 'gh-1',
        title: 'Engineer',
        locationRaw: 'Remote',
        remoteType: 'remote',
        employmentType: null,
        url: 'https://boards.greenhouse.io/stripe/jobs/1',
        applyUrl: null,
        descriptionText: 'full',
        compMin: null,
        compMax: null,
        compCurrency: null,
        postedAt: null,
        contentHash: 'h2',
        dedupeKey: 'same',
        sourceKind: 'board',
        sourceName: 'greenhouse',
        sourceQuality: 'high',
      },
      '2026-10-02T00:00:00.000Z',
    );
    expect(search.action).toBe('inserted');
    expect(board.action).toBe('inserted');
    expect(assignDuplicates(made.db).flagged).toBe(1);
    const rows = made.db.select().from(jobs).all();
    const canonical = rows.find((row) => row.duplicateOf === null);
    const copy = rows.find((row) => row.duplicateOf !== null);
    expect(canonical?.sourceQuality).toBe('high');
    expect(canonical?.ats).toBe('greenhouse');
    expect(copy?.sourceQuality).toBe('medium');
    expect(copy?.duplicateOf).toBe(canonical?.id);
  });
});
