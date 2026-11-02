# AGENTS.md — JobHacker

JobHacker is a personal job-search tool. It runs on your Mac. It pulls postings from hundreds of company job boards and a licensed search API, ranks them against what you want, prepares tailored application materials grounded in your real history, and fills application forms in your own Chrome. **You** review each form and click submit.

What it's for, in numbers: about 10 minutes a day to triage new jobs, and under 5 minutes per application from shortlist to submitted. Every change should move the tool toward those numbers, or at least keep it there.

It was built by AI coding agents, one round at a time, against the rules below. "Kris" in comments and docs is the original user. Ids like J5 (a round) and D62 (a decision) point to planning docs kept in the private repo; the code and the docs here are complete without them.

## Read first

1. This file, all of it.
2. `README.md`: setup, the daily workflow and the commands.
3. `docs/ARCHITECTURE.md`: the sections your change touches.
4. `docs/reference/`: `SOURCES.md` (where job data may come from), `PLACES.md` (the Where filter), `UI-KIT.md` (the design system and its checks).

Then read the existing code your change touches before proposing anything. Don't assume what's there.

## Invariants

These are non-negotiable for agents.

1. **Never submit an application.**
 - No code path may click a submit, apply or send button, call `form.submit()`, or press Enter in a form.
 - All browser actions go through `SafePage` (ARCHITECTURE § Apply).
 - A guard test in `pnpm check` fails if any file under `src/core/apply/` other than `safe-page.ts` and `browser.ts` contains any of these: `.click(`, `.press(`, `.submit(`, `.requestSubmit(`, `keyboard.`
 - Fixture tests count the submits on the page, and the count must be zero.
 - The user submits.
2. **No bot-evasion, and no scraping.**
 - Never use stealth plugins, fingerprint spoofing, CAPTCHA solving, proxy rotation or user-agent faking. Never scrape the HTML of LinkedIn, Indeed, Glassdoor or any other site.
 - Job data comes only from the sources in `docs/reference/SOURCES.md`: public ATS JSON endpoints, free job feeds, and licensed search or aggregator APIs called with the user's own key.
 - A licensed aggregator whose index includes LinkedIn or Indeed postings is allowed. Paying a vendor for its data isn't scraping.
 - The Workday career-site JSON endpoint is the one approved exception. It's undocumented, but it's unauthenticated and serves public listings. Don't generalize from it to any other site's internal API.
 - A new source needs a row in SOURCES.md.
3. **Never invent facts about the user.**
 - Resume bullets, cover notes, answers and form values come from `config/profile.yaml` and from what the user writes in the app.
 - An answer the user approves or edits in the workspace holds for that one application. It becomes a profile fact only when they add it to `profile.yaml` themselves.
 - Every tailored resume bullet carries the `id` of its source bullet, and `grounding.ts` rejects output that fails its checks.
 - When information is missing, leave a visible `[NEEDS INPUT: …]` marker, or leave the field blank and flag it in the fill report. Never guess.
 - This applies to docs and config too. Something about the user's situation or preferences that they didn't say doesn't go into any file.
4. **Personal data stays local.**
 - Real `config/*.yaml`, `config/preferences.md`, `.env`, `input/`, `data/` and `output/` are gitignored.
 - Never log profile contents, API keys or full prompts at info level.
 - Never paste contact details, self-identification answers or keys into a doc or a commit. Screenshots go in `docs/testing/screenshots/`, which is gitignored because they can show personal data.
 - Test fixtures, example configs and the `ui-reference/` sample data use a fictional candidate, Kris Tester, with placeholder links. Keep them fictional.
5. **Model output is untrusted input.** Parse every response with a Zod schema. On a parse failure, retry once, then record the error. Never coerce or guess.
6. **Be a polite client.**
 - At most 1 request per second per host.
 - Back off and retry on 429 and 5xx: at most 3 tries, honoring `Retry-After`.
 - Send an honest User-Agent: `JobHacker/<version> (personal job search tool)`.
 - Metered sources are budgeted as well as rate-limited. Respect each vendor's rate limit, count every call against that source's monthly budget in `criteria.yaml`, and stop calling a source once it reaches its budget rather than run into overage.
 - **Brandfetch from the browser.** Logos and company searches that the user's browser loads from Brandfetch's Logo CDN and Brand Search are page loads, not JobHacker's requests, and Brandfetch requires them to come from the browser. They follow the limits in `docs/reference/SOURCES.md` § Brand data instead of this invariant's rate and budget rules. Everything JobHacker's own code requests follows this invariant in full.
7. **Self-identification fields are filled from `profile.yaml`, never inferred.**
 - EEO and voluntary self-identification fields (gender, race/ethnicity, veteran status, disability status) are filled from the `self_identification` block in `config/profile.yaml`, exactly as written.
 - The model never sees these fields. They're left out of the field-mapping request and filled afterwards by a deterministic mapper. Nothing may derive a value for them from a name, the resume, or anything else.
 - If a field has no configured answer, select the form's decline option if it has one. Otherwise leave the field blank and list it in the fill report.
