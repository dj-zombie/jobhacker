# Architecture — JobHacker

J1 checked every section against `src/` on 2026-10-25 and corrected it to match the code. Where the code breaks an invariant or a decision, the problem is in STATUS § Known issues, not here.

Lines marked with a later round, like "(J3)" or "from J4", describe what that round will add. They stay plans until that round builds them.

## Shape

One TypeScript package: a core library, plus two thin entry points. Everything runs on Kris's Mac.

```
            ┌──────────────────┐      ┌──────────────────────┐
            │ CLI (+ launchd)  │      │ Next.js UI  :3000    │
            └────────┬─────────┘      └──────────┬───────────┘
                     └────────────┬──────────────┘
                            src/core  (all logic)
  ┌──────────┬───────────────┬──────────┬───────────┬──────────────┬──────────┐
sources    pipeline         llm        prep        apply          db
(boards +  (dedupe, gate,   (Claude,   (resume,    (CDP → Chrome: (SQLite +
 search,    places (J3),     Zod)       cover,      scan, map,     Drizzle)
 budgets)   prescore,                   answers,    self-ID, fill,
            score, rank)                grounding)  SafePage)
```

## Stack

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node (v24 at J1), TypeScript in strict mode, `tsx` for the CLI and scripts | Kris's core stack. No build step for the CLI |
| Package manager | pnpm 9 | Fast and strict |
| Database | SQLite (`better-sqlite3`) with Drizzle ORM and drizzle-kit migrations | One local file, typed queries, real migrations |
| Validation | Zod | Config, model output and API responses |
| UI | Next.js 15 App Router (server components and server actions), React 19, Tailwind v4 with the kit's tokens in `src/app/globals.css`, and the JobHacker kit (`docs/reference/UI-KIT.md`) with Geist | Server actions call core directly for writes. Reads a page makes after it loads go through GET route handlers, because a tab runs its server actions one at a time (D96) |
| CLI | commander | Small and boring |
| Model | `@anthropic-ai/sdk`. A cheap model for scoring and a strong one for writing, both set in `criteria.yaml` | Cheap triage, strong writing |
| Browser | `playwright-core` `chromium.connectOverCDP`, into a dedicated Chrome profile | A real browser with real sign-ins. Kris submits |
| PDF | `playwright-core` `page.pdf()` from an HTML template (`prep/render.ts`) | Reuses a tool that's already in the stack |
| Profile import | `mammoth` (DOCX) and `pdf-parse` (PDF), parsed locally | Raw inputs never leave the Mac |
| Logging | pino, to stdout and `data/logs/jobhacker-YYYY-MM-DD.log` | Structured and cheap |
| Tests | Vitest | Fast, and TypeScript-native |
| Lint and format | Biome 1.9 | One tool |

## Repository layout

```
AGENTS.md                  agent rules (read first)
README.md                  setup, daily use, scheduling
docs/                      ARCHITECTURE, reference/, testing/old-tokens.txt, screenshots/ (the planning docs stay private)
.cursor/rules/             always-on pointer to AGENTS.md
ui-reference/              the visual spec: the prototype, its source and frames (excluded from the build)
config/
  *.example.yaml|md        committed templates: the documentation for each schema
  criteria.yaml            gitignored: gates, weights, bands, budget, models, sources
  preferences.md           gitignored: Kris's taste, in prose
  profile.yaml             gitignored: the grounded record of what Kris has done, plus answers and self-ID
  companies.yaml           gitignored: the boards to watch
src/
  core/
    config/                load.ts, schemas.ts, criteria-file.ts, companies-file.ts, migrate.ts (v1 → v2), errors.ts
    db/                    schema.ts (Drizzle), client.ts, info.ts, backup.ts, repo/*.ts
    sources/               types.ts (board adapter), search.ts (search adapter), one file per adapter,
                           registry.ts, detect.ts, discover.ts, add-company.ts, normalize.ts, parse.ts,
                           query-gen.ts, budget.ts, slug.ts, token.ts
    pipeline/              scout.ts, dedupe.ts, gate.ts, places.ts (the classifier), areas.ts (config,
                           job_areas writes, Where parsing, the prompt fact), prescore.ts, score.ts, rank.ts,
                           ranked.ts, funnel.ts, why.ts, review.ts, reconcile.ts, tracker.ts, stats.ts,
                           triage.ts (the triage views' rows, counts, detail and scoring summary),
                           triage-view.ts (client-safe view rules), score-run.ts (app-started score batches)
    llm/                   types.ts (LlmClient), anthropic.ts, fake.ts, cost.ts, usage.ts,
                           prompts/*.ts (each exports VERSION)
    prep/                  prep.ts, tailor.ts, grounding.ts, cover-note.ts, answers.ts, form-answers.ts,
                           render.ts, templates/
    apply/                 browser.ts, safe-page.ts, apply.ts, fill.ts, field-map.ts, llm-map.ts, self-id.ts,
                           location.ts, phone.ts, smartrecruiters.ts, types.ts, adapters/,
                           fill-view.ts (a stored fill report → the workspace's rows; server side)
    ingest/                resume.ts, linkedin.ts, merge.ts: resume and LinkedIn export → draft profile
    util/                  http.ts, hash.ts, text.ts, logger.ts, logs.ts, clock.ts, env.ts
    brand/                 domain.ts (the finder), apply.ts (scout refresh and backfill),
                           logo-url.ts, logo-set.ts (who gets a logo)
    testing/               fixtures.ts (shared test builders)
  cli/                     index.ts + commands/*.ts
  app/                     Next.js routes, plus:
    components/            page contents (TriagePage, TriageView, UnscoredHero, JobDeepLink, ApplicationsList,
                           ApplicationWorkspace, WorkspacePanels, DbErrorState, …). LegacyQueue, QueueClient
                           and WeightsPanel are still in the tree; no route renders them (D116)
    lib/                   actions.ts (server actions), queries.ts, triage.ts and triage-url.ts (client-safe
                           row shapes and URL state), shell-types.ts, workspace-types.ts, activity.ts (event
                           titles), status.ts (application statuses), format.ts, styles.ts, palette.ts
    api/                   GET routes: scout-card, triage-counts, job/[id] (one job's detail), score-run/[id]
    job/[id]/posting/      redirects to a job's posting URL (the O key)
  components/
    jobhacker/             the kit's components, byte-identical to ui-reference/: presentational only
    ui/                    the kit's primitives (button, dialog, dropdown-menu, slider, tabs, tooltip)
    app-shell.tsx          the client shell: sidebar, rail, phone drawer, scout card
  lib/                     the kit's utils.ts and format.ts, and use-media-query.ts
drizzle/                   migrations (committed, never edited once applied; 0005 and 0006 are hand-written)
resources/seeds/           committed seed lists for boards:discover (D48)
ops/                       space.jobhacker.scout.plist, the launchd template
scripts/                   check-docs.mjs, shoot.ts (screenshots), palette.ts
tests/fixtures/            recorded API JSON, saved application-form HTML in forms/,
                           and invented Brandfetch marks in brandfetch/
tests/e2e/brandfetch.ts    the Brandfetch stand-ins every Playwright run uses
data/                      the database, logs/, backups/, discover-cache.json (all gitignored)
input/                     raw resume and LinkedIn export for profile:build (gitignored)
output/                    generated files per application (gitignored)
```

