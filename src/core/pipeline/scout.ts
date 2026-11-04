import { type DomainTouch, noteDomainTouch, refreshTouchedDomains } from '../brand/apply.js';
import {
  type Ats,
  type CompanyConfig,
  type Criteria,
  LEGACY_SOURCES,
  type Profile,
  REMOTE_AREA,
} from '../config/schemas.js';
import type { Db } from '../db/client.js';
import { companiesRepo } from '../db/repo/companies.js';
import { jobsRepo } from '../db/repo/jobs.js';
import { runsRepo } from '../db/repo/runs.js';
import type { LlmClient } from '../llm/types.js';
import { addCredits, callsThisMonth, chargeCall, creditsThisMonth } from '../sources/budget.js';
import { type ProbeContext, readCache, writeCache } from '../sources/discover.js';
import {
  HARVEST_PER_RUN,
  type HarvestSource,
  type HarvestStats,
  formatHarvest,
  harvestBoards,
} from '../sources/harvest.js';
import { hnAdapter } from '../sources/hn.js';
import { jobspipeAdapter } from '../sources/jobspipe.js';
import { jsearchAdapter } from '../sources/jsearch.js';
import { generateQueries, jobspipeQueries, queriesForRun } from '../sources/query-gen.js';
import { loadBoard } from '../sources/registry.js';
import { type Relocation, goneStatus, lookedLine } from '../sources/relocate.js';
import type { SearchAdapter, SearchHit, SearchQuery } from '../sources/search.js';
import { slugify } from '../sources/slug.js';
import type { CompanyRef } from '../sources/types.js';
import type { Clock } from '../util/clock.js';
import { contentHash, dedupeKey } from '../util/hash.js';
import type { Http } from '../util/http.js';
import type { Logger } from '../util/logger.js';
import { applyAreas, searchPlaces } from './areas.js';
import { assignDuplicates } from './dedupe.js';
import { type SearchPasses, closeSearchListings } from './freshness.js';
import { type GateStats, applyGates } from './gate.js';
import { applyPrescores } from './prescore.js';
import { ScoreBusyError, liveScoringRun } from './score-run.js';
import { type ScoreStats, scoreNewJobs } from './score.js';
import { type ScoutProgress, parseScoutProgress } from './scout-progress.js';
import { type UpkeepDeps, relocateBoards } from './upkeep.js';

/**
 * Scout (FR-3, ARCHITECTURE § Flows). Fetches each active board, upserts
 * postings, closes ones that disappeared, flags cross-board duplicates,
 * classifies every job's places, applies the four gates, prescores the
 * survivors, and (unless skipped) LLM-scores them.
 *
 * Gates and prescore always run. Scoring runs only when `scoring` deps are
 * supplied; the CLI omits them for `--no-score`. A board that errors, or whose
 * postings all fail to parse, is recorded in `stats.errors` and does not close
 * that company's jobs. One bad board does not abort the run. The run is not ok
 * only when every active board failed; in that case gating and scoring are skipped.
 */

export interface BoardError {
  company: string;
  ats: Ats;
  token: string;
  message: string;
}

export interface ScoutStats {
  boards: number;
  boards_ok: number;
  boards_failed: number;
  /** Companies deactivated this run because they left companies.yaml. */
  deactivated: number;
  seen: number;
  inserted: number;
  updated: number;
  closed: number;
  /** Of `closed`, how many already had status `shortlisted`. Summed across boards and search sources. */
  closed_shortlisted: number;
  duplicates: number;
  /** Jobs whose places changed this run (`job_areas`). Never a gate. */
  areas_changed: number;
  search_calls: number;
  /** Each metered search call this run: source, area and query text. */
  search_queries: string[];
  search_skipped_budget: number;
  /** JobsPipe credits this run. Empty calls means it made none. */
  jobspipe: {
    calls: { credits: number }[];
    credits_remaining: number | null;
    skipped: string[];
  };
  /** Gate pass after this run's upserts; null when gating was skipped. */
  gates: GateStats | null;
  prescored: number;
  skipped_jobs: number;
  scoring: 'skipped' | ScoreStats;
  errors: BoardError[];
  /** Domain finder (J9). No network. `domains_error` is set when it threw. */
  domains_ms: number;
  domains_written: number;
  domains_cleared: number;
  domains_error: string | null;
  /** Boards this run's search hits link to, probed and added (J15). Null when upkeep was off. */
  harvest: HarvestStats | null;
  /** Where each gone board (400, 404, 410, 422) may have moved. The card reads it. */
  relocation: Relocation[];
  /** Set when harvest or relocation threw. The scout still finished. */
  upkeep_error: string | null;
}