8. **No job is ever silently dropped.**
 - The only hard gates are closed, duplicate, blocklisted company, and older than `max_age_days`. Everything else is a scored dimension or a view filter: title, location, seniority, employment type and pay.
 - **Where** (the places in `criteria.yaml`, plus Remote) is a view filter.
 - It never takes a job out of what's stored, deduped, scored or counted.
 - It decides only what a view shows, and which jobs a scoring batch takes first.
 - Every job keeps a record of its gate result, prescore and dimension scores, and every exclusion shows up with a count in the funnel.
 - Don't add a hard filter. If something seems to need one, it's a dimension, a weight or a view filter.

**Changing an invariant.** Never work around an invariant, quietly reinterpret one, or disable a guard that enforces one. If one looks wrong or is blocking real work, stop, say so plainly, and say what you'd change it to.

## Standing rules

- **Spending.**
 - Never sign up for a paid plan, enter payment details, or raise a budget or cap.
 - Model calls within the per-run cap (`budget.max_new_scores_per_run`) are normal work.
- **The user's data.**
 - Move, never recreate or delete: the database, the Chrome profile, config files and `output/`.
 - Before anything that changes existing rows, paste row counts before and after.
 - Anything that deletes data or can't be undone needs the user's OK first. That includes dropping a column or table, deleting rows, and removing a board or a config key.
- **Git.** Never rewrite history or force-push.
- **Asking.** If something affects what goes on an application or into the user's config, ask instead of guessing. Anything else: take the simplest reading, say what you chose, and keep going.

## How to work

- **Dependencies.** Add one only if the change needs it, with a one-line reason. UI work uses only what the kit uses.
- **TypeScript.**
 - Strict mode. No `any`, no `@ts-ignore`, no `!` to silence the checker.
 - Prefer small pure functions. Core functions take their dependencies (`db`, `llm`, `http`, `clock`, `log`) as parameters so they can be tested.
- **Layering.**
 - `src/core` never imports from `src/app` or `src/cli`. The UI and the CLI are thin layers over core.
 - The kit components in `src/components/jobhacker/` are presentational. Props go in; they don't fetch data or call server actions.
- **Tests.**
 - Tests live next to the code as `*.test.ts`.
 - Sources are tested against recorded fixtures in `tests/fixtures/`, and the model with `FakeLlm`.
 - Tests never hit the network or a paid API.
- **Verify by running.** Pasted command output is evidence. Reading the code isn't.
- **Numbers, not adjectives.** "Boards 5 → 336, scout yields 11,374 postings in 4m18s" is a result. "Significantly improved coverage" isn't.
- **UI changes.** Screenshot every route you touched at 1440×900, 1024×768 and 390×844 (`pnpm shoot`), read the screenshots back yourself, and compare them with the reference frames in `ui-reference/screens/`. Run the checks in `docs/reference/UI-KIT.md` § Checks.

## Commands

| Command | What it does |
|---|---|
| `pnpm install` | Install |
| `pnpm check` | Typecheck, Biome and Vitest. Must be green |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | One part of `pnpm check` on its own: `tsc --noEmit`, `biome check .`, `vitest run` |
| `pnpm build` | Next.js production build |
| `pnpm dev` | The app at http://localhost:3000 |
| `pnpm start` | Serve the production build |
| `pnpm cli <command>` | A CLI command, e.g. `pnpm cli scout` or `pnpm cli funnel` |
| `pnpm cli stats` | The usefulness snapshot (see below) |
| `pnpm db:generate` / `pnpm db:migrate` | Create / apply Drizzle migrations |
| `pnpm shoot --round <id>` | Build, serve and screenshot the UI into `docs/testing/screenshots/<id>/` (`scripts/shoot.ts`) |
| `pnpm palette` | Print the contrast table for the color tokens in `globals.css`. The same checks run in `pnpm check` |

The checks in these docs use ripgrep (`rg`). If it isn't installed, run the same pattern with `git grep -nE`.

### The usefulness snapshot

`pnpm cli stats` is read-only. It makes no network or model calls. Run it before and after a change, so it's visible when a change passed its tests but made the tool worse.

| Line | Contents |
|---|---|
| `jobs` | total · past the gates · gated, broken down by gate |
| `boards` | active boards, by ATS |
| `scout` | the last run: when, how long, boards ok · failed, error count |
| `new` | jobs first seen in the last 24 hours |
| `search` | canonical jobs that came only from search sources: what search adds beyond the boards |
| `scored` | scored under the current cache key · stale (scored under an older key) · unscored |
| `matches` | strong · maybe · weak under the saved weights |
| `where` | a count per place · remote · elsewhere |
| `in where` | strong · maybe within `where_default` |
| `logos` | of the logo set: how many companies have a domain, and how many of those are confirmed |
| `apply` | prepared · filled · submitted · follow-ups due |
| `fill` | across the last 10 fill reports, per ATS: the % of fields filled and the number of forms. Then, in total: need review, blank, self-ID set |
| `time` | median minutes from shortlisted to marked submitted, over the last 10 submissions, with how many there were |
| `spend` | this month: model calls and estimated USD; each metered source's calls against its budget |
