import { eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Criteria, IndustryConfig } from '../config/schemas.js';
import type { Db } from '../db/client.js';
import { eventsRepo } from '../db/repo/events.js';
import { companies, companyIndustry, jobs } from '../db/schema.js';
import type { IndustryStatus } from '../db/schema.js';
import { estimateUsd } from '../llm/cost.js';
import {
  INDUSTRY_PROMPT_VERSION,
  INDUSTRY_SYSTEM,
  type IndustryOutput,
  industryOutputSchema,
  industryTitles,
  industryUserPrompt,
} from '../llm/prompts/industry.js';
import { type LlmClient, LlmParseError } from '../llm/types.js';
import type { Clock } from '../util/clock.js';
import { sha256 } from '../util/hash.js';
import type { Logger } from '../util/logger.js';

/**
 * Company industries (J26). A view filter, like Where: nothing here gates or
 * drops a job. The model sees a company's name and the titles of its open
 * roles. Kris's confirm or clear is stored on the company and never overwritten.
 */

export {
  INDUSTRY_ALIAS_MARK,
  inIndustry,
  industryAliasSet,
  industryMatchValue,
  paletteScore,
} from './industry-match.js';

export interface IndustryRunStats {
  /** Suggestions and nones stored this run. */
  classified: number;
  /** Of those, how many were none. */
  none: number;
  /** Suggested companies this run, by industry id. */
  byIndustry: Record<string, number>;
  /** Suggested rows whose name and titles have not changed. */
  unchanged: number;
  /** Confirmed or cleared companies, skipped. */
  decided: number;
  /** Companies that still need a call after this run's cap. */
  waiting: number;
  errors: number;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  estimated_usd: number;
}

export interface IndustryDeps {
  db: Db;
  llm: LlmClient;
  clock: Clock;
  log: Logger;
  criteria: Criteria;
  preferences: string;
  /** Lowers the per-run cap (never raises it above criteria). `0` makes no call. */
  limit?: number;
}

interface CompanyInput {
  companyId: number;
  name: string;
  titles: string[];
  hash: string;
}

const MAX_OUTPUT_TOKENS = 400;

/** The industries configured, in file order. Empty when the file has none. */
export function industriesOf(criteria: Criteria): IndustryConfig[] {
  return criteria.industries ?? [];
}

export function industryInputHash(name: string, titles: readonly string[]): string {
  return sha256(`${INDUSTRY_PROMPT_VERSION}\n${name.trim()}\n${industryTitles(titles).join('\n')}`);
}

export interface IndustryCount {
  id: string;
  label: string;
  aliases: string[];
  /** Companies suggested or confirmed as this industry that have an open job. */
  companies: number;
  /** Open, gate-passed, non-duplicate jobs at those companies. */
  jobs: number;
}

/** One count per configured industry, including zeroes, for ⌘K. */
export function industryCounts(db: Db, industries: readonly IndustryConfig[]): IndustryCount[] {
  if (industries.length === 0) return [];
  const rows = db.all<{ industry_id: string; companies: number; jobs: number }>(sql`
    select ci.industry_id as industry_id,
           count(distinct ci.company_id) as companies,
           count(j.id) as jobs
    from company_industry ci
    join jobs j on j.company_id = ci.company_id
    where ci.status in ('suggested', 'confirmed')
      and j.closed_at is null
      and j.duplicate_of is null
      and json_extract(j.gate_result, '$.passed') = 1
    group by ci.industry_id
  `);
  const byId = new Map(rows.map((row) => [row.industry_id, row]));
  return industries.map((industry) => {
    const row = byId.get(industry.id);
    return {
      id: industry.id,
      label: industry.label,
      aliases: [...industry.aliases],
      companies: row?.companies ?? 0,
      jobs: row?.jobs ?? 0,
    };
  });
}

/**
 * Store Kris's decision. `industryId` null clears it. Returns false when the
 * company does not exist. A later classification pass skips this company.
 */
export function decideIndustry(
  db: Db,
  clock: Clock,
  companyId: number,
  industryId: string | null,
): boolean {
  const company = db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.id, companyId))
    .get();
  if (!company) return false;
  const existing = db
    .select()
    .from(companyIndustry)
    .where(eq(companyIndustry.companyId, companyId))
    .get();
  const keepReason =
    industryId !== null &&
    existing?.industryId === industryId &&
    existing.status !== 'cleared' &&
    existing.reason.length > 0;
  writeIndustry(db, clock, {
    companyId,
    industryId,
    status: industryId === null ? 'cleared' : 'confirmed',
    reason: keepReason ? existing.reason : industryId === null ? 'Cleared by you.' : 'Set by you.',
    inputHash: existing?.inputHash ?? '',
  });
  return true;
}