**Layering rule:**
- `app/` and `cli/` import from `core/`. `core/` never imports from them.
- Core modules receive their dependencies as arguments: `{ db, llm, http, clock, log }`.
- Kit components take props, and never fetch data or call actions (from J4).

## Config files

All of these are validated by `core/config/schemas.ts`. When a schema changes, update its example file in the same commit.

- **`criteria.yaml`** holds mechanics only, and no keyword lists:
  - `gates`: `max_age_days` (`0` turns the age gate off) and `company_blocklist`. Closed and duplicate are always applied.
  - `weights` for the six dimensions, and `bands` (`strong`, `maybe`). These are the only source of weights and bands. The prototype's values are sample data.
  - `budget`:
    - `max_new_scores_per_run`: the per-run cap on new scoring calls. `score --limit n` can only lower it.
    - `prescore_floor`: a compatibility field, fixed at `0` by the schema. Prescore orders and never excludes.
    - There is no monthly model-spend cap (D89). `pnpm cli stats` shows the month's estimated spend.
  - `llm`: `scoring_model` and `writing_model`.
  - `sources`: `boards.enabled` (which ATSes `boards:discover` probes; scout fetches every active board in `companies.yaml` regardless), `search.{jsearch,jobspipe,hn}` each with `enabled` and `monthly_call_budget`, and `workday.enabled`. Without a `sources` block, the three original boards are assumed.
  - `places` (J3): each place has an `id`, a `label`, an optional `note`, `cities`, `states`, and optional `extra` ("City, ST" outside its states) and `aliases`. `remote.countries` lists the countries a remote role may be open to. `where_default` is the Where used when none is given: place ids plus `remote`. The schema rejects the reserved ids `remote` and `anywhere`, duplicate ids, and a `where_default` entry that isn't a place or `remote`. All three are optional; without them every job is in no place and scoring puts no place first. `docs/reference/PLACES.md` is the spec.
  - J6 does not add `dealbreakers`. Kris's answer on 2026-10-25 was not a yes to a second cap, so D44 is unchanged.
- **`preferences.md`**: Kris's taste, in prose, which the model reasons over. Nothing in it is substring-matched for a decision; prescore reads its terms only to order scoring. It's part of the score cache key.
- **`profile.yaml`**: the grounded factual record. Its top-level keys are:
  - `contact` and `links`
  - `summary` and `skills`
  - `experience` and `projects`, whose bullets carry stable `id`s, and `education`
  - `standard_answers`, a map of answer keys to text. Work authorization lives here.
  - `cover_note`: tone and always-mention points
  - `self_identification`, which is filled verbatim, never inferred (invariant 7):
    - Its keys are `gender`, `race_ethnicity`, `veteran_status` and `disability_status`.
    - Each one is `decline`, or the exact option text Kris wants selected. A missing block declines everything.
    - There's also `overrides`, for forcing a specific option's text on forms whose wording differs.
    - The example file ships every field as `decline`, so nothing is disclosed until Kris opts in.

  It's part of the score cache key.
- **`companies.yaml`**: `{ name, ats, token, active, tags[] }` for each board. `companies:add` and `boards:discover` append to it. A board removed from the file is deactivated on the next scout; its jobs stay.
- **`.env`**: API keys (`ANTHROPIC_API_KEY`, `JSEARCH_API_KEY`, `JOBSPIPE_API_KEY`, `WORKABLE_API_KEY`, `TEAMTAILOR_API_KEY`), `BRANDFETCH_CLIENT_ID` (J9) and `DATABASE_PATH`. The CLI loads it with `util/env.ts`; real environment variables win. Never commit it, and never log it.

## Sources

What's allowed, and how each source works, is specified in `docs/reference/SOURCES.md`.

