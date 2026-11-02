import type { ZodType } from 'zod';

/**
 * The LLM boundary (ARCHITECTURE § LLM layer). Every response is validated with
 * a Zod schema (invariant 5). On a parse failure the call is retried once with
 * the validation errors fed back, and then it throws `LlmParseError`.
 *
 * `structured` returns the validated value together with token usage so the
 * caller can log a `llm_usage` event and total a run's cost. (Round 2 widened
 * the interface from the original `Promise<T>`; see DECISIONS D15.)
 */

export interface LlmUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** How many model round-trips this call cost, including any retry. */
  calls: number;
}

export interface LlmResult<T> {
  value: T;
  usage: LlmUsage;
}

export interface StructuredRequest<T> {
  model: string;
  system: string;
  user: string;
  schema: ZodType<T>;
  maxTokens: number;
  /** A short name for the prompt, used by `FakeLlm` and in logs. */
  promptName?: string;
}

export interface LlmClient {
  structured<T>(request: StructuredRequest<T>): Promise<LlmResult<T>>;
}

export class LlmError extends Error {
  override readonly name: string = 'LlmError';
}

export class LlmParseError extends LlmError {
  override readonly name = 'LlmParseError';
  constructor(
    message: string,
    readonly issues: string[],
    /** Token usage spent on the failed attempt(s), so the caller can still log it. */
    readonly usage?: LlmUsage,
  ) {
    super(message);
  }
}

/** One raw model round-trip: the text/JSON it returned plus its token usage. */
export interface RawCompletion {
  raw: unknown;
  inputTokens: number;
  outputTokens: number;
}

/** Turn a model response into an object: parse JSON strings, pass objects through. */
function coerce(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  // Models sometimes wrap JSON in ```json fences; strip a leading/trailing fence.
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    return raw;
  }
}

/**
 * Shared "produce raw → validate → retry once → throw" wrapper used by both the
 * Anthropic client and `FakeLlm`, so the retry/validation contract (invariant 5)
 * is identical in tests and in production. `attempt(hint)` performs one model
 * round-trip; on the retry, `hint` lists the previous validation errors.
 */
export async function validateWithRetry<T>(
  model: string,
  schema: ZodType<T>,
  attempt: (hint: string | null) => Promise<RawCompletion>,
): Promise<LlmResult<T>> {
  let inputTokens = 0;
  let outputTokens = 0;

  const first = await attempt(null);
  inputTokens += first.inputTokens;
  outputTokens += first.outputTokens;
  const firstParse = schema.safeParse(coerce(first.raw));
  if (firstParse.success) {
    return { value: firstParse.data, usage: { model, inputTokens, outputTokens, calls: 1 } };
  }

  const issues = firstParse.error.issues.map(
    (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
  );
  const hint = `Your previous response failed validation:\n${issues
    .map((i) => `- ${i}`)
    .join('\n')}\nReturn only valid JSON matching the required schema.`;

  const second = await attempt(hint);
  inputTokens += second.inputTokens;
  outputTokens += second.outputTokens;
  const secondParse = schema.safeParse(coerce(second.raw));
  if (secondParse.success) {
    return { value: secondParse.data, usage: { model, inputTokens, outputTokens, calls: 2 } };
  }

  const retryIssues = secondParse.error.issues.map(
    (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
  );
  throw new LlmParseError(
    `LLM output failed validation after one retry: ${retryIssues.join('; ')}`,
    retryIssues,
    { model, inputTokens, outputTokens, calls: 2 },
  );
}
