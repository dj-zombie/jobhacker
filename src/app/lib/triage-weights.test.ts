import { describe, expect, it } from 'vitest';
import type { Weights } from '../../core/config/schemas.js';
import { kitWeights, weightsFromKit } from './triage.js';

const WEIGHTS: Weights = {
  role_fit: 6,
  tech_fit: 2,
  domain_interest: 2,
  seniority_fit: 2,
  logistics_fit: 4,
  comp_fit: 1,
};

describe('tune-panel weights', () => {
  it('round-trips the six criteria weights through the kit keys', () => {
    expect(weightsFromKit(kitWeights(WEIGHTS))).toEqual(WEIGHTS);
  });
});