export interface ScoutResult {
  runId: number;
  ok: boolean;
  stats: ScoutStats;
}

export interface ScoutScoringDeps {
  llm: LlmClient;
  profile: Profile;
  /** Lowers the per-run score cap for this run (never raises it above criteria). */
  limit?: number;
}

export interface ScoutDeps {
  db: Db;
  http: Http;
  clock: Clock;
  log: Logger;
  companies: CompanyConfig[];
  criteria: Criteria;
  /** `preferences.md`, for prescoring and scoring. */
  preferences: string;
  /** Supplied to score this run; omitted to skip scoring (`--no-score`). */
  scoring?: ScoutScoringDeps;
  /** API keys for metered or per-account sources. Never logged. */
  sourceKeys?: SourceKeys;
  /**
   * A run already opened by `startScoutRun`. The CLI leaves this unset, and `runScout` opens one.
   * Either way the run's stats hold `{progress, beatAt}` after every board and every score attempt.
   */
  runId?: number;
  /**
   * Board upkeep (J15): after search ingest, harvest the boards this run's hits link to, and
   * look for where each gone board moved. The CLI and the app pass it. Omitted: no upkeep.
   */
  upkeep?: { dir: string; cachePath: string };
}

export interface SourceKeys {
  jsearch?: string;
  jobspipe?: string;
  workable?: string;
  teamtailor?: string;
}

/** The source keys from the environment, for every caller of `runScout` (CLI and app). */
export function sourceKeysFromEnv(env: Record<string, string | undefined>): SourceKeys {
  return {
    jsearch: env.JSEARCH_API_KEY,
    jobspipe: env.JOBSPIPE_API_KEY,
    workable: env.WORKABLE_API_KEY,
    teamtailor: env.TEAMTAILOR_API_KEY,
  };
}

const SKIP_LOG_LIMIT = 20;

/**
 * Open a scout run and refuse while a scout or a score batch is already live. The app returns
 * this id at once; `runScout` continues in the server process (D95, D125).
 */
export function startScoutRun(db: Db, clock: Clock): number {
  const tx = db.$client.transaction((): number => {
    const live = liveScoringRun(db, clock);
    if (live) throw new ScoreBusyError(live.kind);
    const id = runsRepo(db, clock).start('scout');
    runsRepo(db, clock).progress(id, {
      progress: { done: 0, total: 0, found: 0, unit: 'Board' } satisfies ScoutProgress,
      beatAt: clock.now(),
    });
    return id;
  });
  return tx.immediate();
}

export { parseScoutProgress };

/**
 * Refresh listings: a scout with no scoring. Same lock as Run scout (`startScoutRun`),
 * and it never enters the Scoring step. Any `scoring` deps are dropped.
 */
export async function runRefresh(deps: ScoutDeps): Promise<ScoutResult> {
  const { scoring: _dropped, ...rest } = deps;
  void _dropped;
  return runScout(rest);
}

