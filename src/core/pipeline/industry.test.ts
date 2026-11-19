import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createMigratedTestDb } from '../db/client.js';
import { companiesRepo } from '../db/repo/companies.js';
import { jobsRepo } from '../db/repo/jobs.js';
import { companyIndustry, jobAreas, jobs } from '../db/schema.js';
import { FakeLlm } from '../llm/fake.js';
import type { IndustryOutput } from '../llm/prompts/industry.js';
import { INDUSTRY_SYSTEM } from '../llm/prompts/industry.js';
import { testCriteria } from '../testing/fixtures.js';
import { fixedClock } from '../util/clock.js';
import { createLogger } from '../util/logger.js';
import { computeFunnel } from './funnel.js';
import { applyGates } from './gate.js';
import {
  classifyIndustries,
  decideIndustry,
  industriesOf,
  industryAliasSet,
  industryInputHash,
  industryMatchValue,
  paletteScore,
} from './industry.js';
const PREFERENCES = [
  'Games, game studios, and game tools.',
  'Audio, music technology, and creative tools.',
  'Developer tools.',
].join('\n');

const SECRET = 'SECRET DESCRIPTION gamification in the body';

function answer(user: string, attempt: number): IndustryOutput {
  if (user.includes('Company: Retry Co') && attempt === 1) {
    return { industry_id: 'banking', reason: 'not on the list' };
  }
  if (user.includes('Company: Unknown Co')) {
    return { industry_id: 'banking', reason: 'not on the list' };
  }
  const company = /^Company: (.+)$/m.exec(user)?.[1] ?? '';
  const roles = user.split('Open roles:\n')[1] ?? '';
  const titles = [...roles.matchAll(/^- (.+)$/gm)].map((match) => match[1] ?? '');
  const gameRoles = titles.filter((title) =>
    /gameplay engineer|technical artist|economy designer/i.test(title),
  );
  if (gameRoles.length >= 2 || /\bgames\b/i.test(company)) {
    return { industry_id: 'games', reason: 'The company is in games.' };
  }
  if (titles.some((title) => /audio programmer|sound designer/i.test(title))) {
    return { industry_id: 'audio', reason: 'The company posts audio roles.' };
  }
  return { industry_id: null, reason: 'Not one of these industries.' };
}

function llm(): FakeLlm {
  return new FakeLlm({
    responder: (request, attempt) => {
      expect(request.system).toBe(INDUSTRY_SYSTEM);
      expect(request.user).not.toContain(SECRET);
      expect(request.user).not.toContain('description');
      return answer(request.user, attempt);
    },
  });
}

function add(
  db: ReturnType<typeof createMigratedTestDb>['db'],
  clock: ReturnType<typeof fixedClock>,
  name: string,
  titles: readonly string[],
): number {
  const companyId = companiesRepo(db, clock).upsert({
    name,
    ats: 'greenhouse',
    token: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    active: true,
    tags: [],
  }).id;
  const repo = jobsRepo(db);
  titles.forEach((title, i) => {
    repo.upsert(
      {
        companyId,
        ats: 'greenhouse',
        externalId: `${companyId}-${i}`,
        title,
        locationRaw: 'Remote, US',
        remoteType: 'remote',
        employmentType: 'full_time',
        url: `https://example.com/${companyId}/${i}`,
        applyUrl: null,
        descriptionText: SECRET,
        compMin: null,
        compMax: null,
        compCurrency: null,
        postedAt: clock.now(),
        contentHash: `h-${companyId}-${i}`,
        dedupeKey: `d-${companyId}-${i}`,
      },
      clock.now(),
    );
  });
  return companyId;
}

function setup() {
  const { db, sqlite } = createMigratedTestDb();
  const clock = fixedClock('2026-11-09T12:00:00.000Z');
  const criteria = testCriteria({ withPlaces: true });
  criteria.industries = [
    { id: 'games', label: 'Games', aliases: ['game', 'games', 'gaming'] },
    { id: 'audio', label: 'Audio', aliases: ['audio', 'music'] },
    {
      id: 'devtools',
      label: 'Developer tools',
      aliases: ['devtools', 'developer tools', 'dev tools'],
    },
  ];
  return { db, sqlite, clock, criteria };
}

