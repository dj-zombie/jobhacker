import type { Profile } from '../config/schemas.js';
import { tokenize } from '../util/text.js';

/**
 * Grounding checks for tailored resume bullets (AGENTS invariant 3, ARCHITECTURE
 * § Flows "Prep" step 2). These functions are pure so they are table-tested with
 * deliberately bad outputs. A tailored bullet is rejected when any of these hold:
 *
 *  - its `source_id` is not a real profile bullet id;
 *  - it contains a number or percentage that does not appear in the source bullet
 *    (an invented metric);
 *  - it contains a technology or proper noun that is not in the source bullet or
 *    in the profile's skills allowlist.
 *
 * Ordinary lowercase rephrasing words pass: only standalone numbers and
 * capitalised/acronym/tech-punctuated terms are checked, so "Developed a React
 * design system" is fine while "Rebuilt it in Vue" is not.
 */

/** A source bullet from the profile: the single source of truth for a claim. */
export interface SourceBullet {
  id: string;
  text: string;
}

/** One tailored bullet returned by the LLM: a rephrase tied to a source id. */
export interface TailoredBullet {
  source_id: string;
  text: string;
}

/** Everything grounding needs: the source bullets and the skills allowlist. */
export interface GroundingContext {
  /** Source bullet text keyed by its profile id. */
  bulletsById: ReadonlyMap<string, string>;
  /** Lowercased technology tokens from `profile.skills` (the allowlist). */
  skillTokens: ReadonlySet<string>;
}

/** Build the grounding context from a profile: every bullet id plus skills. */
export function buildGroundingContext(profile: Profile): GroundingContext {
  const bulletsById = new Map<string, string>();
  for (const exp of profile.experience) {
    for (const b of exp.bullets) bulletsById.set(b.id, b.text);
  }
  for (const proj of profile.projects) {
    for (const b of proj.bullets) bulletsById.set(b.id, b.text);
  }
  const skillTokens = new Set<string>();
  for (const items of Object.values(profile.skills)) {
    for (const item of items) {
      for (const tok of tokenize(item)) skillTokens.add(tok);
    }
  }
  return { bulletsById, skillTokens };
}

/** All source bullets, in profile order, so a caller can list ids or fall back. */
export function sourceBullets(profile: Profile): SourceBullet[] {
  const out: SourceBullet[] = [];
  for (const exp of profile.experience) {
    for (const b of exp.bullets) out.push({ id: b.id, text: b.text });
  }
  for (const proj of profile.projects) {
    for (const b of proj.bullets) out.push({ id: b.id, text: b.text });
  }
  return out;
}

/**
 * Check one tailored bullet against the grounding context. Returns a list of
 * human-readable violations; an empty list means the bullet is grounded.
 */
export function checkBullet(bullet: TailoredBullet, ctx: GroundingContext): string[] {
  const violations: string[] = [];
  const source = ctx.bulletsById.get(bullet.source_id);
  if (source === undefined) {
    // Without a known source we cannot ground anything else about this bullet.
    return [`unknown source_id "${bullet.source_id}"`];
  }

  const sourceNumbers = numberTokens(source);
  for (const n of numberTokens(bullet.text)) {
    if (!sourceNumbers.has(n)) {
      violations.push(`number "${n}" does not appear in source bullet "${bullet.source_id}"`);
    }
  }

  const allowed = new Set<string>(ctx.skillTokens);
  for (const tok of tokenize(source)) allowed.add(tok);
  for (const term of properNounCandidates(bullet.text)) {
    if (!allowed.has(term.toLowerCase())) {
      violations.push(
        `"${term}" is not in source bullet "${bullet.source_id}" or the profile skills`,
      );
    }
  }

  return violations;
}

/**
 * Standalone numbers in `text`, normalised (commas stripped). A digit sequence
 * glued to letters (e.g. the "3" in "S3", or "2" in "v2") is not a number claim
 * and is ignored, so only real metrics like "30%" or "20+" are checked. Shared
 * with the cover-note numeric grounding.
 */
export function standaloneNumbers(text: string): Set<string> {
  const out = new Set<string>();
  const re = /(?<![A-Za-z0-9])\d[\d,]*(?:\.\d+)?(?![A-Za-z0-9])/g;
  for (const match of text.matchAll(re)) {
    out.add(match[0].replace(/,/g, ''));
  }
  return out;
}

function numberTokens(text: string): Set<string> {
  return standaloneNumbers(text);
}

/**
 * Terms in `text` that look like a technology or proper noun and therefore must
 * be grounded: acronyms (AWS, SQL), internal-caps names (JavaScript, GraphQL),
 * tech-punctuated tokens (C++, Node.js), and capitalised words that are not at
 * the start of a sentence (React, Docker). Sentence-initial ordinary words like
 * "Developed" are not flagged. Shared with the form-answer grounding.
 */
export function properNounCandidates(text: string): string[] {
  const out: string[] = [];
  const re = /[A-Za-z][A-Za-z0-9+#.]*/g;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
  while ((match = re.exec(text)) !== null) {
    const token = match[0].replace(/\.+$/, ''); // drop a trailing sentence period
    if (token.length < 2) continue;
    if (isSignificantTerm(token, isSentenceStart(text, match.index))) out.push(token);
  }
  return out;
}

function isSentenceStart(text: string, index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') continue;
    return ch === '.' || ch === '!' || ch === '?' || ch === ':' || ch === ';';
  }
  return true; // reached the start of the string
}

function isSignificantTerm(token: string, atSentenceStart: boolean): boolean {
  const hasTechPunct = /[+#.]/.test(token);
  const isAcronym = /^[A-Z0-9]+$/.test(token) && /[A-Z]/.test(token);
  const hasInternalCaps = /[a-z]/.test(token) && /[A-Z]/.test(token.slice(1));
  const leadingCapProperNoun = /^[A-Z][a-z]/.test(token) && !atSentenceStart;
  return hasTechPunct || isAcronym || hasInternalCaps || leadingCapProperNoun;
}
