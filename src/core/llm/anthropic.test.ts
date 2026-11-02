import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAnthropicLlm } from './anthropic.js';

/**
 * The scoring model still accepts a forced tool. Sonnet 5.5, Opus 5.5, Fable 5.1,
 * and Mythos 5.1 reject tool_choice "tool" and "any" with a 400. Prep's default
 * writing model is Sonnet 5.5, so that request must not use a forced tool.
 */

const schema = z.object({ ok: z.boolean() }).strict();

interface CapturedCreate {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{ role: string; content: string }>;
  tool_choice?: { type: string; name?: string; disable_parallel_tool_use?: boolean };
  thinking?: { type: string };
  tools?: Array<{ name: string; strict?: boolean }>;
}

function mockClient(content: unknown): {
  client: Anthropic;
  calls: CapturedCreate[];
} {
  const calls: CapturedCreate[] = [];
  const client = {
    messages: {
      create: async (params: CapturedCreate) => {
        calls.push(params);
        return {
          content,
          usage: { input_tokens: 5, output_tokens: 3 },
        };
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

const toolUse = [
  {
    type: 'tool_use',
    id: 'toolu_test',
    name: 'emit_result',
    input: { ok: true },
  },
];

describe('createAnthropicLlm tool choice', () => {
  it('keeps a forced tool for the scoring model', async () => {
    const { client, calls } = mockClient(toolUse);
    const llm = createAnthropicLlm({ client });
    const result = await llm.structured({
      model: 'claude-haiku-5-5',
      system: 'score',
      user: 'the job',
      schema,
      maxTokens: 1024,
    });
    expect(result.value).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.tool_choice).toEqual({ type: 'tool', name: 'emit_result' });
    expect(calls[0]?.thinking).toBeUndefined();
    expect(calls[0]?.messages[0]?.content).toBe('the job');
  });

  it('does not force a tool on claude-sonnet-5-5, and skips up-front thinking', async () => {
    const { client, calls } = mockClient(toolUse);
    const llm = createAnthropicLlm({ client });
    await llm.structured({
      model: 'claude-sonnet-5-5',
      system: 'write',
      user: 'the job',
      schema,
      maxTokens: 600,
    });
    expect(calls[0]?.tool_choice).toEqual({
      type: 'auto',
      disable_parallel_tool_use: true,
    });
    expect(calls[0]?.tool_choice?.type).not.toBe('tool');
    expect(calls[0]?.thinking).toEqual({ type: 'between_tools' });
    expect(calls[0]?.messages[0]?.content).toContain('emit_result');
    expect(calls[0]?.messages[0]?.content.startsWith('the job')).toBe(true);
  });

  it('uses auto, and not between_tools, for the other models that reject a forced tool', async () => {
    for (const model of ['claude-opus-5-5', 'claude-fable-5-1', 'claude-mythos-5-1']) {
      const { client, calls } = mockClient(toolUse);
      const llm = createAnthropicLlm({ client });
      await llm.structured({
        model,
        system: 's',
        user: 'u',
        schema,
        maxTokens: 64,
      });
      expect(calls[0]?.tool_choice?.type).toBe('auto');
      expect(calls[0]?.thinking).toBeUndefined();
    }
  });

  it('accepts a JSON text reply when the model does not call the tool', async () => {
    const { client } = mockClient([{ type: 'text', text: '{"ok":true}' }]);
    const llm = createAnthropicLlm({ client });
    const result = await llm.structured({
      model: 'claude-sonnet-5-5',
      system: 'write',
      user: 'the job',
      schema,
      maxTokens: 600,
    });
    expect(result.value).toEqual({ ok: true });
    expect(result.usage.calls).toBe(1);
  });
});