export async function runScout(deps: ScoutDeps): Promise<ScoutResult> {
  const { db, http, clock, log, companies, criteria } = deps;
  const runs = runsRepo(db, clock);
  const companyRepo = companiesRepo(db, clock);
  const jobWrites = jobsRepo(db);
  const runId = deps.runId ?? runs.start('scout');
  const stats = emptyStats();
  const touches = new Map<string, DomainTouch>();
  const harvested: HarvestSource[] = [];
  const gone: Array<{ ats: string; token: string; name: string }> = [];
  const report = (progress: ScoutProgress) => {
    runs.progress(runId, { progress, beatAt: clock.now() });
  };

  try {
    const boardTotal = companies.filter((company) => company.active).length;
    report({ done: 0, total: boardTotal, found: 0, unit: 'Board' });
    let boardsDone = 0;
    // Deactivate boards that were dropped from companies.yaml so they are not
    // scouted again; their jobs are left as-is (Known issue [1]).
    stats.deactivated = companyRepo.deactivateMissing(
      companies.map((c) => ({ ats: c.ats, token: c.token })),
    );

    for (const company of companies) {
      const existed = companyRepo.get(company.ats, company.token);
      const row = companyRepo.upsert(company);
      noteDomainTouch(touches, company.name, !existed);
      if (!company.active) continue;
      stats.boards += 1;
      try {
        const outcome = await scoutBoard({
          company,
          companyId: row.id,
          http,
          clock,
          log,
          jobs: jobWrites,
          key: keyForBoard(company.ats, deps.sourceKeys),
        });
        stats.boards_ok += 1;
        stats.seen += outcome.seen;
        stats.inserted += outcome.inserted;
        stats.updated += outcome.updated;
        stats.closed += outcome.closed;
        stats.closed_shortlisted += outcome.shortlisted;
        stats.skipped_jobs += outcome.skipped;
        for (const website of outcome.websites)
          noteDomainTouch(touches, company.name, false, website);
        log.info(
          {
            company: company.name,
            ats: company.ats,
            token: company.token,
            seen: outcome.seen,
            inserted: outcome.inserted,
            updated: outcome.updated,
            closed: outcome.closed,
          },
          'board scouted',
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        stats.boards_failed += 1;
        stats.errors.push({
          company: company.name,
          ats: company.ats,
          token: company.token,
          message,
        });
        log.error({ ats: company.ats, token: company.token, err: message }, 'board failed');
        if (goneStatus(err) != null) {
          gone.push({ ats: company.ats, token: company.token, name: company.name });
        }
      }
      boardsDone += 1;
      report({ done: boardsDone, total: boardTotal, found: stats.inserted, unit: 'Board' });
    }

    const passes = await scoutSearches({
      db,
      http,
      clock,
      log,
      criteria,
      preferences: deps.preferences,
      jobs: jobWrites,
      companies: companyRepo,
      keys: deps.sourceKeys,
      stats,
      touches,
      harvested,
    });
    const searchClosed = closeSearchListings(db, clock.now(), passes);
    stats.closed += searchClosed.closed;
    stats.closed_shortlisted += searchClosed.shortlisted;

    if (deps.upkeep) {
      const upkeep: UpkeepDeps = {
        db,
        http,
        log,
        dir: deps.upkeep.dir,
        cachePath: deps.upkeep.cachePath,
        enabled: (criteria.sources ?? LEGACY_SOURCES).boards.enabled,
        keys: { workable: deps.sourceKeys?.workable, teamtailor: deps.sourceKeys?.teamtailor },
      };
      const ctx: ProbeContext = {
        http,
        log,
        cache: readCache(upkeep.cachePath),
        dir: upkeep.dir,
        keys: upkeep.keys,
      };
      try {
        const harvest = await harvestBoards(ctx, {
          sources: harvested,
          listed: companies,
          enabled: upkeep.enabled,
          limit: HARVEST_PER_RUN,
        });
        stats.harvest = harvest.stats;
        log.info({ ...harvest.stats }, 'board links harvested');
        stats.relocation = await relocateBoards(upkeep, gone, ctx);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        stats.upkeep_error = message;
        log.error({ err: message }, 'board upkeep failed');
      } finally {
        writeCache(upkeep.cachePath, ctx.cache);
      }
    }

    try {
      const found = refreshTouchedDomains(db, clock, touches);
      stats.domains_ms = found.ms;
      stats.domains_written = found.written;
      stats.domains_cleared = found.cleared;
      log.info({ ms: found.ms, written: found.written, cleared: found.cleared }, 'domain finder');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      stats.domains_error = message;
      log.error({ err: message }, 'domain finder failed');
    }

    stats.duplicates = assignDuplicates(db).flagged;
    stats.areas_changed = applyAreas(db, criteria).changed;
    const everyFailed = stats.boards > 0 && stats.boards_ok === 0 && stats.search_calls === 0;

    if (!everyFailed) {
      stats.gates = applyGates(db, criteria.gates, clock.nowMs());
      stats.prescored = applyPrescores(db, deps.preferences);
      if (deps.scoring) {
        const { stats: scoreStats } = await scoreNewJobs({
          db,
          llm: deps.scoring.llm,
          clock,
          log,
          criteria,
          profile: deps.scoring.profile,
          preferences: deps.preferences,
          limit: deps.scoring.limit,
          onProgress: (progress) => {
            report({
              done: progress.done,
              total: progress.total,
              found: stats.inserted,
              unit: 'Scoring',
            });
          },
        });
        stats.scoring = scoreStats;
      }
    }

    const ok = !everyFailed;
    runs.finish(runId, {
      ok,
      stats,
      error: everyFailed ? 'every board failed' : null,
    });
    return { runId, ok, stats };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      runs.finish(runId, { ok: false, stats, error: message });
    } catch {
      // The original failure is what the caller needs.
    }
    throw err;
  }
}

