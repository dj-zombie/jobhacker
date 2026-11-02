import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { ConfigError } from './errors.js';
import {
  type Bands,
  type Criteria,
  PREFERENCES_FILE,
  type Weights,
  criteriaSchema,
} from './schemas.js';

/**
 * `config:migrate` (PHASE2 Round P2-1). Converts a v1 keyword-list
 * `criteria.yaml` into the v2 shape (gates, weights, bands, budget, models) and
 * drafts `preferences.md` from the keyword lists so nothing the user already
 * wrote is lost. The draft is deterministic text, not an LLM rewrite; the user
 * then edits it as prose. The v1 file is kept as `criteria.v1.yaml`.
 */

/** The v1 `criteria.yaml` shape (superseded; PRD FR-4 note). Only `config:migrate` reads it. */
export const legacyCriteriaSchema = z
  .object({
    titles: z.object({
      include: z.array(z.string().min(1)).default([]),
      exclude: z.array(z.string().min(1)).default([]),
    }),
    locations: z
      .object({
        remote_countries: z.array(z.string().min(1)).default([]),
        metros: z.array(z.string().min(1)).default([]),
        allow_onsite: z.boolean().default(false),
      })
      .default({}),
    employment_types: z.array(z.string().min(1)).default([]),
    max_age_days: z.number().int().nonnegative(),
    compensation: z
      .object({
        currency: z.string().min(1).default('USD'),
        min_annual: z.number().nonnegative().default(0),
        min_hourly: z.number().nonnegative().default(0),
      })
      .default({}),
    company_blocklist: z.array(z.string().min(1)).default([]),
    interests: z.array(z.string().min(1)).default([]),
    llm: z.object({
      scoring_model: z.string().min(1),
      writing_model: z.string().min(1),
      max_new_scores_per_run: z.number().int().positive(),
    }),
  })
  .passthrough();

export type LegacyCriteria = z.infer<typeof legacyCriteriaSchema>;

/** True when a parsed `criteria.yaml` is the v1 keyword-list format. */
export function isLegacyCriteria(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  return 'titles' in raw || 'locations' in raw || 'interests' in raw;
}

export const DEFAULT_WEIGHTS: Weights = {
  role_fit: 3,
  tech_fit: 2,
  domain_interest: 2,
  seniority_fit: 2,
  logistics_fit: 4,
  comp_fit: 1,
};

export const DEFAULT_BANDS: Bands = { strong: 75, maybe: 55 };

export const DEFAULT_PRESCORE_FLOOR = 0;

/** Map v1 onto v2. Mass-rejecting age/prescore cutoffs deliberately reset to off. */
export function migrateLegacyCriteria(legacy: LegacyCriteria): Criteria {
  return criteriaSchema.parse({
    gates: {
      max_age_days: 0,
      company_blocklist: legacy.company_blocklist,
    },
    weights: DEFAULT_WEIGHTS,
    bands: DEFAULT_BANDS,
    budget: {
      prescore_floor: DEFAULT_PRESCORE_FLOOR,
      max_new_scores_per_run: legacy.llm.max_new_scores_per_run,
    },
    llm: {
      scoring_model: legacy.llm.scoring_model,
      writing_model: legacy.llm.writing_model,
    },
  });
}

