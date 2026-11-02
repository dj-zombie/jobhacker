# Places: Portland, Phoenix, Remote

The spec for where jobs are. **J3** builds the backend (§ 1–6 and § 8), and **J5** builds the UI (§ 7).

The example config names two places, **Portland, Oregon** and **Phoenix, Arizona**, plus **Remote in the US**. Every user names their own in `criteria.yaml`. So JobHacker needs:
- named places in config
- a tested classifier that tags each job with the places it's in
- a **Where** filter in the UI
- scoring that spends model calls on those places first
- preferences and profile answers that say all this correctly

## 1. Preferences and profile answers

`preferences.md` says in the user's own words how each place fits, for example:

```markdown
- Portland: on-site, hybrid and remote are all fine.
- Phoenix: hybrid or remote.
- Remote: anywhere in the US.
- Any other city: fully remote only.
```

Never write a line about relocating, or about where the user lives, that they didn't say (invariant 3).

In `profile.yaml` → `standard_answers`, `willing_to_relocate` and `current_location` are the user's own answers. `current_location` is copied verbatim from the profile's contact location, so the form answer matches the rest of the application (invariant 3). The example file uses `"[NEEDS INPUT]"` and `"City, ST"`.

## 2. Config: `criteria.yaml`

```yaml
# Your places: example metros, replace them with your own. The Where filter and the scoring
# order read these. This is geography, not taste: it's parsed as city and state, never
# substring-matched. An optional `note:` shows as a hint next to the filter.
places:
  - id: portland
    label: Portland
    cities: [Portland, Beaverton, Hillsboro, Tigard, Tualatin, Lake Oswego, Wilsonville, Gresham,
             Milwaukie, Happy Valley, Oregon City, West Linn, Sherwood, Clackamas, Forest Grove]
    states: [OR, Oregon]
    extra: ["Vancouver, WA", "Camas, WA", "Washougal, WA"]   # the metro across the river
    aliases: ["Greater Portland", "Portland Metro", "Portland Metropolitan"]
  - id: phoenix
    label: Phoenix
    cities: [Phoenix, Scottsdale, Tempe, Mesa, Chandler, Gilbert, Glendale, Peoria, Surprise,
             Goodyear, Avondale, Queen Creek, Paradise Valley, Fountain Hills, Cave Creek, Buckeye,
             Casa Grande]
    states: [AZ, Arizona]
    aliases: ["Greater Phoenix", "Phoenix Metro", "Phoenix Metropolitan", "Valley of the Sun"]
remote:
  countries: [US]          # remote roles open to these countries, or naming none, count as Remote
where_default: [portland, phoenix, remote]
```

Give the block a Zod schema and add it to `criteria.example.yaml`, like every other config section.

**Remove `hard_gates.countries`** if it's there. Applied as a gate, it's a fifth gate, which invariant 8 doesn't allow, and `remote.countries` above replaces it. Jobs it used to gate become visible under **Anywhere** and get scored last (§ 6), so they cost nothing until the in-place jobs are done.

## 3. The classifier

Port `ui-reference/prototype-src/src/core-ports/places.ts` to `src/core/pipeline/places.ts` **unchanged**, along with `places.test.ts`. The test file has 54 cases, most of them real location strings from public postings on 2026-10-24, and all of them pass. The rules, all covered by the tests:

- **Splitting.** Location text is split into entries on `;`, `|`, `/`, `•`, newlines, and the lowercase words " or " and " and ". The state code `OR` survives because only the lowercase word splits.
- **Whole names.** Each entry is parsed as city and state and compared on whole names:
  - "Costa Mesa, CA" isn't Mesa.
  - "Glendale, CA" and "Portland, ME" don't match.
  - "Vancouver, WA" is Portland. "Vancouver, BC" isn't.
- **A remote entry ignores the city in it.** Speechify posts one remote role as "Albuquerque, NM, USA Remote", "Tempe, USA Remote" and hundreds more. Those are Remote, not Phoenix.
- **Remote limited to certain states counts only for places in those states.** Fictiv's "Open to remote in CA, OR, WA" counts as Portland, not Remote, because it can't be taken from Arizona.
- **Abroad.** Non-US markers exclude an entry: countries, Canadian provinces, EMEA and LATAM, big foreign cities. "New Mexico" isn't Mexico.
- **ATS remote flag.** If the ATS says remote and nothing points abroad, the job counts as Remote. That covers Linear's "North America" and Elastic's "United States".
- **Titles.** The title is read only when the location is empty, for postings like "Senior Software Engineer (Portland)".
- **Company names are never read.** A Toronto company called Phoenix, posting "Senior Frontend Developer (React)", isn't in Phoenix.

It returns `{ areas, evidence, remoteStates? }`. `evidence` is the text that matched, for the "why" view.

**J3's rule fixes.** The hand-check on the real database (STATUS, J3 build) found 14 misfiled location strings. Each became a test case first, and `places.test.ts` now has 75. The fixes, all general rules:
- A lone state with a country, like "Arizona, United States", is that state's place.
- Remote limited by a parenthesised list ending "only", like "Remote (Washington, Oregon, Idaho only)", or by "residing in" / "residents" / "located in", counts only for places in those states. A parenthesis that names the US, like "Remote (US Only)" or "REMOTE (US or Canada)", is still Remote.
- A comma list of three or more states with a remote entry ("Remote, AR, AZ, FL, …") is state-limited remote, unless the text says "preferred".

`ui-reference/prototype-src/src/core-ports/places.ts` predates these fixes; the repo's copy is the one that's current.