export function formatScoutSummary(result: ScoutResult): string {
  const stats = result.stats;
  const lines = [
    `scout run ${result.runId}: ${result.ok ? 'ok' : 'FAILED'}`,
    `  boards: ${stats.boards_ok} ok, ${stats.boards_failed} failed (${stats.boards} active)`,
    `  jobs: ${stats.seen} seen, ${stats.inserted} new, ${stats.updated} refreshed, ${stats.closed} closed, ${stats.closed_shortlisted} shortlisted, ${stats.duplicates} duplicates`,
    `  places: ${stats.areas_changed} jobs re-classified`,
    stats.gates ? `  ${formatGateSummary(stats.gates)}` : '  gates: skipped',
    `  prescored: ${stats.prescored}`,
    `  skipped postings: ${stats.skipped_jobs}`,
    `  domains: ${stats.domains_ms}ms, ${stats.domains_written} found, ${stats.domains_cleared} cleared${stats.domains_error ? ` (finder failed: ${stats.domains_error})` : ''}`,
    `  search: ${stats.search_calls} calls, ${stats.search_skipped_budget} skipped at budget`,
    ...stats.search_queries.map((query) => `    - ${query}`),
    formatJobspipe(stats.jobspipe),
    stats.harvest
      ? `  harvest: ${formatHarvest(stats.harvest)}`
      : `  harvest: ${stats.upkeep_error ? `failed (${stats.upkeep_error})` : 'off'}`,
    ...stats.relocation.flatMap((r) => [
      `  relocation: ${r.name} (${r.ats}/${r.token}): ${lookedLine(r)}`,
      ...r.candidates.map(
        (c) => `    - ${c.ats}/${c.token} · ${c.postings} postings · ${c.name} (via ${c.via})`,
      ),
    ]),
    stats.scoring === 'skipped' ? '  scoring: skipped' : `  ${formatScoreSummary(stats.scoring)}`,
  ];
  if (stats.errors.length === 0) {
    lines.push('  errors: none');
  } else {
    lines.push('  errors:');
    for (const error of stats.errors) {
      lines.push(`    - ${error.company} (${error.ats}/${error.token}): ${error.message}`);
    }
  }
  return lines.join('\n');
}

