import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { jobs } from '../db/schema.js';

/**
 * Prescore (FR-5b). A deterministic, zero-cost lexical relevance in 0–1
 * between a job and `preferences.md`. It only orders gate-survivors for LLM
 * spend; it never judges or excludes. Title matches dominate, the description
 * breaks ties, and terms are weighted by inverse document frequency over the
 * job corpus so generic words ("team", "build") count for little.
 *
 * Preferences are prose, so a term can be wanted or unwanted. A sentence under
 * a heading like "Roles I don't want", or one with a negation cue ("no people
 * management"), contributes negative terms; a title matching those is pushed
 * down rather than up. A term that is ever used positively stays positive.
 */

export interface PrescoreDoc {
  title: string;
  /** Plain-text description. */
  text: string;
}

export interface PrescoreBreakdown {
  /** 0–1, rounded to 3 decimals. */
  score: number;
  /** Stemmed title terms that match a wanted preference term. */
  titleMatches: string[];
  /** Stemmed title terms that match an unwanted preference term. */
  titleNegatives: string[];
  /** IDF-weighted share of the wanted terms that appear in the description, 0–1. */
  bodyCoverage: number;
}

export interface PreferenceTerms {
  positive: ReadonlySet<string>;
  negative: ReadonlySet<string>;
}

const TITLE_WEIGHT = 0.7;
const BODY_WEIGHT = 0.3;
const NEGATIVE_PENALTY = 0.6;

/** Multi-word spellings folded into one token before tokenizing. */
const CANONICAL: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bfront[\s_-]?end\b/g, 'frontend'],
  [/\bback[\s_-]?end\b/g, 'backend'],
  [/\bfull[\s_-]?stack\b/g, 'fullstack'],
  [/\bfull[\s_-]?time\b/g, 'fulltime'],
  [/\bpart[\s_-]?time\b/g, 'parttime'],
  [/\bnew[\s_-]?grad(uate)?\b/g, 'newgrad'],
  [/\bmachine learning\b/g, 'ml'],
  [/\b(next|node|react|vue|three)\.js\b/g, '$1js'],
  [/\bgaming\b/g, 'game'],
];

const STOPWORDS = new Set(
  [
    'a an and are as at be been but by can could did do does for from had has have he her his',
    'i if in into is it its just me more most my of on or our out over she so some such than',
    'that the their them then there these they this those to too up us very was we were what',
    'when where which who will with would you your yet also any anything even each other only',
    'like want wanted wants work working job jobs role roles title titles kind lot vary between',
    'judge exact example examples read rewrite words file v1 keyword keywords interested interest',
    'set had allow allowed false true near via say says said per ok fine good bad neither nor',
    'thing things way people person living open posting postings state states',
  ]
    .join(' ')
    .split(' '),
);

