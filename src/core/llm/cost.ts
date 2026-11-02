import type { LlmUsage } from './types.js';

/**
 * Approximate list prices in USD per 1,000,000 tokens, for a rough run-cost
 * estimate only. These are
 * not billing figures; update them if Anthropic's pricing changes. A model with
 * no entry is matched by a longest-prefix key, then falls back to zero.
 */
const PRICES_PER_MTOK: ReadonlyArray<readonly [prefix: string, input: number, output: number]> = [
  ['claude-haiku', 1, 5],
  ['claude-3-5-haiku', 0.8, 4],
  ['claude-sonnet', 3, 15],
  ['claude-3-5-sonnet', 3, 15],
  ['claude-3-7-sonnet', 3, 15],
  ['claude-opus', 15, 75],
];

function priceFor(model: string): { input: number; output: number } {
  const lower = model.toLowerCase();
  let best: { input: number; output: number } | null = null;
  let bestLen = -1;
  for (const [prefix, input, output] of PRICES_PER_MTOK) {
    if (lower.startsWith(prefix) && prefix.length > bestLen) {
      best = { input, output };
      bestLen = prefix.length;
    }
  }
  return best ?? { input: 0, output: 0 };
}

/** Estimated USD cost of a single usage record. Returns 0 for unknown models. */
export function estimateUsd(usage: LlmUsage): number {
  const price = priceFor(usage.model);
  return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
}

/** Whether we have a price for this model (used to warn when a cost is a guess). */
export function hasPrice(model: string): boolean {
  const lower = model.toLowerCase();
  return PRICES_PER_MTOK.some(([prefix]) => lower.startsWith(prefix));
}