/** One-line summary of a gate pass. */
export function formatGateSummary(g: GateStats): string {
  const { closed, duplicate, blocklist, age } = g.gated;
  return `gates: ${g.passed} passed; gated ${closed} closed, ${duplicate} duplicate, ${blocklist} blocklisted, ${age} too old (${g.newly_gated} newly gated, ${g.resurfaced} re-surfaced)`;
}

/** Human summary of a scoring pass, used by scout and `score`. */
export function formatScoreSummary(stats: ScoreStats): string {
  const tokens = stats.input_tokens + stats.output_tokens;
  const cost = `~$${stats.estimated_usd.toFixed(4)}${stats.cost_is_estimate ? ' (no price for model)' : ''}`;
  return [
    `scoring: ${stats.candidates} candidates → ${stats.scored} scored (${stats.scored_first} in ${stats.first.join(', ') || 'no place first'}), ${stats.cached} cached, ${stats.skipped_cap} deferred by cap, ${stats.errors} errors`,
    `    model: ${stats.model} (${stats.rubric_version})`,
    `    tokens: ${stats.input_tokens} in + ${stats.output_tokens} out = ${tokens}; cost ${cost}`,
  ].join('\n  ');
}

interface BoardOutcome {
  seen: number;
  inserted: number;
  updated: number;
  closed: number;
  shortlisted: number;
  skipped: number;
  websites: string[];
}

async function scoutBoard(deps: {
  company: CompanyConfig;
  companyId: number;
  http: Http;
  clock: Clock;
  log: Logger;
  jobs: ReturnType<typeof jobsRepo>;
  key?: string;
}): Promise<BoardOutcome> {
  const adapter = loadBoard(deps.company.ats);
  if (!adapter) throw new Error(`no board adapter for ${deps.company.ats}`);
  if (adapter.needsKey && !deps.key) {
    throw new Error(`${deps.company.ats} requires an API key`);
  }
  const raw = await adapter.fetchBoard(deps.company.token, deps.http, deps.key);
  const parsed = adapter.parse(raw);
  const ref: CompanyRef = {
    name: deps.company.name,
    ats: deps.company.ats,
    token: deps.company.token,
  };
  const normalized = {
    skipped: [...parsed.skipped],
    postings: parsed.postings.map((posting) => adapter.normalize(posting, ref)),
  };
  const skipped = normalized.skipped;
  for (const message of skipped.slice(0, SKIP_LOG_LIMIT)) {
    deps.log.warn(
      { ats: deps.company.ats, token: deps.company.token, detail: message },
      'skipped posting',
    );
  }
  if (skipped.length > SKIP_LOG_LIMIT) {
    deps.log.warn(
      { ats: deps.company.ats, token: deps.company.token, extra: skipped.length - SKIP_LOG_LIMIT },
      'further skipped postings omitted',
    );
  }

  const seen = new Set<string>();
  let inserted = 0;
  let updated = 0;
  const websites: string[] = [];
  const now = deps.clock.now();

  for (const posting of normalized.postings) {
    if (seen.has(posting.externalId)) {
      skipped.push(`duplicate external id ${posting.externalId}`);
      deps.log.warn(
        { ats: ref.ats, token: ref.token, externalId: posting.externalId },
        'duplicate external id on board',
      );
      continue;
    }
    seen.add(posting.externalId);
    if (posting.companyWebsite) websites.push(posting.companyWebsite);
    const result = deps.jobs.upsert(
      {
        companyId: deps.companyId,
        ats: posting.ats,
        externalId: posting.externalId,
        title: posting.title,
        locationRaw: posting.locationRaw,
        remoteType: posting.remoteType,
        employmentType: posting.employmentType,
        url: posting.url,
        applyUrl: posting.applyUrl,
        descriptionText: posting.descriptionText,
        compMin: posting.compMin,
        compMax: posting.compMax,
        compCurrency: posting.compCurrency,
        postedAt: posting.postedAt,
        contentHash: contentHash(posting.title, posting.descriptionText),
        dedupeKey: dedupeKey(ref.name, posting.title, posting.locationRaw ?? ''),
        sourceKind: 'board',
        sourceName: deps.company.ats,
        sourceQuality: 'high',
      },
      now,
    );
    if (result.action === 'inserted') inserted += 1;
    else updated += 1;
    if (result.companyChanged) {
      deps.log.warn(
        { ats: posting.ats, externalId: posting.externalId, companyId: deps.companyId },
        'job external id moved between companies',
      );
    }
  }

  const closed = deps.jobs.closeMissing(deps.companyId, seen, now);
  return {
    seen: seen.size,
    inserted,
    updated,
    closed: closed.closed,
    shortlisted: closed.shortlisted,
    skipped: skipped.length,
    websites,
  };
}

