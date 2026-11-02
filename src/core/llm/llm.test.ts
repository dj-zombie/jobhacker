import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { estimateUsd, hasPrice } from './cost.js';
import { FakeLlm } from './fake.js';
import { LlmParseError } from './types.js';

const schema = z.object({ score: z.number().int() }).strict();

describe('validateWithRetry (via FakeLlm)', () => {
  it('parses a bare object', async () => {
    const llm = new FakeLlm({ responder: () => ({ score: 7 }) });
    const result = await llm.structured({
      model: 'claude-haiku-5-5',
      system: 's',
      user: 'u',
      schema,
      maxTokens: 64,
    });
    expect(result.value.score).toBe(7);
    expect(result.usage.calls).toBe(1);
  });

  it('parses a JSON string response', async () => {
    const llm = new FakeLlm({ responder: () => '{"score": 9}' });
    const result = await llm.structured({
      model: 'm',
      system: 's',
      user: 'u',
      schema,
      maxTokens: 64,
    });
    expect(result.value.score).toBe(9);
  });

  it('parses a fenced ```json code block', async () => {
    const llm = new FakeLlm({ responder: () => '```json\n{"score": 11}\n```' });
    const result = await llm.structured({
      model: 'm',
      system: 's',
      user: 'u',
      schema,
      maxTokens: 64,
    });
    expect(result.value.score).toBe(11);
  });

  it('sums usage across a successful retry', async () => {
    const llm = new FakeLlm({
      responder: (_req, attempt) => (attempt === 1 ? { nope: true } : { score: 3 }),
      inputTokens: 5,
      outputTokens: 2,
    });
    const result = await llm.structured({
      model: 'm',
      system: 's',
      user: 'u',
      schema,
      maxTokens: 64,
    });
    expect(result.usage.calls).toBe(2);
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(4);
  });

  it('throws LlmParseError after one retry on persistently invalid output', async () => {
    const llm = new FakeLlm({ responder: () => ({ nope: true }) });
    await expect(
      llm.structured({ model: 'm', system: 's', user: 'u', schema, maxTokens: 64 }),
    ).rejects.toBeInstanceOf(LlmParseError);
    expect(llm.attempts).toBe(2);
  });
});

describe('cost estimation', () => {
  it('prices known model families and flags unknown ones', () => {
    expect(hasPrice('claude-haiku-5-5')).toBe(true);
    expect(hasPrice('claude-sonnet-5-5')).toBe(true);
    expect(hasPrice('some-random-model')).toBe(false);

    const haiku = estimateUsd({
      model: 'claude-haiku-5-5',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      calls: 1,
    });
    expect(haiku).toBeGreaterThan(0);

    const unknown = estimateUsd({
      model: 'mystery',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      calls: 1,
    });
    expect(unknown).toBe(0);
  });
});
