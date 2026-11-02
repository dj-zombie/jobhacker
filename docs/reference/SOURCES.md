# Sources

Where job data may come from, and how each source works. This is the list that AGENTS.md invariant 2 refers to. A source that isn't listed here needs Kris's approval, and a row in this file recording its auth model and terms. It also covers the one source of brand data, Brandfetch, in § Brand data.

ARCHITECTURE § Sources says which of these are actually built.

Prices and terms were taken from each vendor's public pages on 2026-10-23. Check them again before paying for anything. Most vendor terms restrict *redistribution*, not personal use, and a single-user job search is normally fine.

## The line

- **Allowed:**
  - public ATS JSON endpoints
  - free job feeds
  - licensed search or aggregator APIs, called with Kris's own key

  An aggregator whose index includes LinkedIn or Indeed postings is allowed: paying a vendor for its data isn't scraping.
- **Not allowed:**
  - scraping any site's HTML
  - stealth plugins, fingerprint spoofing, CAPTCHA solving, proxy rotation, or faking the user-agent
  - auto-submitting through LinkedIn Easy Apply

  This line is settled.
- **Filling forms in Kris's own Chrome**, signed in as himself, at human speed, with Kris reading the form and clicking submit, is not evasion. It's Kris using a tool.

## LinkedIn and Indeed

- **LinkedIn's job data can't be bought by an individual, at any price.** It sits behind partner-gated Talent Solutions. The published Job Posting API is for ATSs pushing jobs *into* LinkedIn, not for reading them out.
- **Indeed's Publisher API is gone.** It was deprecated in 2023 and stopped responding in 2024.
- **Google for Jobs** indexes LinkedIn, Indeed, Glassdoor and most ATSs, and several vendors sell that search as an API (below). That's the legitimate route to discovering those postings. Kris then applies at the source, usually the company's own ATS form.

## Board sources: one employer per call

| ATS | Auth | Endpoint pattern |
|---|---|---|
| Greenhouse | none | `boards-api.greenhouse.io/v1/boards/<token>/jobs?content=true` |
| Lever | none | `api.lever.co/v0/postings/<company>?mode=json` |
| Ashby | none | `api.ashbyhq.com/posting-api/job-board/<token>?includeCompensation=true` |
| SmartRecruiters | none | Public Posting API, per company |
| Breezy | none | Public JSON feed, per account |
| Polymer | none | Public JSON feed, per account |
| Workable | per-account key | Job Board API |
| Teamtailor | per-tenant key | JSON:API. Some career sites expose a keyless feed |
| **Workday** | none | `/wday/cxs/<tenant>/<site>/jobs`. **The one approved exception (D62)** |

**Workday:**
- **Why it's allowed.** Workday has no published job API. Its public career sites are React frontends that call an unauthenticated JSON endpoint to render public listings. Using that endpoint is approved because it's unauthenticated, it serves public data, and it's called politely at 1 request per second.
- **The catch.** It's an internal endpoint. It can change shape without notice, and no terms grant its use. So an adapter for it must tolerate schema changes and fail soft.
- **Don't generalize from it** to any other site's internal API.
- **It matters for Portland:** Nike and Intel hire through Workday.
- **Status:** a backlog item.

**Gated, with no public feed:** iCIMS, SuccessFactors, Taleo, Jobvite, BambooHR, Personio. Don't build adapters for these expecting a published API.

## Search sources: many employers per call, metered

| Source | What it is | Price | Free tier |
|---|---|---|---|
| **JSearch** (OpenWeb Ninja) | Google for Jobs as an API | $25/mo for 10k requests, up to $150/mo for 200k | 200 requests/mo, no card |
| SerpApi | Google Jobs results | from $25/mo for 1,000 searches | 250 searches/mo |
| DataForSEO | Google Jobs | pay as you go | — |
| **HN "Who's Hiring"** | Algolia HN API, the monthly thread's top-level comments | free | — |