function formatJobspipe(jobspipe: ScoutStats['jobspipe']): string {
  const credits = jobspipe.calls.map((call) => String(call.credits));
  const creditText = credits.length > 0 ? ` · credits ${credits.join(', ')}` : '';
  const remaining =
    jobspipe.credits_remaining == null ? '' : ` · ${jobspipe.credits_remaining} remaining`;
  const lines = [`  jobspipe: ${jobspipe.calls.length} calls${creditText}${remaining}`];
  if (jobspipe.skipped.length > 0) lines.push(`    skipped: ${countReasons(jobspipe.skipped)}`);
  return lines.join('\n');
}

function countReasons(reasons: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return [...counts]
    .map(([reason, count]) => (count > 1 ? `${reason} (${count})` : reason))
    .join('; ');
}

function keyForBoard(ats: Ats, keys: ScoutDeps['sourceKeys']): string | undefined {
  if (ats === 'workable') return keys?.workable;
  if (ats === 'teamtailor') return keys?.teamtailor;
  return undefined;
}

async function scoutSearches(deps: {
  db: Db;
  http: Http;
  clock: Clock;
  log: Logger;
  criteria: Criteria;
  preferences: string;
  jobs: ReturnType<typeof jobsRepo>;
  companies: ReturnType<typeof companiesRepo>;
  keys: ScoutDeps['sourceKeys'];
  stats: ScoutStats;
  touches: Map<string, DomainTouch>;
  harvested: HarvestSource[];
}): Promise<SearchPasses> {
  const sources = deps.criteria.sources ?? LEGACY_SOURCES;
  const now = deps.clock.now();
  const places = searchPlaces(deps.criteria);
  const queries = generateQueries(
    deps.preferences,
    now,
    places,
    deps.criteria.remote?.countries ?? [],
  );
  const passes: SearchPasses = { hn: { ok: false }, jsearchOk: false, jobspipeOk: false };

  if (sources.search.hn.enabled) {
    const remote = queries.find((query) => query.area === REMOTE_AREA) ?? queries[0];
    const ran = await runSearch(
      deps,
      hnAdapter,
      remote,
      sources.search.hn.monthly_call_budget,
      null,
      now,
      deps.touches,
    );
    if (ran.ok) passes.hn = { ok: true, seen: ran.seen };
  }
  if (sources.search.jsearch.enabled) {
    if (!deps.keys?.jsearch) {
      deps.stats.errors.push({
        company: 'jsearch',
        ats: 'jsearch',
        token: 'search',
        message: 'JSEARCH_API_KEY is not set; jsearch skipped',
      });
      deps.log.warn('jsearch enabled but JSEARCH_API_KEY is not set');
    } else {
      // As many calls per run as there are titles, as before places; the
      // rotation splits the same monthly budget across remote and each place.
      const perRun = Math.ceil(queries.length / (places.length + 1));
      const slice = queriesForRun(queries, callsThisMonth(deps.db, 'jsearch', now), perRun);
      let ok = slice.length > 0;
      for (const query of slice) {
        const ran = await runSearch(
          deps,
          jsearchAdapter,
          query,
          sources.search.jsearch.monthly_call_budget,
          null,
          now,
          deps.touches,
        );
        if (!ran.ok) {
          ok = false;
          break;
        }
      }
      passes.jsearchOk = ok;
    }
  }
  if (sources.search.jobspipe.enabled) {
    if (!deps.keys?.jobspipe) {
      deps.stats.errors.push({
        company: 'jobspipe',
        ats: 'jobspipe',
        token: 'search',
        message: 'JOBSPIPE_API_KEY is not set; jobspipe skipped',
      });
      deps.log.warn('jobspipe enabled but JOBSPIPE_API_KEY is not set');
    } else {
      const areas = jobspipeQueries(queries);
      let ok = areas.length > 0;
      for (const query of areas) {
        const ran = await runSearch(
          deps,
          jobspipeAdapter,
          query,
          sources.search.jobspipe.monthly_call_budget,
          sources.search.jobspipe.monthly_credit_budget,
          now,
          deps.touches,
        );
        if (!ran.ok) {
          ok = false;
          break;
        }
      }
      passes.jobspipeOk = ok;
    }
  }
  return passes;
}