async function run(env: ReturnType<typeof setup>, model: FakeLlm, limit?: number) {
  return classifyIndustries({
    db: env.db,
    llm: model,
    clock: env.clock,
    log: createLogger({ level: 'silent' }),
    criteria: env.criteria,
    preferences: PREFERENCES,
    ...(limit != null ? { limit } : {}),
  });
}

describe('classifyIndustries', () => {
  it('suggests games from game roles, from the name Epic Games, and audio from audio roles', async () => {
    const env = setup();
    add(env.db, env.clock, 'Bright Studio', [
      'Gameplay Engineer',
      'Technical Artist',
      'Economy Designer',
    ]);
    add(env.db, env.clock, 'Epic Games', ['Senior Software Engineer', 'Senior Frontend Engineer']);
    add(env.db, env.clock, 'Northwind Bank', ['Senior Software Engineer', 'Gamification Engineer']);
    add(env.db, env.clock, 'Waveform', ['Audio Programmer', 'Sound Designer']);
    const closed = add(env.db, env.clock, 'Closed Co', ['Gameplay Engineer']);
    env.db.update(jobs).set({ closedAt: env.clock.now() }).where(eq(jobs.companyId, closed)).run();
    applyGates(env.db, env.criteria.gates, env.clock.nowMs());
    const before = computeFunnel(env.db, env.clock, env.criteria);

    const stats = await run(env, llm());

    expect(stats.errors).toBe(0);
    expect(stats.byIndustry.games).toBe(2);
    expect(stats.byIndustry.audio).toBe(1);
    expect(stats.none).toBe(1);
    expect(stats.classified).toBe(4);
    const industryOf = (name: string) => {
      const company = env.db.select().from(companyIndustry).all();
      const id = companiesRepo(env.db, env.clock).get(
        'greenhouse',
        name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      )?.id;
      return company.find((row) => row.companyId === id);
    };
    expect(industryOf('Bright Studio')).toMatchObject({ industryId: 'games', status: 'suggested' });
    expect(industryOf('Epic Games')).toMatchObject({ industryId: 'games', status: 'suggested' });
    expect(industryOf('Northwind Bank')).toMatchObject({ industryId: null, status: 'suggested' });
    expect(industryOf('Waveform')).toMatchObject({ industryId: 'audio', status: 'suggested' });
    expect(industryOf('Closed Co')).toBeUndefined();

    const after = computeFunnel(env.db, env.clock, env.criteria);
    expect(after.total).toBe(before.total);
    expect(after.gatedTotal).toBe(before.gatedTotal);
    env.sqlite.close();
  });

  it('skips a confirmed or cleared company after its titles change', async () => {
    const env = setup();
    const studio = add(env.db, env.clock, 'Bright Studio', [
      'Gameplay Engineer',
      'Technical Artist',
    ]);
    const bank = add(env.db, env.clock, 'Northwind Bank', ['Senior Software Engineer']);
    applyGates(env.db, env.criteria.gates, env.clock.nowMs());
    const model = llm();
    await run(env, model);
    expect(decideIndustry(env.db, env.clock, studio, 'games')).toBe(true);
    expect(decideIndustry(env.db, env.clock, bank, null)).toBe(true);
    add(env.db, env.clock, 'Bright Studio', ['Economy Designer']);
    // The second title is a new job on the same company. add() upserts the company and inserts.
    const again = llm();
    const stats = await run(env, again);
    expect(again.callCount).toBe(0);
    expect(stats.decided).toBe(2);
    expect(stats.classified).toBe(0);
    const rows = env.db.select().from(companyIndustry).all();
    expect(rows.find((row) => row.companyId === studio)).toMatchObject({
      status: 'confirmed',
      industryId: 'games',
    });
    expect(rows.find((row) => row.companyId === bank)).toMatchObject({
      status: 'cleared',
      industryId: null,
    });
    env.sqlite.close();
  });

  it('stops at the cap and leaves the rest waiting', async () => {
    const env = setup();
    for (const name of ['One Co', 'Two Co', 'Three Co', 'Four Co']) {
      add(env.db, env.clock, name, ['Senior Software Engineer']);
    }
    applyGates(env.db, env.criteria.gates, env.clock.nowMs());
    const stats = await run(env, llm(), 2);
    expect(stats.classified).toBe(2);
    expect(stats.errors).toBe(0);
    expect(stats.waiting).toBe(2);
    env.sqlite.close();
  });

  it('retries once when the first id is not on the list, then stores the valid answer', async () => {
    const env = setup();
    add(env.db, env.clock, 'Retry Co', ['Senior Software Engineer']);
    applyGates(env.db, env.criteria.gates, env.clock.nowMs());
    const model = llm();
    const stats = await run(env, model);
    expect(model.attempts).toBe(2);
    expect(stats.errors).toBe(0);
    expect(stats.none).toBe(1);
    expect(env.db.select().from(companyIndustry).all()[0]).toMatchObject({
      industryId: null,
      status: 'suggested',
    });
    env.sqlite.close();
  });

  it('records an error when the id is never one of the list', async () => {
    const env = setup();
    add(env.db, env.clock, 'Unknown Co', ['Senior Software Engineer']);
    applyGates(env.db, env.criteria.gates, env.clock.nowMs());
    const stats = await run(env, llm());
    expect(stats.errors).toBe(1);
    expect(stats.classified).toBe(0);
    expect(env.db.select().from(companyIndustry).all()).toEqual([]);
    env.sqlite.close();
  });

  it('does not call again when the titles are unchanged', async () => {
    const env = setup();
    add(env.db, env.clock, 'Waveform', ['Audio Programmer']);
    applyGates(env.db, env.criteria.gates, env.clock.nowMs());
    await run(env, llm());
    const second = llm();
    const stats = await run(env, second);
    expect(second.callCount).toBe(0);
    expect(stats.unchanged).toBe(1);
    env.sqlite.close();
  });
});