const NEGATION =
  /\b(no|not|never|avoid|without|nor|don'?t|do not|isn'?t|aren'?t|won'?t|wouldn'?t|rather not|dealbreakers?)\b/i;
const NEGATIVE_HEADING = /\b(don'?t|do not|not|avoid|never|no|dislike|exclude|dealbreakers?)\b/i;

/** Light suffix stripping so "engineer", "engineers" and "engineering" meet. */
export function stem(word: string): string {
  let s = word;
  if (s.length > 4 && s.endsWith('ies')) s = `${s.slice(0, -3)}y`;
  else if (s.length > 3 && s.endsWith('s') && !/(ss|us|is|js)$/.test(s)) s = s.slice(0, -1);
  for (let pass = 0; pass < 2; pass++) {
    const suffix = ['ment', 'ing', 'er', 'ed', 'ly'].find(
      (suf) => s.endsWith(suf) && s.length - suf.length >= 4,
    );
    if (!suffix) break;
    s = s.slice(0, -suffix.length);
  }
  if (s.length > 4 && s.endsWith('e')) s = s.slice(0, -1);
  return s;
}

/** Lowercase, fold compounds, split, drop stopwords, stem. */
export function terms(text: string): string[] {
  let lower = text.toLowerCase();
  for (const [pattern, replacement] of CANONICAL) lower = lower.replace(pattern, replacement);
  const raw = lower.match(/[a-z0-9][a-z0-9+#]*/g) ?? [];
  const out: string[] = [];
  for (const token of raw) {
    if (token.length < 2 || STOPWORDS.has(token) || /^\d+$/.test(token)) continue;
    const stemmed = stem(token);
    if (!STOPWORDS.has(stemmed)) out.push(stemmed);
  }
  return out;
}

/** Split `preferences.md` into wanted and unwanted terms. */
export function preferenceTerms(markdown: string): PreferenceTerms {
  const text = markdown.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\[NEEDS INPUT[^\]]*\]/gi, ' ');
  const positive = new Set<string>();
  const negative = new Set<string>();
  let negativeSection = false;

  for (const line of text.split('\n')) {
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      negativeSection = NEGATIVE_HEADING.test(heading[1] ?? '');
      continue;
    }
    for (const sentence of line.split(/[.;!?]+(?:\s|$)/)) {
      const target = negativeSection || NEGATION.test(sentence) ? negative : positive;
      for (const term of terms(sentence)) target.add(term);
    }
  }
  for (const term of positive) negative.delete(term);
  return { positive, negative };
}

/**
 * Build a scorer over a fixed corpus (the gate-surviving jobs). The corpus
 * supplies document frequencies; the returned function is pure.
 */
export function buildPrescorer(
  preferences: string,
  corpus: readonly PrescoreDoc[],
): (doc: PrescoreDoc) => PrescoreBreakdown {
  const prefs = preferenceTerms(preferences);
  const df = new Map<string, number>();
  for (const doc of corpus) {
    for (const term of new Set(terms(`${doc.title}\n${doc.text}`))) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  const n = corpus.length;
  const idf = (term: string): number => Math.log((n + 1) / ((df.get(term) ?? 0) + 1)) + 1;
  const positiveMass = [...prefs.positive].reduce((sum, t) => sum + idf(t), 0);

  return (doc) => {
    const title = [...new Set(terms(doc.title))];
    const titleMass = title.reduce((sum, t) => sum + idf(t), 0);
    const titleMatches = title.filter((t) => prefs.positive.has(t));
    const titleNegatives = title.filter((t) => prefs.negative.has(t));
    const share = (list: string[]) =>
      titleMass > 0 ? list.reduce((sum, t) => sum + idf(t), 0) / titleMass : 0;

    const body = new Set(terms(doc.text));
    let covered = 0;
    for (const term of prefs.positive) if (body.has(term)) covered += idf(term);
    const bodyCoverage = positiveMass > 0 ? covered / positiveMass : 0;

    const raw =
      TITLE_WEIGHT * share(titleMatches) +
      BODY_WEIGHT * bodyCoverage -
      NEGATIVE_PENALTY * share(titleNegatives);
    return {
      score: Math.round(Math.min(1, Math.max(0, raw)) * 1000) / 1000,
      titleMatches,
      titleNegatives,
      bodyCoverage: Math.round(bodyCoverage * 1000) / 1000,
    };
  };
}

/** The open, non-duplicate jobs that passed the gates: the prescore corpus. */
export function prescoreCorpus(
  db: Db,
): Array<PrescoreDoc & { id: number; prescore: number | null }> {
  return db
    .select({
      id: jobs.id,
      title: jobs.title,
      text: jobs.descriptionText,
      prescore: jobs.prescore,
    })
    .from(jobs)
    .where(
      and(
        isNull(jobs.closedAt),
        isNull(jobs.duplicateOf),
        sql`json_extract(${jobs.gateResult}, '$.passed') = 1`,
      ),
    )
    .all();
}

/** Prescore every gate-surviving job and store it in `jobs.prescore`. Returns the count. */
export function applyPrescores(db: Db, preferences: string): number {
  const corpus = prescoreCorpus(db);
  const score = buildPrescorer(preferences, corpus);
  const tx = db.$client.transaction(() => {
    for (const doc of corpus) {
      const next = score(doc).score;
      if (doc.prescore === next) continue;
      db.update(jobs).set({ prescore: next }).where(eq(jobs.id, doc.id)).run();
    }
  });
  tx();
  return corpus.length;
}