/**
 * One search call. `ok` is false on a throw, a budget skip, an unreadable
 * body, a listing not read to the end, or no query, so nothing is closed.
 * `seen` is every id the adapter recorded from the response, plus ingested hits.
 */
async function runSearch(
  deps: {
    db: Db;
    http: Http;
    log: Logger;
    jobs: ReturnType<typeof jobsRepo>;
    companies: ReturnType<typeof companiesRepo>;
    keys: ScoutDeps['sourceKeys'];
    stats: ScoutStats;
    clock: Clock;
    harvested: HarvestSource[];
  },
  adapter: SearchAdapter,
  query: SearchQuery | undefined,
  budget: number,
  creditBudget: number | null,
  now: string,
  touches: Map<string, DomainTouch>,
): Promise<{ ok: boolean; seen: Set<string> }> {
  const seen = new Set<string>();
  if (!query) return { ok: false, seen };
  let blocked = false;
  let failed = false;
  let incomplete = false;
  try {
    const hits = await adapter.search(query, {
      http: deps.http,
      key: searchKey(adapter.name, deps.keys),
      noteResponseId: (id) => seen.add(id),
      noteIncomplete: () => {
        incomplete = true;
      },
      creditsLeft: () => {
        if (creditBudget == null) return 0;
        return Math.max(0, creditBudget - creditsThisMonth(deps.db, adapter.name, now));
      },
      recordCredits: (charged, remaining) => {
        addCredits(deps.db, adapter.name, now, charged);
        if (adapter.name !== 'jobspipe') return;
        deps.stats.jobspipe.calls.push({ credits: charged });
        deps.stats.jobspipe.credits_remaining = remaining;
      },
      noteSkipped: (reason) => {
        if (adapter.name === 'jobspipe') deps.stats.jobspipe.skipped.push(reason);
      },
      stopForCredits: () => {
        blocked = true;
        deps.stats.search_skipped_budget += 1;
        deps.log.warn({ source: adapter.name }, 'search source at monthly credit budget');
      },
      charge: () => {
        const ok = chargeCall(deps.db, adapter.name, now, budget, adapter.costPerCall);
        if (ok) {
          deps.stats.search_calls += 1;
          deps.stats.search_queries.push(describeQuery(adapter.name, query));
        } else {
          deps.stats.search_skipped_budget += 1;
          blocked = true;
          deps.log.warn({ source: adapter.name, budget }, 'search source at monthly budget');
        }
        return ok;
      },
    });
    for (const hit of hits) seen.add(hit.posting.externalId);
    ingestHits(deps, hits, adapter.name, now, touches);
  } catch (err) {
    failed = true;
    const message = err instanceof Error ? err.message : String(err);
    deps.stats.errors.push({ company: adapter.name, ats: adapter.name, token: 'search', message });
    deps.log.error({ source: adapter.name, err: message }, 'search source failed');
  }
  if (incomplete) {
    const message = `${adapter.name} listing was not read to the end, so nothing was closed`;
    deps.stats.errors.push({ company: adapter.name, ats: adapter.name, token: 'search', message });
    deps.log.error({ source: adapter.name }, message);
  }
  return { ok: !blocked && !failed && !incomplete, seen };
}