export async function classifyIndustries(deps: IndustryDeps): Promise<IndustryRunStats> {
  const industries = industriesOf(deps.criteria);
  const stats: IndustryRunStats = {
    classified: 0,
    none: 0,
    byIndustry: Object.fromEntries(industries.map((industry) => [industry.id, 0])),
    unchanged: 0,
    decided: 0,
    waiting: 0,
    errors: 0,
    calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    estimated_usd: 0,
  };
  if (industries.length === 0) return stats;

  const cap = runCap(deps);
  const { queue, unchanged, decided } = classificationQueue(deps.db);
  stats.unchanged = unchanged;
  stats.decided = decided;
  const due = queue.slice(0, cap);
  stats.waiting = queue.length - due.length;

  const ids = industries.map((industry) => industry.id);
  const schema = industryOutputSchema(ids);
  const events = eventsRepo(deps.db, deps.clock);
  const model = deps.criteria.llm.scoring_model;

  for (const company of due) {
    try {
      const result = await deps.llm.structured<IndustryOutput>({
        model,
        system: INDUSTRY_SYSTEM,
        user: industryUserPrompt({
          industries,
          preferences: deps.preferences,
          company: company.name,
          titles: company.titles,
        }),
        schema,
        maxTokens: MAX_OUTPUT_TOKENS,
        promptName: 'industry',
      });
      recordUsage(stats, events, model, company.companyId, result.usage, false);
      const industryId = result.value.industry_id;
      writeIndustry(deps.db, deps.clock, {
        companyId: company.companyId,
        industryId,
        status: 'suggested',
        reason: result.value.reason,
        inputHash: company.hash,
      });
      stats.classified += 1;
      if (industryId === null) stats.none += 1;
      else stats.byIndustry[industryId] = (stats.byIndustry[industryId] ?? 0) + 1;
    } catch (err) {
      stats.errors += 1;
      if (err instanceof LlmParseError && err.usage) {
        recordUsage(stats, events, model, company.companyId, err.usage, true);
      }
      const message = err instanceof Error ? err.message : String(err);
      deps.log.error(
        { companyId: company.companyId, err: message },
        'industry classification failed',
      );
    }
  }
  return stats;
}

function runCap(deps: IndustryDeps): number {
  const configCap = deps.criteria.budget.max_new_scores_per_run;
  if (deps.limit == null) return configCap;
  return Math.min(configCap, Math.max(0, deps.limit));
}

function classificationQueue(db: Db): {
  queue: CompanyInput[];
  unchanged: number;
  decided: number;
} {
  const stored = db.select().from(companyIndustry).all();
  const byCompany = new Map(stored.map((row) => [row.companyId, row]));
  const titlesByCompany = new Map<number, string[]>();
  const titleRows = db
    .select({ companyId: jobs.companyId, title: jobs.title })
    .from(jobs)
    .where(isNull(jobs.closedAt))
    .all();
  for (const row of titleRows) {
    const list = titlesByCompany.get(row.companyId);
    if (list) list.push(row.title);
    else titlesByCompany.set(row.companyId, [row.title]);
  }
  if (titlesByCompany.size === 0) return { queue: [], unchanged: 0, decided: 0 };
  const companyRows = db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(inArray(companies.id, [...titlesByCompany.keys()]))
    .all();

  const queue: CompanyInput[] = [];
  let unchanged = 0;
  let decided = 0;
  for (const company of companyRows) {
    const titles = industryTitles(titlesByCompany.get(company.id) ?? []);
    if (titles.length === 0) continue;
    const existing = byCompany.get(company.id);
    if (existing?.status === 'confirmed' || existing?.status === 'cleared') {
      decided += 1;
      continue;
    }
    const hash = industryInputHash(company.name, titles);
    if (existing?.status === 'suggested' && existing.inputHash === hash) {
      unchanged += 1;
      continue;
    }
    queue.push({ companyId: company.id, name: company.name, titles, hash });
  }
  queue.sort((a, b) => a.companyId - b.companyId);
  return { queue, unchanged, decided };
}

function writeIndustry(
  db: Db,
  clock: Clock,
  row: {
    companyId: number;
    industryId: string | null;
    status: IndustryStatus;
    reason: string;
    inputHash: string;
  },
): void {
  const values = {
    companyId: row.companyId,
    industryId: row.industryId,
    status: row.status,
    reason: row.reason,
    inputHash: row.inputHash,
    updatedAt: clock.now(),
  };
  const existing = db
    .select({ companyId: companyIndustry.companyId })
    .from(companyIndustry)
    .where(eq(companyIndustry.companyId, row.companyId))
    .get();
  if (!existing) {
    db.insert(companyIndustry).values(values).run();
    return;
  }
  db.update(companyIndustry).set(values).where(eq(companyIndustry.companyId, row.companyId)).run();
}

function recordUsage(
  stats: IndustryRunStats,
  events: ReturnType<typeof eventsRepo>,
  model: string,
  companyId: number,
  usage: { inputTokens: number; outputTokens: number; calls: number },
  failed: boolean,
): void {
  stats.input_tokens += usage.inputTokens;
  stats.output_tokens += usage.outputTokens;
  stats.calls += usage.calls;
  stats.estimated_usd += estimateUsd({ model, ...usage });
  events.append({
    type: 'llm_usage',
    payload: {
      model,
      prompt: 'industry',
      company_id: companyId,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      calls: usage.calls,
      ...(failed ? { failed: true } : {}),
    },
  });
}
