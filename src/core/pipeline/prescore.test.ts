import { describe, expect, it } from 'vitest';
import { type PrescoreDoc, buildPrescorer, preferenceTerms, stem, terms } from './prescore.js';

const PREFS = [
  '# Job preferences',
  '<!-- a comment mentioning manager and sales must be ignored -->',
  '## Roles I want',
  'Senior frontend or full-stack engineer roles. Developer tools and audio.',
  "## Roles I don't want",
  'Sales, recruiting.',
  '## Notes',
  'No people management.',
  '[NEEDS INPUT: your compensation floor]',
].join('\n');

const CORPUS: PrescoreDoc[] = [
  { title: 'Senior Frontend Engineer', text: 'React and TypeScript on developer tools.' },
  { title: 'Senior Full Stack Engineer', text: 'Node and React for payments.' },
  { title: 'Engineering Manager, Payments', text: 'Lead a team of engineers.' },
  { title: 'Account Executive, Sales', text: 'Close deals with enterprise customers.' },
  { title: 'Data Scientist', text: 'Models and experiments.' },
  { title: 'Audio Software Engineer', text: 'DSP and plugins for music tools.' },
];

describe('stem and terms', () => {
  it('folds plural and -ing/-er forms together', () => {
    expect(stem('engineers')).toBe(stem('engineering'));
    expect(stem('engineer')).toBe(stem('engineering'));
    expect(stem('manager')).toBe(stem('management'));
    expect(stem('tools')).toBe(stem('tool'));
  });

  it('folds hyphenated and spaced compounds and drops stopwords', () => {
    expect(terms('Front-end and full stack')).toEqual(['frontend', 'fullstack']);
    expect(terms('Senior Front End Engineer')).toEqual(terms('senior frontend engineers'));
    expect(terms('Next.js')).toEqual(['nextjs']);
  });
});

describe('preferenceTerms', () => {
  const prefs = preferenceTerms(PREFS);

  it('reads wanted terms from positive prose', () => {
    for (const word of ['senior', 'frontend', 'fullstack', 'engineer', 'audio', 'developer']) {
      expect(prefs.positive.has(stem(word))).toBe(true);
    }
  });

  it('reads unwanted terms from negative headings and negated sentences', () => {
    expect(prefs.negative.has(stem('sales'))).toBe(true);
    expect(prefs.negative.has(stem('recruiting'))).toBe(true);
    expect(prefs.negative.has(stem('management'))).toBe(true);
  });

  it('ignores HTML comments and NEEDS INPUT markers', () => {
    expect(prefs.positive.has(stem('comment'))).toBe(false);
    expect(prefs.positive.has(stem('compensation'))).toBe(false);
    expect(prefs.negative.has(stem('compensation'))).toBe(false);
  });

  it('keeps a term positive when it is used both ways', () => {
    const both = preferenceTerms("## Want\nEngineer roles.\n## Don't want\nSales engineer.");
    expect(both.positive.has(stem('engineer'))).toBe(true);
    expect(both.negative.has(stem('engineer'))).toBe(false);
    expect(both.negative.has(stem('sales'))).toBe(true);
  });
});

describe('buildPrescorer', () => {
  const score = buildPrescorer(PREFS, CORPUS);
  const byTitle = (title: string) => {
    const doc = CORPUS.find((d) => d.title === title);
    if (!doc) throw new Error(title);
    return score(doc);
  };

  it('stays within 0–1', () => {
    for (const doc of CORPUS) {
      const { score: s } = score(doc);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it('ranks wanted titles above unrelated and unwanted ones', () => {
    const frontend = byTitle('Senior Frontend Engineer').score;
    const fullstack = byTitle('Senior Full Stack Engineer').score;
    const audio = byTitle('Audio Software Engineer').score;
    const scientist = byTitle('Data Scientist').score;
    const manager = byTitle('Engineering Manager, Payments').score;
    const sales = byTitle('Account Executive, Sales').score;

    expect(frontend).toBeGreaterThan(scientist);
    expect(fullstack).toBeGreaterThan(scientist);
    expect(audio).toBeGreaterThan(scientist);
    expect(frontend).toBeGreaterThan(manager);
    expect(scientist).toBeGreaterThanOrEqual(sales);
  });

  it('explains the title matches and negatives', () => {
    const manager = byTitle('Engineering Manager, Payments');
    expect(manager.titleMatches).toContain(stem('engineering'));
    expect(manager.titleNegatives).toContain(stem('manager'));
  });

  it('lets the description break a tie between equal titles', () => {
    const corpus: PrescoreDoc[] = [
      { title: 'Engineer', text: 'audio plugins and developer tools' },
      { title: 'Engineer', text: 'payments ledger' },
    ];
    const s = buildPrescorer(PREFS, corpus);
    expect(s(corpus[0] as PrescoreDoc).score).toBeGreaterThan(s(corpus[1] as PrescoreDoc).score);
  });

  it('is deterministic', () => {
    const again = buildPrescorer(PREFS, CORPUS);
    for (const doc of CORPUS) expect(again(doc)).toEqual(score(doc));
  });
});