**Built at J1:**
- Board adapters: `greenhouse`, `lever`, `ashby`, `smartrecruiters`, `breezy`, `polymer`, `workable` (needs a key), `teamtailor` (needs a key). Each is one file in `src/core/sources/`, wired into `registry.ts`.
- Search adapters: `jsearch` (needs a key) and `hn` (the monthly HN "Who is hiring" thread).
- Not built: `workday` (it's in the ATS list and the config, but has no adapter, so a Workday board errors) and `jobspipe` (configured, never called).

```ts
// sources/types.ts — one employer per call
interface SourceAdapter<T> {
  kind: 'board';
  needsKey: boolean;
  ats: Ats;
  fetchBoard(token: string, http: Http, key?: string): Promise<unknown>;
  parse(raw: unknown): { postings: T[]; skipped: string[] };   // throws BoardParseError if it isn't a board
  normalize(posting: T, company: CompanyRef): NormalizedPosting;
}

// sources/search.ts — many employers per call, metered
interface SearchAdapter {
  kind: 'search';
  name: 'jsearch' | 'jobspipe' | 'hn';
  needsKey: boolean;
  costPerCall: number;                     // dollars charged to source_usage; 0 on free tiers
  search(query: SearchQuery, ctx: { http: Http; key?: string; charge(): boolean }): Promise<SearchHit[]>;
}

interface SearchQuery { titles: string[]; location?: string; remoteOnly: boolean; since: string; page?: number; area?: string }
interface SearchHit { companyName: string; posting: NormalizedPosting }   // the company is derived, not passed in
```

- `registry.ts` maps an ATS name to its board adapter. `ATS_VALUES` in `config/schemas.ts` is the allowlist for `companies.ats` and `jobs.ats`: the nine board ATSes plus the three search sources.
- `detect.ts` maps a careers URL to `{ ats, token }` for `companies:add`. `boards:discover --seed <file>` probes each seed company's likely token on the enabled ATSes and appends hits. Committed seeds live in `resources/seeds/` (D48).
- Search queries come from `preferences.md` through `query-gen.ts`, never hand-written per run. From J3, each title query runs once for remote and once per place in `where_default` (`location: "<first city>, <first state>"`, `area` set to the place id), interleaved title by title. HN runs the first remote query, as before. JSearch sends `ceil(queries ÷ (places + 1))` queries a run, a rotating window that starts at `calls this month mod queries`, so a month's budget is spread across remote and every place without changing the budget (`queriesForRun`). The scout's `stats.search_queries` lists what was sent.
- Schemas are written from real responses, saved as fixtures. They parse leniently: unknown extra fields are fine, but a posting missing a required field is skipped with a reason. A board whose every posting fails throws, so scout doesn't mistake it for an empty board and close its jobs.

## Data model

```
companies     id, name, ats, token, active, tags(json), created_at          UNIQUE(ats, token)
jobs          id, company_id, ats, external_id, title, location_raw,
              remote_type(remote|hybrid|onsite|unknown), employment_type, url, apply_url,
              description_text, comp_min, comp_max, comp_currency,
              posted_at, first_seen_at, last_seen_at, closed_at,
              content_hash, dedupe_key, duplicate_of,
              source_kind(board|search), source_name, source_quality(high|medium|low),
              status(new|filtered_out|unscored|scored|shortlisted|skipped|archived),
              filter_reason (legacy, no longer written), gate_result(json {passed, gate, detail}),
              prescore(real 0–1),
              score_state(pending|current|stale|run_cap|llm_error)
              UNIQUE(ats, external_id)
job_scores    id, job_id, content_hash, rubric_version, model, profile_hash, preferences_hash,
              dimensions(json: six × {score 0–5 | null, reason}), summary, red_flags(json),
              score, verdict, reasons(json), created_at
              UNIQUE(job_id, content_hash, rubric_version, model, profile_hash, preferences_hash)
job_areas     job_id → jobs ON DELETE CASCADE, area     PRIMARY KEY(job_id, area), INDEX(area)
applications  id, job_id UNIQUE,
              status(prepped|submitted|interviewing|offer|rejected|withdrawn|ghosted),
              resume_html, resume_pdf_path, cover_note, answers(json), fill_report(json),
              submitted_at, follow_up_at, notes, created_at, updated_at
events        id, application_id NULL, job_id NULL, type, payload(json), at      -- append-only
runs          id, kind(scout|score|prep|fill), started_at, finished_at, ok, stats(json), error
source_usage  id, source_name, day, calls, est_cost_usd              UNIQUE(source_name, day)
company_domains  company_key PK, name, domain NULL, state(found|confirmed|none), source,
                 brand_id NULL, mark_url NULL, updated_at
```

Migrations `0000`–`0007` are in `drizzle/`. `0005_job_areas.sql`, `0006_company_domains.sql` and `0007_company_mark_url.sql` are hand-written, because `drizzle/meta/` has no snapshot after 0003 (Known issues). There is no `job_ratings` table: the calibration work that would have used it was cut.

- **`company_domains`** (J9, J10) is one row per normalized company name (`normalizeCompanyName`, the same key dedupe uses). `state` is `found` (the finder or the browser lookup), `confirmed` (Kris, J10) or `none` (he said this company has no logo). Nothing automatic overwrites `confirmed` or `none`. J10 is the write that sets those two: Looks right keeps the domain, source and brand id and sets `confirmed`; a pick stores the registrable domain with source `picked` and the brand id; a typed domain stores the registrable domain with source `typed`, no brand id, and `mark_url` when the browser found an https icon on that same domain; No logo stores a null domain, source `none` and no brand id. A typed tile loads `mark_url` and never the Logo CDN. A `none` row counts as none even when the domain is null, so it is not "no domain yet". A job-data `found` row is deleted when the finder no longer has a domain. A `brand_search` row stays until job data replaces it. `brand_id` is set when the browser lookup or a pick stores a match, and cleared when job data overwrites that row. Domains are display only: scoring, prep and fills never read them. The logo set is companies with an open, canonical, gate-passed Strong or Maybe job that isn't skipped or archived, in every place. `pnpm cli logos` counts that set, then every company.

- **`job_areas`** (J3) holds one row per place a job is in: a place id from `criteria.yaml`, or `remote`. A job in none has no rows, and "anywhere" means no area condition at all. Every job is classified, gated or not, so the counts are geography only. It stores no evidence; `why` re-classifies live and flags a difference. `repo/areas.ts` has `inAreas(areas)`, the one SQL condition every Where filter uses.

- **`content_hash`** is the sha256 of the normalized title and description. If it changes, the job is rescored.
- **`dedupe_key`** hashes the normalized company, title and location.
  - Company names are normalized aggressively first (`Inc`, `LLC`, `Ltd`, punctuation, case), and the normalization is tested against real collisions between sources.
  - Among duplicates, the highest `source_quality` record is canonical, and the others get `duplicate_of`. `high` is an ATS board, `medium` an aggregator, `low` HN. Between records of equal quality, the first one seen wins. A search copy is superseded when its ATS twin appears.
- **Gated jobs** keep their `gate_result` and stay countable in the funnel. Their `status` depends on the gate:
  - A job failing the blocklist or age gate, in an automated status (`new`, `filtered_out`, `unscored`, `scored`), moves to `filtered_out`. It goes back to `new` if it passes again.
  - Closed and duplicate jobs only get the result recorded; their status is left as it was (most duplicates are `new`). Lists exclude them by `closed_at` and `duplicate_of`.
  - Human triage statuses (`shortlisted`, `skipped`, `archived`) are never changed by the pipeline.
- **`score_state`** says where an eligible job stands: `current` (scored under the current cache key), `stale` (scored under an older key, still ranked), `pending`, or deferred with the exact reason (`run_cap`, `llm_error`).
- **Legacy scoring columns.** `job_scores.score`, `verdict` and `reasons` are v1 columns. `score` and `verdict` are also written as a snapshot at scoring time, but every list re-ranks from `dimensions` with the current weights. v1 rows (`dimensions` null) are history: neither ranked nor a cache hit.
- **Statuses.** Job status tracks discovery and triage, and never decides scoring eligibility. Application status tracks what happens after the shortlist. Keep the two separate.
- **Time.** Timestamps are ISO strings in UTC, and every "now" goes through `clock`.

## Pipeline

**Scout** (`pnpm cli scout`, and launchd):
1. Start a `runs` row. Deactivate boards that were removed from `companies.yaml`.
2. Fetch:
   - Board sources: every active board in `companies.yaml`, one after another, through the rate-limited HTTP client. Normalize and upsert each posting, and set `closed_at` on that board's jobs that weren't seen this time.
   - Search sources: HN, then JSearch, each when enabled, running the generated queries within the monthly budget.
   - Domain finder (J9), after both of those and before dedupe. It looks at companies new in this run and at `found` companies this run touched. The pure finder still sees every stored job, so a domain shared by three companies is dropped globally. It makes no network calls. A throw is recorded as `domains_error` and the scout continues. JSearch's `employer_website` is not a column: it arrives as `companyWebsite` on the normalized posting and is applied to this run's jobs only. The backfill (`pnpm cli logos --find`) reads stored `url`, `apply_url`, the HN post, and every job's description. A mention has to match the company name strictly, so one company's footer doesn't become another company's logo. Companies the text still doesn't name are resolved in Kris's browser, from Brand Search, one at a time (D105). That lookup does not run in scout.
   - A failing board or search goes into `stats.errors`, and never aborts the run. A board that fails closes none of its jobs.
3. Dedupe across sources, by quality.
   - Then classify every job into `job_areas` (`pipeline/areas.ts` → `places.ts`), writing only the rows that changed. It's geography, not a gate: nothing reads it to skip, gate or drop a job (invariant 8).
4. Gate every job, using the four gates only.
5. Prescore the jobs that passed.
6. Score, up to the per-run cap, in the order given in § Scoring.
7. Finish the run with its stats.

`--no-score` skips step 6. `pnpm cli score [--limit n]` runs steps 4–6 on the existing database. If every board failed and no search ran, steps 4–6 are skipped and the run is not ok.

**Reconcile.** `pipeline/reconcile.ts` (`reconcilePlacement`) re-applies the gates, prescores and places before a reader that depends on them: `score`, `rank`, `funnel`, `why` and the app's queue. It's cached per database file on a stamp of the job count, the latest `last_seen_at`, the count of open jobs missing a prescore, `preferences.md`, and the gates, `places` and `remote` config, so an unchanged database costs one stamp query. Editing `places` in `criteria.yaml` re-classifies on the next read; `pnpm cli places:reclassify` does it on demand and prints the counts.

## Scoring

- **The gates** (invariant 8, `pipeline/gate.ts`) are checked in order: closed, duplicate, blocklisted company, older than `max_age_days`. A job with no date passes. The result is stored as `gate_result {passed, gate, detail}` on every job.
- **Prescore** (`pipeline/prescore.ts`) is a deterministic lexical relevance score, from 0 to 1, between the job and `preferences.md`. No model, no dependency.
  - Terms are stemmed and compound words folded (front-end → frontend). They're weighted by inverse document frequency over the gate-passed jobs, so generic words count for little.
  - It's `0.7 ×` the share of title weight that's wanted, plus `0.3 ×` the share of wanted terms found in the description, minus `0.6 ×` the share of title weight that's unwanted. Unwanted terms come from sentences under headings like "Roles I don't want" or with a negation cue.
  - It **only orders** the jobs. The floor is `0`. Jobs beyond the cap wait as unscored and stay visible.
- **Dimensions.** The model returns six dimensions, each 0–5 or null (genuinely unknown), with a one-line reason each, plus a summary and up to five red flags:

| Dimension | Covers |
|---|---|
| `role_fit` | Whether this is the kind of work Kris does and wants. Function and work shape only |
| `tech_fit` | How the stack overlaps with his actual experience |
| `domain_interest` | Domains he cares about, per `preferences.md` |
| `seniority_fit` | Level and IC-versus-management track |
| `logistics_fit` | Location, remote and employment type, against what he can accept |
| `comp_fit` | Pay against his floor. Null when the posting doesn't say |

- **Prompt inputs:**
  - `preferences.md`, verbatim
  - a profile render: the summary, skills and experience bullets, never contact details
  - the job text, truncated to 12,000 characters
  - the job's places as a fact (J3), from the same classifier as the filter: `Location classified as: Portland area (matched "Portland, OR")`, `Location classified as: Remote (US)`, or `Location classified as: none of the candidate's places ("Toronto, ON")`. The logistics rubric is told to treat it as geography and to read `preferences.md` for how Kris feels about each place

  The prompt lives in `llm/prompts/score.ts`, with `VERSION` as the `rubric_version`. A failed parse retries once, then stores `llm_error`, and a later run tries again (invariant 5).
- **Cache key:** `(job, content_hash, rubric_version, model, profile_hash, preferences_hash)`. A hit is free. Editing the preferences or the profile makes scores stale. A stale job stays ranked until a score run reaches it, and stale jobs are rescored ahead of new work. Re-weighting never rescores.
- **Spend.** Every new model attempt, success or failure, counts against the per-run cap, which is the only limit on scoring calls (D89). A deferred job stores its exact reason in `score_state`. Rescoring changes the score state only; it never changes a human triage status.
- **Rank** is computed by `pipeline/rank.ts`, a pure function, and it must stay one: no I/O, no clock, no model.
  - `base = round(Σ(weight × dim) ÷ Σ(weight over non-null dims) × 20)`, from 0 to 100.
  - Null dimensions drop out of both sums, so "unknown" counts as neutral. All null, or all zero weight, gives no score.
  - **Critical caps (D44).** A known `0` in `role_fit`, `seniority_fit` or `logistics_fit` caps the score at `bands.maybe - 1`, so the job is Weak at best. A known `1` caps it at `bands.strong - 1`, so the job is Maybe at best. This is a ranking penalty, not a gate.
  - Bands: `strong` at `bands.strong` or above, `maybe` at `bands.maybe` or above, otherwise `no`, which the UI shows as Weak. At J1, `criteria.yaml` and the example both use 75 and 55.
  - `rankJobs` sorts by the capped score, best first, unscored last, ties by job id. `pipeline/ranked.ts` loads each visible job's newest dimension row for its current content hash and ranks it with the weights it's given. There is no ranking cache.
  - Worked example: with weights role 6, tech 2, domain 2, seniority 2, logistics 4 and comp 1, and comp unknown, dimensions of 5, 4, 3, 5 and 5 give 74 points over 16 total weight, so `93 = round(74 ÷ 16 × 20)`, which is Strong. The same job with logistics 1 would be capped at 74, which is Maybe.
- **Order.** Scoring walks every open, non-duplicate, gate-passed job, whatever its triage status (`listScorable` in `repo/jobs.ts`):
  1. Jobs in the places to put first, then the rest (J3). `scoreNewJobs` takes them as `first`, defaulting to `where_default`; `pnpm cli score` and the scout use the default, and J5's Score next passes the view's Where.
  2. Within each, deferred (`run_cap`) and stale jobs, then pending, then earlier errors. A job whose stored state says `current` but whose newest score isn't under the current cache key counts as stale, so a rubric or preferences change is always picked up.
  3. By prescore, then first seen, then id.

  The order never skips a job. It only decides which jobs a capped run takes first (invariant 8).
- **Inspection.** `pnpm cli funnel` (`pipeline/funnel.ts`) accounts for every job: total, gated per gate, passed, prescored, scored (current or stale, by band), and unscored by exact state. Core asserts that the gate buckets and the passed count add up to the total. The UI header renders the same snapshot. `pnpm cli why <id>` shows one job's gate, prescore terms, score or defer state, each dimension with its weight and reason, and any cap applied.

## Prep

Run from the UI or with `pnpm cli prep <jobId>` (`prep/prep.ts`).
1. **Tailor.** `tailor.ts` asks the writing model to pick and rephrase profile bullets for the job, returning `[{ source_id, text }]`.
2. **Ground.** `grounding.ts` rejects a bullet when:
   - its `source_id` is unknown
   - it has a number or percentage that isn't in the source bullet
   - it names a technology or proper noun that isn't in the source bullet or in the profile's skills
3. **Retry.** A rejection is retried once, with the violations listed. After that, the original bullet is used.
4. **Render.** HTML, then PDF, in `output/<appId>/`.
5. **Cover note and answers.** These are grounded the same way, with `[NEEDS INPUT: …]` where information is missing. Answers come from `standard_answers`.
6. **Save.** Everything goes on the job's `applications` row, with a `prep` event and an `llm_usage` event.

## Apply

Run from the UI or with `pnpm cli apply <jobId>` (`apply/apply.ts`), after prep.
1. **Connect.** `browser.ts` connects over CDP at `http://127.0.0.1:9222` to a dedicated Chrome profile. If Chrome isn't reachable, the error includes the launch command. If it's reachable but has no window, `browser.ts` opens a tab through the DevTools HTTP endpoint and retries once (D23). The UI's Open & fill uses that port unless `JOBHACKER_CDP_ENDPOINT` is set, which is how the keyboard walkthrough points at its own Chrome and leaves 9222 alone.
2. **Open** the apply URL in a new tab. A Greenhouse job whose URL isn't on `greenhouse.io` opens Greenhouse's embedded form instead. A SmartRecruiters URL is rewritten to its application page.
3. **Scan.** The form adapter scans the page through `SafePage.scanFields`: inputs, selects, textareas, Yes/No toggle groups and radio groups, with labels, options, help text and whether each is in a self-ID section. Greenhouse, Lever and Ashby have their own adapters in `apply/adapters/`. Every other page uses the generic adapter, so a missing adapter lowers coverage and never dead-ends.
4. **Map.** `field-map.ts` maps each field deterministically, in this order: self-ID, file (resume or cover letter), cover-letter text box, profile rules (name, contact, links, current role, school), an answer saved for this exact question, a standard answer by token match, and otherwise open. A missing profile value is flagged as needing input.
5. **Fill the gaps with the model.**
   - On Greenhouse, Lever and Ashby, the open questions go to one writing-model call (`draftAnswers` → `prep/form-answers.ts`). Drafts are checked against the profile, answers, preferences, posting and question, retried once, and otherwise become `[NEEDS INPUT: …]`. They're saved in `applications.answers` under the question text, so the next fill reuses them without a call.
   - On other pages, the scanned fields go to one model call (`llm-map.ts`) that maps each question to a profile fact. Values with numbers not in the profile, and choices that aren't among the options, are dropped.
   - **Self-ID fields are never sent to the model**, on either path.
6. **Self-ID.** `apply/self-id.ts` reads `profile.yaml` → `self_identification` and matches each value against the form's options (invariant 7).
   - `decline` maps to the form's own decline option, whatever the form calls it: "Decline to self-identify", "I don't wish to answer", and so on.
   - A field with no configured answer and no decline option is left blank and listed in the report. **Never a free-text guess.**
   - A self-ID field counts as filled only when what was selected matches the configured value.
7. **Fill** through `SafePage`: text, native selects, React dropdowns, typeaheads, Yes/No toggles and single-choice radio groups. Upload the resume and cover-letter PDFs with `setInputFiles`. The resume uploaded is Kris's own `input/resume.pdf`, unchanged, whenever it exists, and prep's rendered PDF only when it doesn't; the workspace's Resume tab shows the same file (`attachedResume`, D124). Consent checkboxes and consent radio groups are never touched. After filling, the page settles and every value is read back; one wiped by a late re-render is refilled once.
8. **Highlight.** Outline drafted answers in amber and unfilled required fields in red, and scroll to the first red one.
9. **The fill report** is saved to the application and as a `fill` event: `filled[]` (each with `via` `profile`, `answer`, `resume`, `draft` or `cover`, and its source key), `unfilled[]` (with `required` and a reason), `skipped_eeo[]` (self-ID fields left blank), `self_identification[]` (each self-ID field and the exact value selected), and `resumeAttached`. Drafting writes `draft_answers` and `llm_usage` events.
10. **Stop.** Kris reviews the form and submits it himself. "Mark submitted" in the UI (`markSubmitted`) sets `submitted_at` and `follow_up_at` (seven days later), moves `prepped` to `submitted`, and writes a `submitted` event. It's idempotent: a second click changes nothing (D119). Prepped means not submitted: moving back to `prepped` clears `submitted_at`, and a stamp on a prepped application is ignored (D123).

**Approvals** (J7, D118). Looks good on a drafted answer appends an `answer_approved` event `{question, value_hash, edited?}` (`pipeline/tracker.ts`: `approveAnswer`, `answerApprovals`, `isApproved`). `value_hash` is the SHA-256 of the trimmed text, so an approval lapses when the text changes. Saving an edited draft records one with `edited: true`. `setNotes` writes a `note` event carrying only `{chars}`.

A page with no fields at all falls back to a copy-paste panel of the prepared answers. In the workspace that panel is collapsed unless the ATS has no form adapter, the report has no fields, or blank fields outnumber filled and drafted ones together (`fillView` in `apply/fill-view.ts`, D117). It lists only the cover note and written answers of 12 words or more, in full (`copyPasteRows`, D122).

**Launching the dedicated Chrome profile.** `pnpm cli chrome` launches Chrome with `--remote-debugging-port=9222` and `--user-data-dir=~/.jobhacker-chrome`. Recent versions of Chrome refuse remote debugging on the default profile. Kris signs in to sites in this profile once. Before launching, it finishes the one-time move of the pre-J2 profile folder (`util/rename-move.ts`), and refuses while that Chrome is still running.

**SafePage** (invariant 1, `apply/safe-page.ts`) wraps a Playwright `Page`. Raw `Page` objects never leave `browser.ts` and `safe-page.ts`.
- **What changes the page:** `goto`, `fill`, `selectOption`, `check`, `setInputFiles`, and the widget drivers: the React dropdown methods (`openComboboxOptions`, `chooseComboboxOption`, `fillAutocomplete`), `typeaheadOptions`, `chooseToggle`, `chooseRadio`, `checkEntryCheckbox`, `fillMonthYear` and `setPhoneCountry`. The drivers dispatch synthetic events inside the page and refuse submit-like targets.
- **Clicks:** `safeClick` and `clickLabeledButton` are the only ones. They're meant for opening widgets and adding entries. `safeClick` refuses:
  - `button[type=submit]` and `input[type=submit]`
  - anything whose accessible name or text matches `/submit|apply|send|finish|complete/i`
  - anything in a form's final action bar
- **Read-only helpers:** `scanFields`, `query`, `readText`, `readBodyText`, `inputValue`, `isChecked`, `fileCount`, `comboboxValue`, `toggleValue`, `validationMessages`, `phoneValidationError`, `savedEntryLabels`, plus `highlight`, `scrollIntoView`, `dismissMenus`, `blurActive` and `settle`.
- **Guards in `pnpm check`:**
  - `apply/guard.test.ts`: a grep test that fails if any file under `src/core/apply/` other than `safe-page.ts` and `browser.ts` contains `.click(`, `.press(`, `.submit(`, `.requestSubmit(` or `keyboard.`
  - a test that the mapping request never contains a self-ID field
  - a test that every self-ID value written is either verbatim from `profile.yaml` or the form's decline option
  - fixture tests in which a page-level `submit` listener must count zero. These need a running Chrome and are skipped without one.

## LLM layer

```ts
interface LlmClient {
  structured<T>(req: { model: string; system: string; user: string; schema: ZodType<T>; maxTokens: number; promptName?: string }):
    Promise<{ value: T; usage: LlmUsage }>;      // LlmUsage: model, input and output tokens, calls
}
```

- **Structured output.** `llm/anthropic.ts` uses tool use with a JSON schema derived from Zod, then validates the result with Zod (invariant 5). Models that reject a forced tool choice get `auto`, and a JSON text reply is accepted (D20).
- **Retry.** `validateWithRetry` (`llm/types.ts`) is shared by the real and fake clients: validate, retry once with the errors fed back, then throw `LlmParseError`, which still carries the tokens spent.
- **Usage.** Callers write token usage per call as `llm_usage` events, never the prompt. `llm/usage.ts` sums this month's events, and `llm/cost.ts` estimates the cost from a per-model price table.
- **Tests.** `FakeLlm` (`llm/fake.ts`) returns canned output per attempt, keyed by prompt name, so tests exercise the retry path without the network.

## HTTP and budgets

**`util/http.ts`** wraps `fetch`, with:
- at most 1 request per second per host
- a 15-second timeout
- up to 3 tries on 429, 5xx and network errors, with exponential backoff and jitter
- `Retry-After` honored. Other 4xx responses and invalid JSON aren't retried.
- the User-Agent `JobHacker/0.0.1 (personal job search tool)` (invariant 6). `; +https://jobhacker.space` is added once that domain serves a page

Tests inject a fake `Http`.

**`sources/budget.ts`** checks each metered call against the month's `source_usage` before it's made. A source at its budget is skipped with a warning, and never throws. Every call is counted in `source_usage`, one row per source per day.

## UI

The specs are `docs/reference/UI-KIT.md` and `ui-reference/`, and the reference wins (D84). Since J4 every route sits inside the kit's shell. J5 rebuilt the triage views, and J7 the applications pages.

- **Server and client.** Server components load data through `app/lib/queries.ts` and pass serializable props to client components. Writes go through server actions in `app/lib/actions.ts`, which call core. A tab runs its server actions one at a time, so reads a page makes after it loads (a job's detail, counts, a score run's progress) go through GET route handlers in `app/api/`, which never wait behind a write (D96).
- **Shell** (`src/components/app-shell.tsx`, a client component). The root layout reads the sidebar counts (for `where_default`), the scout card and the user's initials on the server and passes them in. The sidebar is full at 1280px and up, a rail from 768px, and a drawer below 768px, as in the reference's `App.tsx`. On phones the desktop sidebar is unmounted, not hidden, so the drawer's brand-mark gradient id resolves. Server actions that change a count outside triage (prep, the tracker, scout) call `revalidatePath('/', 'layout')`; triage writes don't (D96). The shell also holds the **triage store**: each job's latest status from this tab's triage writes (so a view restored by Back can't show a job that has left it), the time of the last confirmed write (a restored view older than it refreshes), and the counts the open view pushes for its Where. Off the triage views, the sidebar's triage links keep the last view's `where` and `seen`, and the counts are fetched for that Where.
- **Triage views** (J5, D94). `/`, `/new`, `/shortlist` and `/unscored` render `TriagePage` (server), which reads `getTriagePage` → `core/pipeline/triage.ts` and passes serializable rows to `TriageView` (client). A row is the list fields plus the six dimension scores (current scores only: a job whose only score is stale counts as unscored), so the client ranks with `rank.ts` under the weights and bands in the container, which start as the saved ones (J6), and builds Where, Seen and the segments without a request. Rows exclude duplicates, triaged jobs (except on Shortlist) and jobs with an application. The selected job's detail (description, reasons, red flags) loads from `GET /api/job/[id]`. Triage is optimistic: the row leaves, the server action writes the status and a `triage` event, and a failure puts it back. Undo (the toast, or U for the newest action this session) calls `undoTriageAction`, which restores the status and writes an `undo` triage event (`pipeline/review.ts`). The view's counts are recomputed on the client at once and confirmed by `GET /api/triage-counts?where=` a moment later. On Shortlist, S and "Prepare application" run the prep action and open `/applications/[id]`. `/job/[id]` is a deep link that renders the same `JobDetail` at full width (`JobDeepLink`), with History in a header menu.
- **Score runs from the app** (J5, D95). Score next (the Unscored hero) and Score this job (the detail) call a server action that opens a `score` run (`core/pipeline/score-run.ts`, refused while a scout or another batch is live) and returns its id at once. The batch runs on in the server process. After every model attempt it writes `{progress: {done, total, found}, first, jobIds, beatAt}` to the run's `stats`, and the client polls `GET /api/score-run/[id]` every second. A score run with no progress for 15 minutes counts as stopped (its process died); `pnpm cli score` writes the same heartbeat and finishes through `finishWithProgress`, so the progress object stays on the row (J8). Score next puts the view's Where first, or `where_default` on Anywhere.
- **Legacy queue.** `/?view=review` and `/?view=ranked` redirect to `/`, keeping `where` and `seen` (D116). `/?view=new|shortlist|unscored|matches` do the same. `LegacyQueue`, `QueueClient` and `WeightsPanel` stay in the tree and no route renders them. Skipped and archived jobs have no list.
- **Scout card.** `core/pipeline/scout-card.ts` derives `status` (`failed`: the last run failed or never finished within 3 hours; `attention`: board errors, a search-source error, or a source at its monthly budget) and one notice per problem. Run scout calls `runScoutNow`, which opens the run and returns its id (`startScoutRun`, D125). The fetch continues in the server. After every board, and after every score attempt, it writes `{progress: {done, total, found, unit}, beatAt}` (`unit` is `Board` or `Scoring`). The shell polls `GET /api/scout-run/[id]` every second, and toasts when the run it started finishes. A scout started from the CLI shows the same progress through `GET /api/scout-card`. A scout keeps the 3-hour window even though it writes progress. Below the card, "N model calls this month" sums `llm_usage` calls.
- **Command palette and shortcuts** (J8). ⌘K opens the kit's `CommandPalette`. Jobs are the top 40 of the triage queue from `GET /api/palette-jobs` (`core/pipeline/palette.ts`), ranked with the saved weights, or the tune panel's live weights while that panel is dirty. Where is not applied. Choosing a job the current Where would hide sets `where=anywhere` first, and a time filter is dropped so the job is in the list (PLACES § 7, `paletteJobHref`). `?` opens `ShortcutsDialog` with the reference's groups. The sidebar search button opens the palette.
- **Missing database.** Page reads open the database with `fileMustExist` and never create it. If it's missing or won't open, every page shows `DbErrorState`, naming the file and the command to run.
- **Applications** (J7). The three lists render `ApplicationsList` (server) from `getApplicationList`. Which application is in which list is core's `inApplicationList` (D120), and the sidebar counts use the same rule. The workspace page reads `getWorkspace` and renders `ApplicationWorkspace` (client): the kit's `CompanyHeader`, `FillReadiness`, and kit `Tabs` for Apply, Resume, Cover note, Answers and Activity. Cover note, Answers and Activity stay mounted while hidden, so an unsaved edit survives a tab switch. The Apply tab is the kit's `FillReport`, fed by `fillView` from the stored report and the approvals. The Activity tab is the kit's `Timeline`, fed by `activityGroups` (`app/lib/activity.ts`), which titles every event and drops `llm_usage` and unknown types (UI-KIT § Mapping data into kit props). Status changes are a header `DropdownMenu`, and the follow-up date and notes sit beside the timeline. Looks good, Mark submitted and a status change update the screen at once, then `router.refresh()` confirms it.
- **Routes** (J5, J7):
  - `/`: Top matches. `/new`: New today. `/shortlist`. `/unscored`
  - `/job/[id]`: one job (deep link). `/job/[id]/posting` redirects to its posting
  - `/applications`: In progress. `/applications/submitted`: every application past prepped, with its status. `/applications/follow-ups`: follow-ups due by the end of today. `/applications/export` is a CSV download
  - `/applications/[id]`: one application's workspace. `/applications/[id]/resume.pdf` serves its PDF inline
  - `/applications?view=submitted` and `?view=due` (and the old `?due=1`) redirect to the new lists. `/application/[jobId]` redirects to the job's workspace, or to `/job/[jobId]` when it has no application
  - `/companies`: the Company logos page (J10)
  - `/?view=review|ranked`: redirects to `/` (D116)
- **Company logos** (J10). `/companies` lists the logo set, strong before maybe, then by name. Needs a look is `found` or no row yet. Confirmed is `confirmed` and `none`. All is the set. The counter reads "Logos showing: N of M": M is the companies in the current segment except No logo, and N is how many of those reported a loaded tile, once per company. Setup → Company logos, in the sidebar, counts logo-set companies with no domain yet (`getShellCounts().logos`). A `none` row is not that count. Change, and the job detail's logo button ("Change company logo"), open one picker. It calls Brand Search from the browser once on open, with the name filled in, then again as he types (about 200ms). A pick and a typed domain both go through `registrableDomain` before `setCompanyLogo` stores them. Typing also previews the site's own icon, from the homepage's `rel=icon` link, and that URL is what the tile loads (D109). Looks right, No logo, a pick and a typed domain are that one action. Tiles for that company update in the open tab without a reload. The picker and J9's lookup are the only browser calls to Brand Search. Playwright answers both from `tests/e2e/brandfetch.ts`. The app sets no Content-Security-Policy.
- **Company header** (J11, D112, D113). The kit's `CompanyHeader` (`src/components/jobhacker/company-header.tsx`) tops `JobDetail`, so the triage pane, the phone sheet and `/job/[id]` share it. It takes URLs only: `artUrl` (the 128 px icon, `JobSummary.logoUrl`), `coverUrl`, `markUrl` and `wordmarkUrl`. Core's `brandAssetUrl()` (`core/brand/logo-url.ts`) builds the symbol and wordmark URLs. `companyHeaderLogos()` (`core/brand/site-icon.ts`) picks all three from a domain, a source and a `mark_url`, so a `typed` row never reaches the Logo CDN. `headerLogosFor()` in `app/lib/triage.ts` maps a row onto `JobDetailData`. `TriageView` calls it for the selected row before the detail's GET returns. `toDetailData` calls it once the detail is in, and `JobDeepLink` calls it again after a logo edit. Each URL that fails is dropped on its own, inside the header (UI-KIT § Company logos). `tests/e2e/company-header.run.ts` is the acceptance run, on a database copy, through the Brandfetch stand-ins. Those stand-ins answer `type/symbol` and `type/logo` with their own shapes.
- **View state** lives in URL search params. On the triage views: `segment` (Top matches only), `where` (`portland,phoenix,remote`, or `anywhere`; absent means `where_default`) and `seen` (`any`, `24h`, `7d`, `30d`). Changing them rewrites the URL without a navigation (`history.replaceState`), so a copied URL reopens the same view. Density is kept in `localStorage`.
- **Ranking** (J6, D114). `TriageView` holds the weights and bands. The list order, the histogram, the segment counts and each detail score go through `rank.ts` on the dimension scores the row already carries. Moving a slider does not call the model and does not write `criteria.yaml`. Save calls `saveRankingAction`, which writes both through `saveRanking` (D115) and then revalidates the layout. Reset copies the last saved ranking back into that state. The histogram counts every scored row of the view, and is not filtered by Where. The segment counts, and the sidebar's Top matches count, are. While the sliders differ from the saved ranking, `GET /api/triage-counts` includes `w` and `bands`, so the match count on the other views follows too. The open view still pushes its own count at once (D96).
- **Page header.** Every page has a kit `PageHeader`. On Unscored, `UnscoredHero` shows scored, waiting and gated counts; the gated count opens the per-gate lines `pnpm cli funnel` prints (`gateLines` in `pipeline/funnel.ts`).
- **Tokens** come only from `src/app/globals.css`, the kit's file plus two `@source not` lines. Tailwind's default palette is cleared, so only tokens exist (D85). `pnpm palette` checks the kit's pairs. J8 darkened `fg-3`, `fg-4` and `brand` so every pair passes (D126); `KNOWN_FAILS` is empty.

## CLI

From `pnpm cli --help` at J1. Lines marked with a later round don't exist yet.

- **Setup:** `config:check`, `config:migrate` (v1 criteria to v2), `db:migrate`, `db:info` (row counts)
- **Sources:** `companies:add <url>`, `boards:discover --seed <file>`
- **Pipeline:** `scout [--no-score]`, `score [--limit n]`
- **Inspection:** `funnel`, `why <jobId>` (from J3 with a `places:` line: live areas, their evidence, and any difference from `job_areas`), `rank [--n n] [--verdict v] [--where <ids|anywhere>]` (alias `jobs:top`; `--where` defaults to `where_default` and each row prints its areas; a `bands:` line counts every scored job in that Where, including stale scores and jobs that have left triage), `stats`, `logos [--find]` (J9)
- **Applications:** `prep <jobId>`, `chrome`, `apply <jobId>`, `applications:list`, `applications:due`, `applications:status <jobId> <status>`, `applications:export [file]`
- **Profile:** `profile:build`, `profile:check`
- **Maintenance:** `backup`, `places:reclassify` (re-classifies every job and prints all jobs and past-gates counts per area)

## Ops

- **Scheduling.** The scheduled scout uses the launchd template `ops/space.jobhacker.scout.plist`, label `space.jobhacker.scout`. The README has the install steps, with a cron line as the alternative.
- **Logs** go to `data/logs/jobhacker-YYYY-MM-DD.log` as well as stdout. Each CLI run prunes files older than 14 days (`util/logs.ts`). Daily logs from before J2 keep their old name and aren't pruned. The launchd job also appends to `data/logs/launchd.*.log`.
- **Backups.** `pnpm cli backup` copies the database with SQLite's online backup to `data/backups/jobhacker-<timestamp>.db`.
- **The database** is `data/jobhacker.db` (`DATABASE_PATH` overrides it). Opening the default path first finishes the one-time move of the pre-J2 file, with its `-wal` and `-shm` (`util/rename-move.ts`, the only module that names the old paths).

## Errors and logging

- **Speed.** A full scout should finish in under 5 minutes. At J1 it doesn't: boards are fetched one after another, and scoring runs after. The last scouts of 336 boards took 336–389 seconds without scoring (runs 52 and 57) and 907–1,050 seconds with 150 new scores (runs 53–55). There's no per-board timeout beyond the 15-second request timeout, and no parallelism across hosts yet. The run records its start and finish, and `pnpm cli stats` shows the time.
- One bad board or one bad job never aborts a run. Errors are collected into `runs.stats.errors`.
- **Visible failures.** The UI header shows the last scout run. From J4, a failed run and a source at its budget show in the UI. The scheduled scout runs unattended, so a log line alone isn't enough.
- The CLI exits with code 1 when the run couldn't start (bad config, a database that isn't migrated, a model client that can't be created), or when every board failed and no search ran.
- Logs are JSON, with a pretty mode when `JOBHACKER_PRETTY_LOGS` is set. Never log profile contents, cover notes, prompts or keys at info level.

## Testing

| Layer | How |
|---|---|
| Sources | Parsing and normalizing against recorded fixtures in `tests/fixtures/` |
| Gates, places, rank | Table-driven unit tests over pure functions |
| Score and prep | `FakeLlm`, plus grounding tests with deliberately bad output |
| DB | A real SQLite file per test, with migrations applied |
| Apply | Unit tests for mapping and self-ID. `fill.browser.test.ts` runs headless Chrome against saved form HTML in `tests/fixtures/forms/`, asserting what's filled and that nothing submitted; it's skipped when Chrome isn't installed |
| UI | `src/app/design-tokens.test.ts` runs UI-KIT § Checks 1, 3 and 9 (direct imports); `src/app/lib/palette.test.ts` the contrast table. Screenshots with `pnpm shoot`, which also fails on any console or page error, compared with the reference frames (AGENTS § Definition of done). From J9, Brandfetch's hosts are routed to local stand-ins (UI-KIT § Checks) |
| Docs | `pnpm docs:check` |

## .gitignore essentials

- `config/*.yaml` and `config/*.md`, but not the example files
- `data/`, `input/` and `output/`
- `.env` and `.env.*`, but not `.env.example`
- `node_modules/`, `.next/`, `.next-shoot/`, `coverage/`
- `docs/testing/screenshots/`
