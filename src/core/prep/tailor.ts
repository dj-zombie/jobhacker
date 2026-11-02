import type { Profile } from '../config/schemas.js';
import { TAILOR_SYSTEM, tailorOutputSchema, tailorUserPrompt } from '../llm/prompts/tailor.js';
import type { LlmClient, LlmUsage } from '../llm/types.js';
import {
  type GroundingContext,
  type TailoredBullet,
  buildGroundingContext,
  checkBullet,
  sourceBullets,
} from './grounding.js';

/**
 * Resume tailoring (FR-7, ARCHITECTURE § Flows "Prep" steps 1-3). Ask the model
 * to select and rephrase profile bullets, ground every one (invariant 3), retry
 * once with the violations fed back, then fall back to the original bullet text
 * for any bullet that still fails. The grounding gate — not the model — is what
 * guarantees nothing invented reaches the resume.
 */

/** One tailored bullet in the final result. */
export interface TailoredResultBullet {
  sourceId: string;
  text: string;
  /** False when grounding failed twice and we fell back to the source text. */
  grounded: boolean;
  /** The violations from the final attempt (empty when grounded). */
  violations: string[];
}

export interface TailorResult {
  bullets: TailoredResultBullet[];
  usage: LlmUsage;
  /** True when a second (retry) model call was made. */
  retried: boolean;
  /** How many bullets fell back to their original source text. */
  fellBack: number;
}

export interface TailorDeps {
  llm: LlmClient;
  model: string;
  profile: Profile;
  /** The job summary + description, already truncated by the caller. */
  jobText: string;
}

const MAX_OUTPUT_TOKENS = 1500;

export async function tailorBullets(deps: TailorDeps): Promise<TailorResult> {
  const ctx = buildGroundingContext(deps.profile);
  const sources = sourceBullets(deps.profile);
  const bulletsForPrompt = sources.map((b) => ({ id: b.id, text: b.text }));

  let inputTokens = 0;
  let outputTokens = 0;
  let calls = 0;

  const first = await deps.llm.structured({
    model: deps.model,
    system: TAILOR_SYSTEM,
    user: tailorUserPrompt({
      job: deps.jobText,
      summary: deps.profile.summary,
      bullets: bulletsForPrompt,
    }),
    schema: tailorOutputSchema,
    maxTokens: MAX_OUTPUT_TOKENS,
    promptName: 'tailor',
  });
  inputTokens += first.usage.inputTokens;
  outputTokens += first.usage.outputTokens;
  calls += first.usage.calls;

  let candidate: TailoredBullet[] = first.value.bullets;
  let graded = grade(candidate, ctx);
  let retried = false;

  if (graded.some((g) => g.violations.length > 0)) {
    retried = true;
    const violations = graded.flatMap((g) => g.violations);
    const second = await deps.llm.structured({
      model: deps.model,
      system: TAILOR_SYSTEM,
      user: tailorUserPrompt({
        job: deps.jobText,
        summary: deps.profile.summary,
        bullets: bulletsForPrompt,
        violations,
      }),
      schema: tailorOutputSchema,
      maxTokens: MAX_OUTPUT_TOKENS,
      promptName: 'tailor',
    });
    inputTokens += second.usage.inputTokens;
    outputTokens += second.usage.outputTokens;
    calls += second.usage.calls;
    candidate = second.value.bullets;
    graded = grade(candidate, ctx);
  }

  const bullets: TailoredResultBullet[] = [];
  for (const g of graded) {
    if (g.violations.length === 0) {
      bullets.push({
        sourceId: g.bullet.source_id,
        text: g.bullet.text,
        grounded: true,
        violations: [],
      });
      continue;
    }
    const original = ctx.bulletsById.get(g.bullet.source_id);
    if (original !== undefined) {
      // Fall back to the exact source text, which grounds by definition.
      bullets.push({
        sourceId: g.bullet.source_id,
        text: original,
        grounded: false,
        violations: g.violations,
      });
    }
    // An unknown source_id has nothing to fall back to, so it is dropped.
  }

  // If the model produced nothing usable, fall back to the source bullets so the
  // resume is never empty. These are grounded by definition.
  if (bullets.length === 0) {
    for (const b of sources) {
      bullets.push({ sourceId: b.id, text: b.text, grounded: false, violations: [] });
    }
  }

  const fellBack = bullets.filter((b) => !b.grounded).length;
  return {
    bullets,
    usage: { model: deps.model, inputTokens, outputTokens, calls },
    retried,
    fellBack,
  };
}

function grade(
  bullets: TailoredBullet[],
  ctx: GroundingContext,
): Array<{ bullet: TailoredBullet; violations: string[] }> {
  return bullets.map((bullet) => ({ bullet, violations: checkBullet(bullet, ctx) }));
}
