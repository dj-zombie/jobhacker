import {
  type LlmClient,
  type LlmResult,
  type RawCompletion,
  type StructuredRequest,
  validateWithRetry,
} from './types.js';

/**
 * Deterministic `LlmClient` for tests (ARCHITECTURE § LLM layer). It makes no
 * network calls. A responder produces the raw model output per attempt, so a
 * test can return invalid JSON to exercise the retry-then-error path, or a
 * different value on the second attempt to exercise a successful retry.
 */

/** Raw output for one attempt: either a bare value (default tokens) or a full record. */
export type FakeRaw = unknown | RawCompletion;

export type FakeResponder = (
  request: StructuredRequest<unknown>,
  attempt: number,
) => FakeRaw | Promise<FakeRaw>;

export interface FakeLlmOptions {
  /** Dynamic responder (takes precedence). Receives the request and 1-based attempt. */
  responder?: FakeResponder;
  /** Static raw responses keyed by `promptName`, used when no responder is given. */
  responses?: Record<string, unknown>;
  inputTokens?: number;
  outputTokens?: number;
}

function isRawCompletion(value: FakeRaw): value is RawCompletion {
  return (
    typeof value === 'object' &&
    value !== null &&
    'raw' in value &&
    'inputTokens' in value &&
    'outputTokens' in value
  );
}

export class FakeLlm implements LlmClient {
  /** Every `structured` request, in order. */
  readonly requests: StructuredRequest<unknown>[] = [];
  /** Total model round-trips, counting retries. */
  attempts = 0;

  private readonly responder: FakeResponder;
  private readonly inputTokens: number;
  private readonly outputTokens: number;

  constructor(options: FakeLlmOptions = {}) {
    this.inputTokens = options.inputTokens ?? 10;
    this.outputTokens = options.outputTokens ?? 20;
    if (options.responder) {
      this.responder = options.responder;
    } else {
      const responses = options.responses ?? {};
      this.responder = (request) => {
        const name = request.promptName ?? '';
        if (!(name in responses)) {
          throw new Error(`FakeLlm has no canned response for prompt "${name}"`);
        }
        return responses[name];
      };
    }
  }

  /** Number of `structured` calls (distinct from `attempts`, which counts retries). */
  get callCount(): number {
    return this.requests.length;
  }

  async structured<T>(request: StructuredRequest<T>): Promise<LlmResult<T>> {
    this.requests.push(request as StructuredRequest<unknown>);
    let attempt = 0;
    return validateWithRetry(request.model, request.schema, async (hint) => {
      attempt += 1;
      this.attempts += 1;
      const produced = await this.responder(request as StructuredRequest<unknown>, attempt);
      void hint;
      if (isRawCompletion(produced)) return produced;
      return { raw: produced, inputTokens: this.inputTokens, outputTokens: this.outputTokens };
    });
  }
}
