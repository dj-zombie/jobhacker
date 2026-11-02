import { existsSync, readFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Criteria, Profile } from '../config/schemas.js';
import { type Db, createMigratedTestDb } from '../db/client.js';
import { applicationsRepo } from '../db/repo/applications.js';
import { companiesRepo } from '../db/repo/companies.js';
import { eventsRepo } from '../db/repo/events.js';
import { jobsRepo } from '../db/repo/jobs.js';
import { FakeLlm } from '../llm/fake.js';
import { testCriteria } from '../testing/fixtures.js';
import { type Clock, fixedClock } from '../util/clock.js';
import { nullLogger } from '../util/logger.js';
import { runPrep } from './prep.js';

let sqlite: ReturnType<typeof createMigratedTestDb>['sqlite'];
const tmpDirs: string[] = [];

afterEach(() => {
  sqlite?.close();
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs.length = 0;
});

function criteria(): Criteria {
  return testCriteria();
}

function profile(): Profile {
  return {
    contact: { name: 'Kris', email: 'k@example.com', phone: '1', location: 'Scottsdale, AZ' },
    links: {},
    summary: 'Senior engineer with React experience.',
    skills: { frontend: ['React'] },
    experience: [
      {
        id: 'acme',
        company: 'Acme',
        title: 'Senior Engineer',
        start: '2024-01',
        end: 'present',
        bullets: [{ id: 'acme-1', text: 'Built the design system in React.' }],
      },
    ],
    projects: [],
    education: [],
    standard_answers: { work_authorization_us: 'Yes', salary_expectation: '[NEEDS INPUT: ask]' },
  };
}

function seedJob(db: Db, clock: Clock): number {
  const companyId = companiesRepo(db, clock).upsert({
    name: 'Globex',
    ats: 'greenhouse',
    token: 'globex',
    active: true,
    tags: [],
  }).id;
  jobsRepo(db).upsert(
    {
      companyId,
      ats: 'greenhouse',
      externalId: 'job-1',
      title: 'Senior Frontend Engineer',
      locationRaw: 'Remote, US',
      remoteType: 'remote',
      employmentType: 'full_time',
      url: 'https://globex.example/1',
      applyUrl: null,
      descriptionText: 'Build a design system in React.',
      compMin: null,
      compMax: null,
      compCurrency: null,
      postedAt: null,
      contentHash: 'hash-1',
      dedupeKey: 'dk-1',
    },
    clock.now(),
  );
  return jobsRepo(db).find('greenhouse', 'job-1')?.id ?? 0;
}

function llm(): FakeLlm {
  return new FakeLlm({
    responder: (req) => {
      if (req.promptName === 'tailor') {
        return { bullets: [{ source_id: 'acme-1', text: 'Shipped a React design system.' }] };
      }
      if (req.promptName === 'cover-note') {
        return { text: 'Dear Globex team, I build React systems.' };
      }
      throw new Error(`unexpected prompt ${req.promptName}`);
    },
  });
}

describe('runPrep', () => {
  it('tailors, writes materials, persists the application, and records a prep event', async () => {
    const made = createMigratedTestDb();
    sqlite = made.sqlite;
    const db = made.db;
    const clock = fixedClock('2026-10-22T12:00:00.000Z');
    const jobId = seedJob(db, clock);
    const outputDir = mkdtempSync(join(tmpdir(), 'jobhacker-prep-'));
    tmpDirs.push(outputDir);

    const result = await runPrep(
      { db, llm: llm(), clock, log: nullLogger(), criteria: criteria(), profile: profile() },
      { jobId, outputDir, skipPdf: true },
    );

    expect(result.company).toBe('Globex');
    expect(result.bullets).toHaveLength(1);
    expect(result.bullets[0]?.grounded).toBe(true);
    expect(result.coverNoteGrounded).toBe(true);
    expect(result.pdfPath).toBeNull(); // skipPdf
    // The cover letter is finished (no marker); the salary answer's marker
    // comes from Kris's own profile and is surfaced as his to change.
    expect(result.coverNote).not.toContain('[NEEDS INPUT');
    expect(result.needsInput).toEqual(['[NEEDS INPUT: ask]']);

    // The HTML file was written to disk.
    expect(existsSync(result.htmlPath)).toBe(true);
    expect(readFileSync(result.htmlPath, 'utf8')).toContain('Shipped a React design system.');

    // The application row holds the generated materials.
    const app = applicationsRepo(db, clock).findByJob(jobId);
    expect(app?.status).toBe('prepped');
    expect(app?.coverNote).toContain('React systems');
    expect(app?.answers).toEqual({
      work_authorization_us: 'Yes',
      salary_expectation: '[NEEDS INPUT: ask]',
    });
    expect(app?.resumeHtml).toContain('Shipped a React design system.');

    // A prep event was appended with counts only (no generated text).
    const events = eventsRepo(db, clock).ofType('prep');
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ bullets: 1, needs_input: 1 });
  });

  it('throws PrepError for a missing job', async () => {
    const made = createMigratedTestDb();
    sqlite = made.sqlite;
    const db = made.db;
    const clock = fixedClock('2026-10-22T12:00:00.000Z');
    await expect(
      runPrep(
        { db, llm: llm(), clock, log: nullLogger(), criteria: criteria(), profile: profile() },
        { jobId: 999, skipPdf: true },
      ),
    ).rejects.toThrow(/job 999 not found/);
  });
});