describe('industry ordering and search', () => {
  it('scores an industry before a place, and still keeps every job', () => {
    const env = setup();
    const games = add(env.db, env.clock, 'Epic Games', ['Senior Software Engineer']);
    const gamesHere = add(env.db, env.clock, 'Bright Studio', ['Gameplay Engineer']);
    const here = add(env.db, env.clock, 'Northwind Bank', ['Senior Software Engineer']);
    const elsewhere = add(env.db, env.clock, 'Other Co', ['Senior Software Engineer']);
    applyGates(env.db, env.criteria.gates, env.clock.nowMs());
    decideIndustry(env.db, env.clock, games, 'games');
    decideIndustry(env.db, env.clock, gamesHere, 'games');
    const areaFor = (companyId: number) => {
      const job = env.db.select().from(jobs).where(eq(jobs.companyId, companyId)).get();
      if (!job) throw new Error('missing job');
      env.db.insert(jobAreas).values({ jobId: job.id, area: 'portland' }).run();
    };
    areaFor(gamesHere);
    areaFor(here);
    const titles = jobsRepo(env.db)
      .listScorable({ first: ['portland'], industry: 'games' })
      .map((job) => job.companyName);
    expect(titles).toEqual(['Bright Studio', 'Epic Games', 'Northwind Bank', 'Other Co']);
    env.sqlite.close();
  });

  it('opens Games for the query game and does not match a title by subsequence', () => {
    const industries = industriesOf({
      ...testCriteria(),
      industries: [
        { id: 'games', label: 'Games', aliases: ['game', 'games', 'gaming'] },
        { id: 'audio', label: 'Audio', aliases: ['audio', 'music'] },
        {
          id: 'devtools',
          label: 'Developer tools',
          aliases: ['devtools', 'developer tools', 'dev tools'],
        },
      ],
    });
    const aliases = industryAliasSet(industries);
    const games = industries[0];
    if (!games) throw new Error('missing games');
    expect(paletteScore(industryMatchValue(games), 'game', aliases)).toBe(1);
    expect(paletteScore('Engagement Manager at Acme', 'game', aliases)).toBe(0);
    expect(paletteScore('Gameplay Engineer at Riot', 'game', aliases)).toBe(0);
    expect(paletteScore('Senior Engineer at Acme', 'engineer', aliases)).toBe(1);
    expect(industryInputHash('Epic Games', ['B', 'A'])).toBe(
      industryInputHash('Epic Games', ['A', 'B', 'A']),
    );
  });
});