## 4. Storage

- **`job_areas`**: a new table with columns `(job_id, area)`, a primary key on both, and an index on `area`. A join table keeps the filter a plain indexed SQL query.
- **Scout** classifies every job after the dedupe step and writes the rows that changed (`applyAreas` in `pipeline/areas.ts`). It runs there rather than in `normalize`, so jobs from every source, and jobs the scout didn't see this run, are classified the same way.
- **Reconcile.** The readers that already re-apply gates and prescores before they read (`score`, `rank`, `funnel`, `why`, the app's queue) re-apply places too, when the job count, the last-seen time or the `places` config has changed (ARCHITECTURE § Pipeline).
- **`pnpm cli places:reclassify`** recomputes the areas of every job and prints the counts per area. Run it after the migration, and again whenever the `places` config changes.

## 5. A view filter, never a gate

This is invariant 8, and it isn't optional. A job in Lisbon is still stored, deduped, counted and visible under **Anywhere**. Where only decides what the current view shows.

If you catch yourself adding `areas` to the gate step or to the scout's skip logic, stop.

## 6. Scoring

- **Order.** Scoring takes unscored and stale jobs in Kris's places first, then the rest, by prescore within each group. Which places count as first depends on the caller:
  - **`pnpm cli score`, and the scheduled scout's scoring step:** the places in `where_default`.
  - **The UI's Score next button:** the places in the view's current Where, so that scoring from a Phoenix-only view scores Phoenix first. Under Anywhere, it uses `where_default`. The prototype does the same.

  With about 10,000 jobs waiting, calls go to jobs Kris could take before jobs he couldn't. This replaces the old prescore-only order.

  Ordering never skips a job. It only decides which jobs a capped batch takes first (invariant 8).
- **`prescore_floor`** applies the same way inside and outside the places. J3 reports how many unscored jobs sit below it, per area. If many in-place jobs are stuck there, that goes to Kris under Open questions; don't change the floor yourself.
- **Prompt.** Pass the job's places to the scorer as a fact, for example:
  - `Location classified as: Portland area (matched "Portland, OR")`
  - `Location classified as: Remote (US)`
  - `Location classified as: none of the candidate's places ("Toronto, ON")` (the prompt calls Kris "the candidate", and never names him)

  That way the logistics score follows the same geography as the filter. Bump `rubric_version`.
- **One re-score, not two.**
  - `preferences.md` is part of the score cache key (D30). So § 1 and the prompt change ship in the same round, and every scored job is re-scored once.
  - Stale jobs (those scored under an older key) must be picked up by scoring the same way unscored ones are. If the code skips them today, fix that; it's D30 working as intended.
- **Cost.**
  - Before the re-score, estimate its cost from recent `llm_usage`: stale jobs × the average cost per scoring call.
  - Run the re-score in batches within the per-run cap.

## 7. UI (built in J5)

- **Components.** `PlaceFilter` and `PlaceChip` from the kit, plus `JobSummary.place`: the job's first non-remote area, with its label.
- **URL.** Where is a URL param, `?where=portland,phoenix,remote` or `?where=anywhere`. It defaults to `where_default`.
- **Counts.** Each place shows its count within the current view. The sidebar counts respect Where too.
- **Empty states** name what's hidden, for example "No matches in Portland, Phoenix or remote yet", and offer **Look anywhere**. Never show "Everything is scored" when the filter is hiding jobs.
- **⌘K.** Selecting a job from ⌘K that the current Where would hide switches to Anywhere first.

## 8. Sourcing: the filter only shows what the scout finds

A search of public boards on 2026-10-24 found only a handful of Portland and Phoenix roles. Most results were remote roles at companies based elsewhere. The 336 boards lean toward remote-first and Bay Area companies, so local employers have to be added deliberately.

1. **Search queries per place.**
   - If the JSearch adapter is enabled, its generated title queries also run with `location: "Portland, OR"` and `location: "Phoenix, AZ"`, as well as remote.
   - Google for Jobs indexes local employers whatever ATS they use, including the big Workday ones that board adapters can't reach.
   - **Keep within the existing monthly budget** by splitting it across remote and the places. Don't raise the budget.
2. **Seed board discovery with local companies.** Create `resources/seeds/local.txt` (committed seed lists live there, D48; `data/` is gitignored) and let `boards:discover` find out which ones have public Greenhouse, Lever, Ashby or other supported boards. These are candidates, not verified boards; discovery confirms them.
   - **Portland area:** Panthalassa, Smarsh, Fictiv (Portland office), New Relic, Vacasa, Jama Software, Expensify, Airship, CrowdStreet, Instrument, Laika.
   - **Phoenix area:** SmartRent, GoDaddy, Carvana, Axon, Offerpad, Nextiva, WebPT.
   - Nike and Intel, the big local employers, use Workday. They can only be reached through a Workday adapter (D62, a backlog item) or through JSearch.

## Sources for the test fixtures

- [Fictiv](https://job-boards.greenhouse.io/fictiv/jobs/8715125002)
- [Panthalassa](https://job-boards.greenhouse.io/panthalassa)
- [SmartRent](https://job-boards.greenhouse.io/smartrent)
- [Smarsh](https://jobs.lever.co/smarsh/31c21dac-c6b2-44ff-8d1c-074ce7cd4f3c)
- [Speechify](https://job-boards.greenhouse.io/speechify/jobs/5671733004)
- [Phoenix (Toronto)](https://jobs.ashbyhq.com/phoenix/71b5c893-46f6-4f51-818f-89cfd50bbef4)