function list(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const EMPLOYMENT_LABELS: Record<string, string> = {
  full_time: 'full-time',
  part_time: 'part-time',
  contract: 'contract',
  internship: 'internship',
  temporary: 'temporary',
};

/**
 * Draft `preferences.md` from the v1 keyword lists. Every keyword appears
 * verbatim, so the conversion loses nothing (acceptance #2). The wording is a
 * starting point for the user to rewrite, not a claim about what he wants.
 */
export function draftPreferences(legacy: LegacyCriteria, date: string): string {
  const out: string[] = [
    '# Job preferences',
    '',
    '<!--',
    `Drafted by \`pnpm cli config:migrate\` on ${date} from the keyword lists in the v1`,
    'criteria.yaml (kept as config/criteria.v1.yaml). Nothing here is matched as a literal',
    'any more. The scoring model reads this file as prose and scores each job on six',
    'dimensions: role, tech, domain interest, seniority, logistics and compensation.',
    'Rewrite it in your own words: what you want, what you would trade for it, and',
    'what is a dealbreaker. Editing this file re-scores jobs on the next scoring run.',
    '-->',
    '',
  ];

  out.push('## Roles I want', '');
  if (legacy.titles.include.length > 0) {
    out.push(
      `Roles like these (the v1 title keywords): ${list(legacy.titles.include)}.`,
      'Read these as examples of the work, not exact titles.',
    );
  } else {
    out.push('[NEEDS INPUT: the kind of roles you want]');
  }
  out.push('');

  if (legacy.titles.exclude.length > 0) {
    out.push(
      "## Roles I don't want",
      '',
      `Not interested in roles that are ${list(legacy.titles.exclude)} (the v1 excluded title keywords).`,
      '',
    );
  }

  out.push('## Where I can work', '');
  const { remote_countries: countries, metros, allow_onsite: onsite } = legacy.locations;
  if (countries.length > 0) {
    out.push(`- Remote roles open to people living in: ${list(countries)}.`);
  } else {
    out.push('- Remote: [NEEDS INPUT: which countries you can work remotely from]');
  }
  if (metros.length > 0) {
    out.push(`- Hybrid roles in or near: ${list(metros)}.`);
    out.push(
      onsite
        ? `- Fully onsite roles are fine in ${list(metros)}.`
        : '- Fully onsite roles: no, not even in those metros (v1 had allow_onsite: false).',
    );
  } else if (!onsite) {
    out.push('- Fully onsite roles: no (v1 had allow_onsite: false).');
  }
  out.push('');

  if (legacy.employment_types.length > 0) {
    const labels = legacy.employment_types.map((t) => `${EMPLOYMENT_LABELS[t] ?? t} (${t})`);
    out.push('## Employment type', '', `${list(labels)}.`, '');
  }

  out.push(
    '## Recency',
    '',
    `The old keyword-gate config used max_age_days ${legacy.max_age_days}. The Phase 2 migration turns that gate off (0); use the funnel age histogram before opting back in.`,
    '',
  );

  out.push('## Compensation', '');
  const comp = legacy.compensation;
  const floors: string[] = [];
  if (comp.min_annual > 0) floors.push(`at least ${comp.min_annual} ${comp.currency} a year`);
  if (comp.min_hourly > 0)
    floors.push(`at least ${comp.min_hourly} ${comp.currency} an hour for contract work`);
  if (floors.length > 0) {
    out.push(
      `My floor is ${list(floors)}. A posting that doesn't state pay is neither good nor bad.`,
    );
  } else {
    out.push(
      `No floor set yet (v1 had min_annual ${comp.min_annual} and min_hourly ${comp.min_hourly}, ${comp.currency}).`,
      '[NEEDS INPUT: your compensation floor, if you have one]',
    );
  }
  out.push('');

  if (legacy.interests.length > 0) {
    out.push(
      '## What I would be most excited about',
      '',
      ...legacy.interests.map((interest) => `- ${interest}`),
      '',
    );
  }

  if (legacy.company_blocklist.length > 0) {
    out.push(
      '## Companies',
      '',
      `Never show: ${list(legacy.company_blocklist)}. (This stays a hard gate in criteria.yaml.)`,
      '',
    );
  }

  return `${out.join('\n').trimEnd()}\n`;
}

/** Render a v2 `criteria.yaml` with the same comments as `criteria.example.yaml`. */
export function renderCriteriaYaml(criteria: Criteria): string {
  const blocklist =
    criteria.gates.company_blocklist.length === 0
      ? '[]'
      : `\n${criteria.gates.company_blocklist.map((c) => `    - ${JSON.stringify(c)}`).join('\n')}`;
  const w = criteria.weights;
  return `# Mechanical settings only: hard gates, ranking weights, verdict bands, LLM spend
# and models. Taste (roles, places, pay, interests) lives in preferences.md as prose.

gates:                       # the ONLY hard exclusions; closed and duplicate postings are automatic
  max_age_days: ${criteria.gates.max_age_days}            # gate postings first published more than N days ago; 0 = off
  company_blocklist: ${blocklist}

weights:                     # how much each dimension counts in the ranked score (0 = ignore it)
  role_fit: ${w.role_fit}                # function/work shape only; not level or management track
  tech_fit: ${w.tech_fit}                # stack overlap with your actual experience
  domain_interest: ${w.domain_interest}         # how much the company's domain matches what preferences.md says excites you
  seniority_fit: ${w.seniority_fit}           # level and IC/management track
  logistics_fit: ${w.logistics_fit}           # remote / location / employment type vs what you can accept
  comp_fit: ${w.comp_fit}                # against your floor; unknown pay drops out (neutral)
# ranked score = sum(weight x dim) / sum(weight over known dims) x 20, so 0-100.
# A 0 in role/seniority/logistics caps at "no"; a 1 below "strong".
# Changing weights re-ranks instantly with no API calls.

bands:                       # verdict thresholds on the 0-100 ranked score
  strong: ${criteria.bands.strong}
  maybe: ${criteria.bands.maybe}

budget:
  prescore_floor: 0         # compatibility field: prescore orders but never excludes
  max_new_scores_per_run: ${criteria.budget.max_new_scores_per_run}  # scoring walks jobs in prescore order up to this many new calls

llm:
  scoring_model: ${criteria.llm.scoring_model}
  writing_model: ${criteria.llm.writing_model}
`;
}

export interface MigrateResult {
  status: 'migrated' | 'already-v2';
  criteriaFile: string;
  backupFile: string | null;
  preferencesFile: string;
  /** False when an existing preferences.md was left alone (no `--force`). */
  wrotePreferences: boolean;
  preferences: string | null;
}

/**
 * Convert `dir/criteria.yaml` in place. Writes `criteria.v1.yaml` (the original
 * text), the new `criteria.yaml`, and `preferences.md`. An existing
 * `preferences.md` is never overwritten unless `force` is set.
 */
export function runConfigMigrate(
  dir: string,
  options: { force?: boolean; date: string },
): MigrateResult {
  const criteriaFile = join(dir, 'criteria.yaml');
  const backupFile = join(dir, 'criteria.v1.yaml');
  const preferencesFile = join(dir, PREFERENCES_FILE);

  let text: string;
  try {
    text = readFileSync(criteriaFile, 'utf8');
  } catch {
    throw new ConfigError(criteriaFile, [
      'file not found. Copy config/criteria.example.yaml to config/criteria.yaml.',
    ]);
  }
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new ConfigError(criteriaFile, [
      `YAML parse error: ${err instanceof Error ? err.message : String(err)}`,
    ]);
  }
  if (!isLegacyCriteria(raw)) {
    return {
      status: 'already-v2',
      criteriaFile,
      backupFile: null,
      preferencesFile,
      wrotePreferences: false,
      preferences: null,
    };
  }
  const parsed = legacyCriteriaSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(
      criteriaFile,
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }

  const next = migrateLegacyCriteria(parsed.data);
  const preferences = draftPreferences(parsed.data, options.date);
  const keepPreferences = existsSync(preferencesFile) && !options.force;

  writeFileSync(backupFile, text);
  writeFileSync(criteriaFile, renderCriteriaYaml(next));
  if (!keepPreferences) writeFileSync(preferencesFile, preferences);

  return {
    status: 'migrated',
    criteriaFile,
    backupFile,
    preferencesFile,
    wrotePreferences: !keepPreferences,
    preferences,
  };
}