function searchKey(name: SearchAdapter['name'], keys: ScoutDeps['sourceKeys']): string | undefined {
  if (name === 'jsearch') return keys?.jsearch;
  if (name === 'jobspipe') return keys?.jobspipe;
  return undefined;
}

function describeQuery(source: string, query: SearchQuery): string {
  const where = [query.remoteOnly ? 'remote' : '', query.location ?? ''].filter(Boolean).join(', ');
  return `${source} [${query.area ?? '-'}] "${query.titles.join(' ')}"${where ? ` · ${where}` : ''}`;
}

function ingestHits(
  deps: {
    jobs: ReturnType<typeof jobsRepo>;
    companies: ReturnType<typeof companiesRepo>;
    clock: Clock;
    stats: ScoutStats;
    harvested: HarvestSource[];
  },
  hits: SearchHit[],
  source: 'hn' | 'jsearch' | 'jobspipe',
  now: string,
  touches: Map<string, DomainTouch>,
): void {
  const quality = source === 'hn' ? 'low' : 'medium';
  for (const hit of hits) {
    const token = slugify(hit.companyName);
    const existed = deps.companies.get(source, token);
    const company = deps.companies.upsert({
      name: hit.companyName,
      ats: source,
      token,
      active: true,
      tags: ['search'],
    });
    const posting = hit.posting;
    noteDomainTouch(touches, hit.companyName, !existed, posting.companyWebsite);
    const result = deps.jobs.upsert(
      {
        companyId: company.id,
        ats: posting.ats,
        externalId: posting.externalId,
        title: posting.title,
        locationRaw: posting.locationRaw,
        remoteType: posting.remoteType,
        employmentType: posting.employmentType,
        url: posting.url,
        applyUrl: posting.applyUrl,
        descriptionText: posting.descriptionText,
        compMin: posting.compMin,
        compMax: posting.compMax,
        compCurrency: posting.compCurrency,
        postedAt: posting.postedAt,
        contentHash: contentHash(posting.title, posting.descriptionText),
        dedupeKey: dedupeKey(hit.companyName, posting.title, posting.locationRaw ?? ''),
        sourceKind: 'search',
        sourceName: source,
        sourceQuality: quality,
      },
      now,
    );
    deps.stats.seen += 1;
    if (result.action === 'inserted') deps.stats.inserted += 1;
    else deps.stats.updated += 1;
    deps.harvested.push({
      companyName: hit.companyName,
      texts: [posting.url, posting.applyUrl, posting.descriptionText],
    });
  }
}

function emptyStats(): ScoutStats {
  return {
    boards: 0,
    boards_ok: 0,
    boards_failed: 0,
    deactivated: 0,
    seen: 0,
    inserted: 0,
    updated: 0,
    closed: 0,
    closed_shortlisted: 0,
    duplicates: 0,
    areas_changed: 0,
    search_calls: 0,
    search_queries: [],
    search_skipped_budget: 0,
    jobspipe: { calls: [], credits_remaining: null, skipped: [] },
    gates: null,
    prescored: 0,
    skipped_jobs: 0,
    scoring: 'skipped',
    errors: [],
    domains_ms: 0,
    domains_written: 0,
    domains_cleared: 0,
    domains_error: null,
    harvest: null,
    relocation: [],
    upkeep_error: null,
  };
}