**Aggregators** come pre-deduplicated across many boards. They're options, and none is built:

| Provider | Coverage | Price | Free tier |
|---|---|---|---|
| JobsPipe | 30+ sources, including LinkedIn, Indeed, Workday, Greenhouse and Lever | $49/mo for 25k jobs | 1,000 credits |
| TheirStack | 225M records, ~305k a day | from $49/mo | 50 company + 200 API credits/mo |
| Fantastic.jobs | 200k+ career sites | $95/mo for 20k, up to $900/mo for 500k | 7-day trial |
| JobDataLake | 1.8M+ jobs, 25k+ companies | $50 for 100k credits | 1,000 credits |
| Techmap | 451M+ since 2020 | $1 per 1,000 postings | 1,000/mo |
| Coresignal | 482M+ postings | $49/mo up to $5,000/mo | 7-day trial |
| Adzuna | its own listings, per country | free tier, 2,500 calls/mo | yes; commercial use needs a licence |

**Free feeds** are keyless and low in volume: Himalayas, Remotive (24 hours delayed), and USAJOBS (needs a free key).

## Recommended

1. **Every board source, plus discovery.** They're free, and they're the best data: structured, with full descriptions and a real apply URL that can be filled.
2. **JSearch.** Start on the free tier. The $25/mo plan is Kris's call, and **nobody signs up on his behalf**.
3. **One aggregator** only if those two aren't enough. JobsPipe is the obvious first choice. Use up its free credits first.

## Rules for every source

- **Keys** live in `.env`, never in YAML. Per-source settings live in the `sources:` block of `criteria.yaml`.
- **Budgets** (invariant 6):
  - Every metered call goes through `sources/budget.ts`, and every call writes a `source_usage` row.
  - Before each call, `budget.ts` checks the month's usage against that source's `monthly_call_budget`.
  - A source at its budget is skipped, with a warning shown in the UI. It never causes overage, and never fails the run.
- **Dedupe across sources:**
  - Normalize company names (strip Inc, LLC, Ltd, punctuation and case) before hashing.
  - When duplicates differ in `source_quality`, the highest-quality record wins, and the others get `duplicate_of`. The ATS copy has the real apply URL and the full description.
  - A search-sourced job whose ATS twin appears later is superseded by the twin.
- **`source_quality`:** `high` for ATS boards, `medium` for aggregators and search, `low` for HN and the free feeds.

## Discovery

`pnpm cli boards:discover --seed resources/seeds/<file>.txt` (committed seed lists live in `resources/seeds/`, D48):
1. Slugifies each company name.
2. Probes every board ATS at 1 request per second.
3. Verifies that the board responds.
4. Caches the misses, so probes don't repeat.
5. Appends each found board as active.

Seed lists cover game studios, audio and music tech, creative and developer tools, the general remote senior frontend long tail, and, from J3, local Portland and Phoenix employers (PLACES § 8).

## Query generation

`sources/query-gen.ts` derives search queries from `preferences.md`, so changing the preferences changes the queries on the next run. From J3, the queries also run per place in `where_default`, within the same monthly budget (PLACES § 8).

## Brand data

Brandfetch is the one source of brand data: company logos (J9 and J10), and the art in the job detail's header (J11). It isn't a job source. Kris picked it on 2026-10-25.

The rules and limits below were taken from Brandfetch's docs and pricing page on 2026-10-25. Check them again before changing how JobHacker uses it.

