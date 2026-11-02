import Anthropic from '@anthropic-ai/sdk';
import type { ZodType } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  type LlmClient,
  LlmError,
  type LlmResult,
  type RawCompletion,
  type StructuredRequest,
  validateWithRetry,
} from './types.js';

/**
 * Anthropic implementation of `LlmClient` (ARCHITECTURE § LLM layer). It uses
 * tool-use with a JSON schema derived from the caller's Zod schema, then lets
 * `validateWithRetry` re-validate the tool input with Zod (invariant 5) and
 * retry once on failure. The API key is read from `ANTHROPIC_API_KEY` and is
 * never logged.
 *
 * Models that still accept it (including the scoring default, Haiku 5.5) get a
 * forced `tool_choice`. Sonnet 5.5, Opus 5.5, Fable 5.1, and Mythos 5.1 reject
 * `tool` and `any` with a 400, so those get `auto` plus an instruction to call
 * the tool. Sonnet 5.5 also thinks before answering unless asked not to, and
 * those tokens come out of `max_tokens`; `between_tools` skips that preamble so
 * prep's small budgets still fit the JSON. A text JSON reply is accepted too,
 * because `auto` does not guarantee a tool call.
 */

const TOOL_NAME = 'emit_result';

/** Current models that return 400 for a forced tool_choice (Oct 2026). */
const NO_FORCED_TOOL = new Set([
  'claude-sonnet-5-5',
  'claude-opus-5-5',
  'claude-fable-5-1',
  'claude-mythos-5-1',
]);

function requestShape(model: string): {
  toolChoice: Anthropic.ToolChoice;
  thinking?: Anthropic.ThinkingConfigParam;
  instructTool: boolean;
} {
  if (!NO_FORCED_TOOL.has(model)) {
    return { toolChoice: { type: 'tool', name: TOOL_NAME }, instructTool: false };
  }
  return {
    toolChoice: { type: 'auto', disable_parallel_tool_use: true },
    // Documented for Sonnet 5.5 only. The others keep their own thinking default.
    thinking: model === 'claude-sonnet-5-5' ? { type: 'between_tools' } : undefined,
    instructTool: true,
  };
}

export interface AnthropicLlmOptions {
  apiKey?: string;
  /** Inject a pre-built client (tests). */
  client?: Anthropic;
}

export function createAnthropicLlm(options: AnthropicLlmOptions = {}): LlmClient {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!options.client && !apiKey) {
    throw new LlmError(
      'ANTHROPIC_API_KEY is not set. Export it, or run scout with --no-score to skip scoring.',
    );
  }
  const client = options.client ?? new Anthropic({ apiKey });

  return {
    async structured<T>(request: StructuredRequest<T>): Promise<LlmResult<T>> {
      const inputSchema = toToolInputSchema(request.schema);
      const shape = requestShape(request.model);
      return validateWithRetry(request.model, request.schema, async (hint) => {
        let user = hint ? `${request.user}\n\n${hint}` : request.user;
        if (shape.instructTool) {
          user += `\n\nCall the ${TOOL_NAME} tool with the result. Do not answer in prose.`;
        }
        const response = await client.messages.create({
          model: request.model,
          max_tokens: request.maxTokens,
          system: request.system,
          tools: [
            {
              name: TOOL_NAME,
              description: 'Return the structured result as the tool input.',
              input_schema: inputSchema,
            },
          ],
          tool_choice: shape.toolChoice,
          ...(shape.thinking ? { thinking: shape.thinking } : {}),
          messages: [{ role: 'user', content: user }],
        });
        return toRawCompletion(response);
      });
    },
  };
}

function toToolInputSchema<T>(schema: ZodType<T>): Anthropic.Tool.InputSchema {
  const json = zodToJsonSchema(schema, { $refStrategy: 'none', target: 'jsonSchema7' }) as Record<
    string,
    unknown
  >;
  // Anthropic's input_schema must be a bare JSON Schema object; drop the $schema meta key.
  const { $schema, ...rest } = json;
  void $schema;
  if (rest.type !== 'object') {
    throw new LlmError('structured() requires a Zod object schema for tool-use');
  }
  return rest as Anthropic.Tool.InputSchema;
}

function toRawCompletion(response: Anthropic.Message): RawCompletion {
  const toolUse = response.content.find(
    (block) => block.type === 'tool_use' && block.name === TOOL_NAME,
  );
  let raw: unknown;
  if (toolUse && toolUse.type === 'tool_use') {
    raw = toolUse.input;
  } else {
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim();
    raw = text.length > 0 ? text : undefined;
  }
  return {
    raw,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };
}
