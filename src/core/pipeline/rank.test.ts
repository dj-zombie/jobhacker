import { describe, expect, it } from 'vitest';
import { DIMENSIONS, type Dimension, type Weights } from '../config/schemas.js';
import type { Dimensions } from '../db/schema.js';
import {
  baseRankScore,
  computeRank,
  contributions,
  rankJobs,
  rankScore,
  verdictFor,
} from './rank.js';

const EVEN: Weights = {
  role_fit: 1,
  tech_fit: 1,
  domain_interest: 1,
  seniority_fit: 1,
  logistics_fit: 1,
  comp_fit: 1,
};
const DEFAULT: Weights = {
  role_fit: 3,
  tech_fit: 2,
  domain_interest: 2,
  seniority_fit: 2,
  logistics_fit: 4,
  comp_fit: 1,
};
const BANDS = { strong: 75, maybe: 55 };

function dims(
  scores: Partial<Record<Dimension, number | null>>,
  fill: number | null = null,
): Dimensions {
  return Object.fromEntries(
    DIMENSIONS.map((d) => [
      d,
      { score: d in scores ? (scores[d] ?? null) : fill, reason: `${d} reason` },
    ]),
  ) as Dimensions;
}

describe('rankScore', () => {
  it.each([
    { name: 'all fives', d: dims({}, 5), w: DEFAULT, want: 100 },
    { name: 'all zeros', d: dims({}, 0), w: DEFAULT, want: 0 },
    { name: 'all threes, even weights', d: dims({}, 3), w: EVEN, want: 60 },
    { name: 'every dimension null', d: dims({}, null), w: DEFAULT, want: null },
    {
      name: 'one null renormalizes over the rest',
      d: dims({ comp_fit: null }, 4),
      w: DEFAULT,
      want: 80,
    },
    { name: 'only comp known', d: dims({ comp_fit: 2 }), w: DEFAULT, want: 40 },
    {
      name: 'weighted mean with default weights',
      // (3·5 + 2·4 + 2·2 + 2·5 + 4·5 + 1·3) / 14 × 20 = 60/14 × 20 = 85.71
      d: dims({
        role_fit: 5,
        tech_fit: 4,
        domain_interest: 2,
        seniority_fit: 5,
        logistics_fit: 5,
        comp_fit: 3,
      }),
      w: DEFAULT,
      want: 86,
    },
    {
      name: 'zero weight on the only known dimension',
      d: dims({ comp_fit: 5 }),
      w: { ...DEFAULT, comp_fit: 0 },
      want: null,
    },
    {
      name: 'critical cap applies even when that dimension has zero weight',
      d: dims({ role_fit: 5, logistics_fit: 0 }, 5),
      w: { ...DEFAULT, logistics_fit: 0 },
      want: 54,
    },
  ])('$name', ({ d, w, want }) => {
    expect(rankScore(d, w, BANDS)).toBe(want);
  });

  it('caps a known critical zero at no while keeping the uncapped score explainable', () => {
    const great = dims({ logistics_fit: 0 }, 5);
    expect(baseRankScore(great, DEFAULT)).toBe(71);
    expect(computeRank(great, DEFAULT, BANDS)).toEqual({
      baseScore: 71,
      score: 54,
      cap: { level: 0, dimensions: ['logistics_fit'], maxScore: 54 },
    });
    expect(verdictFor(rankScore(great, DEFAULT, BANDS), BANDS)).toBe('no');
  });

  it('caps a critical one below strong', () => {
    const result = computeRank(dims({ role_fit: 1 }, 5), DEFAULT, BANDS);
    expect(result.baseScore).toBe(83);
    expect(result.score).toBe(74);
    expect(result.cap).toEqual({
      level: 1,
      dimensions: ['role_fit'],
      maxScore: 74,
    });
    expect(verdictFor(result.score, BANDS)).toBe('maybe');
  });

  it('does not cap an unknown critical dimension', () => {
    const result = computeRank(dims({ logistics_fit: null }, 5), DEFAULT, BANDS);
    expect(result).toEqual({ baseScore: 100, score: 100, cap: null });
  });
});

describe('verdictFor', () => {
  it.each([
    { score: 100, want: 'strong' },
    { score: 75, want: 'strong' },
    { score: 74, want: 'maybe' },
    { score: 55, want: 'maybe' },
    { score: 54, want: 'no' },
    { score: 0, want: 'no' },
    { score: null, want: 'no' },
  ] as const)('$score → $want', ({ score, want }) => {
    expect(verdictFor(score, BANDS)).toBe(want);
  });
});

describe('contributions', () => {
  it('reports weight × score per dimension and null for unknown', () => {
    const c = contributions(dims({ role_fit: 4, comp_fit: null }, 2), DEFAULT);
    expect(c.find((x) => x.dimension === 'role_fit')).toEqual({
      dimension: 'role_fit',
      weight: 3,
      score: 4,
      weighted: 12,
    });
    expect(c.find((x) => x.dimension === 'comp_fit')?.weighted).toBeNull();
    expect(c).toHaveLength(6);
  });
});

describe('rankJobs', () => {
  const rows = [
    { jobId: 1, dimensions: dims({}, 3) },
    { jobId: 2, dimensions: dims({}, null) },
    { jobId: 3, dimensions: dims({}, 5) },
    { jobId: 4, dimensions: dims({}, 3) },
    { jobId: 5, dimensions: dims({ logistics_fit: 5 }, 1) },
  ];

  it('sorts best first, unscorable last, ties by job id', () => {
    expect(rankJobs(rows, DEFAULT, BANDS).map((r) => r.jobId)).toEqual([3, 1, 4, 5, 2]);
  });

  it('re-ranks when the weights change, with no other input', () => {
    const logisticsOnly: Weights = {
      ...EVEN,
      role_fit: 0,
      tech_fit: 0,
      domain_interest: 0,
      seniority_fit: 0,
      comp_fit: 0,
    };
    const ranked = rankJobs(rows, logisticsOnly, BANDS);
    expect(ranked.map((r) => r.jobId)).toEqual([3, 5, 1, 4, 2]);
    expect(ranked[1]).toMatchObject({ jobId: 5, score: 74, verdict: 'maybe' });
  });

  it('carries the row through and attaches score and verdict', () => {
    const [top] = rankJobs(rows, DEFAULT, BANDS);
    expect(top).toMatchObject({ jobId: 3, score: 100, verdict: 'strong' });
    expect(top?.dimensions).toBe(rows[2]?.dimensions);
  });
});