| Product | Called from | Auth | Free allowance | Used for |
|---|---|---|---|---|
| **Logo CDN**, `cdn.brandfetch.io` | Kris's browser, as `<img>` tags | The client ID, in `?c=` (`BRANDFETCH_CLIENT_ID`) | 1,000,000 requests a month, a soft cap. At most 1,000 requests per 5 minutes per IP, and 2,400 per customer | Logo tiles (J9), and the header's art, symbol and wordmark (J11) |
| **Brand Search**, `api.brandfetch.io/v2/search/<name>` | Kris's browser: the triage lookup (J9) and the logo picker (J10) | The same client ID | 500,000 requests a month, a soft cap. At most 200 requests per 5 minutes per IP | A domain the job text didn't name (J9), and picking one (J10) |
| **Brand API**, `api.brandfetch.io/v2/brands/domain/<domain>` | Not used yet | An API key, sent as a Bearer token, from Brandfetch's developer dashboard. It's separate from the client ID | 100 fetches **in total** on the free plan, not per month | Real banner images, a backlog item (ROADMAP § Backlog) |

**Rules:**
- **Logos are hotlinked, never stored.** Brandfetch requires logo URLs to be embedded directly in pages. It doesn't allow downloading, caching, proxying or any other programmatic access to logo images, and may block it. So logos load through plain `<img>` tags in the page: no server route, no `next/image` optimizer, and no files under `data/`.
- **The Referer must reach Brandfetch.** Logo requests need a `Referer` with the page's origin, under one of these policies: `origin`, `origin-when-cross-origin`, `strict-origin`, `strict-origin-when-cross-origin` (the browser's default) or `unsafe-url`. Never `no-referrer`.
- **Automation never calls Brandfetch.** Brandfetch refuses requests that look programmatic, with a `302` and `x-bf-error: automated_traffic`, even with a valid client ID. Tests, screenshots and checks route its hosts to local stand-ins instead (UI-KIT § Checks). Never change the User-Agent, or anything else, to get past a refusal (invariant 2).
- **Kris's browser makes these requests, not JobHacker's code.** So the Logo CDN and Brand Search follow the limits above, not invariant 6's per-host rate and monthly budget. Invariant 6 says so.
- **Brand Search stays in the browser.** J10's picker is an autocomplete Kris drives, debounced between keystrokes, for at most 5 results. J9 also calls it, one company at a time and at least 1.6 seconds apart, for logo-set companies the job text didn't name. It keeps the domain and brand id only when one result's name is the company and the domain matches that name. A tie stays a monogram. Icon URLs expire within 24 hours, so they are never stored. Don't show Brandfetch's `claimed` or `verified` flags. Automated runs don't call it.
- **A company Brandfetch doesn't know:** with `fallback/404` in a logo URL, the CDN answers with an empty `404`, and the kit draws its monogram. Without it, the CDN answers `200` with a placeholder, transparent for an unknown domain, which looks like an empty tile.
- **A domain Kris types** (J10, D109) is not drawn from Brandfetch. His browser fetches that site's homepage and the tile hotlinks its `rel=icon` link. Images in the page body are ignored. The stored icon URL has to be https on that same registrable domain. The server does not fetch the site. A site that won't answer stays a letter.
- **Most refusals name their reason** in an `x-bf-error` header, for example `hotlink_blocked`, `automated_traffic`, `quota_exceeded` or `client_id_invalid_signature`. A `429` for going over a per-IP or per-customer limit carries none.
- **The client ID isn't a secret to Brandfetch:** it's in every logo URL the browser loads. It still lives only in `.env`, like a key (invariant 4), and never goes into git, docs, logs or STATUS.
- **Nothing about Kris is sent:** only company names, in searches, and domains.
- **No attribution is required.** Showing a logo to identify the company it belongs to is the fair use Brandfetch describes.
- **The Brand API, for later:** Brandfetch's terms license what it returns for 30 days at most, and its images must be hotlinked, never downloaded.

Brandfetch's docs: [Logo API](https://docs.brandfetch.com/logo-api/overview), [its parameters](https://docs.brandfetch.com/logo-api/parameters), [Brand Search API](https://docs.brandfetch.com/brand-search-api/overview), [Brand API](https://docs.brandfetch.com/brand-api/overview), and [pricing](https://brandfetch.com/developers/pricing).
