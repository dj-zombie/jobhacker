# UI kit and reference

The spec for every UI round from J4 on: what the reference is, how its kit moves into the Next.js app, and the checks every UI round must pass.

## The reference is the spec

A written design brief was turned into a UI that Kris couldn't tell apart from the old one, twice. So the UI isn't specified by a description anymore. It's specified by a **working reference**:

- **`ui-reference/prototype.html`** is the redesigned app, running with a sample of Kris's real jobs. Open it in any browser and use it. It's also published as the "JobHacker" artifact.
- **`ui-reference/prototype-src/`** is its source, a small Vite project.
  - Everything under `src/kit/` is **production code** that you copy into the app.
  - Everything under `src/demo/` shows how the pieces are wired: state, keyboard, triage flow, undo, live tuning and the application workspace.
- **`ui-reference/screens/`** holds frames of the prototype, for side-by-side comparison. Each round lists the frames it's compared with.
  - **Names** are the view's number, the view, and the width: `09-unscored-1440.png`, `09-unscored-1024.png`, `09-unscored-390.png`. The phone flow (`18`–`21`) is 390 wide.
  - **Coverage.** Every main view has a frame at all three widths. States that exist only at one width, like `12` (scrolled) and `13` (after approving), are 1440 only.
  - **Missing a frame?** If you need a view, state or size that has no frame, shoot the prototype yourself (AGENTS § Definition of done).

**Rules of precedence:**
- **On look and interaction**, when the docs and the reference disagree, the reference wins. That covers layout, styling, motion and keys.
- **On data and behavior**, the docs win: what's stored, scored or counted, and every number on screen. The prototype's numbers, weights and labels like "Score next 150" are sample data.
- **When the reference and Kris disagree, Kris wins.** Update the reference first, then build.
- Kris signs off on the prototype before J4 starts (J4 § Before this round starts). Changes to the look always go into the prototype first (UI-KIT § Changing the look).

## What was verified, and what wasn't

Verified by running it in the prototype project:
- Strict TypeScript (`strict`, `noUncheckedIndexedAccess`, no unused code) passes with React 19, and Biome's recommended rules pass on the kit.
- The production build works with Tailwind 4.3 and Vite 8.
- There are no console errors in any view at 1440, 1024 or 390 wide.
- The list is virtualized at 11,000 rows. About 30 rows are in the DOM, and a two-second scroll held 16.7ms per frame at the 95th percentile in headless Chromium.

**Not verified:** running inside the Next.js app. J4's first job is to prove that. The kit imports `next/link` and uses `"use client"` where it's needed, but nothing has run against the real layout yet.

## Dependencies

These are the versions the kit was built and tested with. The earlier design-system round may have installed some of them already.

```bash
pnpm add motion@^14.6.0 lucide-react@^1.61.0 clsx@^2.1.1 tailwind-merge@^3.7.0 \
  @tanstack/react-virtual@^3.14.22 sonner@^2.0.8 cmdk@^1.1.1 \
  @radix-ui/react-dialog@^1.3.1 @radix-ui/react-tabs@^1.2.1 @radix-ui/react-tooltip@^1.4.1 \
  @radix-ui/react-dropdown-menu@^2.2.1 @radix-ui/react-slider@^1.6.1 @radix-ui/react-slot@^1.5.0 \
  class-variance-authority@^0.7.1 geist@^1.8.2
```

The kit needs Tailwind v4, because it uses `@theme`, `@utility` and the built-in container queries. It was built on 4.3.

## Files

| From `ui-reference/prototype-src/src/kit/` | To | What it is |
|---|---|---|
| `styles/globals.css` | `src/app/globals.css` (replaces it) | Every token, in Tailwind v4 `@theme`. Also: shadcn names mapped onto them, the base layer, utilities |
| `lib/utils.ts`, `lib/format.ts` | `src/lib/` | `cn()`, plus number and age formatting |
| `components/ui/{button,tooltip,dialog,tabs,dropdown-menu,slider}.tsx` | `src/components/ui/` (replaces them) | shadcn primitives, restyled. Same exports |
| `components/jobhacker/*` | `src/components/jobhacker/` | The app's components. Presentational only |

`tsconfig.json` must map `@/*` to `./src/*`, which is shadcn's default. The kit imports `@/components/...` and `@/lib/...`.

## Keeping the reference out of the build

`ui-reference/` sits at the repo root as documentation. J1 excludes it from tsc, Biome, Vitest and Tailwind (J1 § C).

**When J4 replaces `globals.css`**, keep `@source not "../../ui-reference";` directly after `@import "tailwindcss";`. The kit's file doesn't have that line. Without it, Tailwind scans the prototype and generates junk CSS.

## Fonts

`globals.css` reads `--font-geist-sans` and `--font-geist-mono`. Set them on `<html>`:

```tsx
// src/app/layout.tsx
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata = { title: "JobHacker" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

Don't copy `ui-reference/prototype-src/src/demo/demo-fonts.css`. It exists only because the prototype runs outside Next.js.

## The server/client boundary

Two kinds of prop can't pass from a server component to a client component:
- **component references**, like a lucide icon passed as `icon: Sparkles`
- **functions**, like `onSelect` or `onAction`

Several kit components take both, so:

- **Server components** load data and pass plain, serializable values: counts, `JobSummary[]`, dimension arrays, labels.
- **Client containers** are your own files, marked `"use client"`. They build the nav sections with icons, hold the UI state, wire callbacks to server actions, and render the kit components.

The shell, as a client container:

```tsx
// src/components/app-shell.tsx
"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Bookmark, BellRing, CircleDashed, FileText, Inbox, Send, Sparkles } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar, AppToaster, type NavSection } from "@/components/jobhacker";
import { formatCompact, formatCount } from "@/lib/format";
import { useMediaQuery } from "@/lib/use-media-query";

export interface ShellCounts {
  matches: number; fresh: number; shortlist: number; unscored: number;
  inProgress: number; submitted: number; followUps: number;
}

export function AppShell({ counts, children }: { counts: ShellCounts; children: React.ReactNode }) {
  const pathname = usePathname();
  const collapsed = useMediaQuery("(max-width: 1279px)");
  const sections: NavSection[] = [
    { label: "Triage", items: [
      { href: "/", label: "Top matches", icon: Sparkles, count: formatCount(counts.matches), countTone: "brand" },
      { href: "/new", label: "New today", icon: Inbox, count: formatCount(counts.fresh) },
      { href: "/shortlist", label: "Shortlist", icon: Bookmark, count: counts.shortlist || undefined },
      { href: "/unscored", label: "Unscored", icon: CircleDashed, count: formatCompact(counts.unscored) },
    ]},
    { label: "Applications", items: [
      { href: "/applications", label: "In progress", icon: FileText, count: counts.inProgress },
      { href: "/applications/submitted", label: "Submitted", icon: Send, count: counts.submitted },
      { href: "/applications/follow-ups", label: "Follow-ups", icon: BellRing, count: counts.followUps,
        countTone: counts.followUps ? "maybe" : "default" },
    ]},
  ];
  return (
    <TooltipProvider>
      <div className="flex h-dvh overflow-hidden bg-canvas text-fg">
        <AppSidebar sections={sections} activeHref={activeHrefFor(pathname)} collapsed={collapsed}
          className="max-md:hidden"
          footer={null /* ScoutCard: last run and Run scout in J4, live progress in J8 */} />
        <main className="relative my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-card max-md:m-0 max-md:rounded-none max-md:border-0">
          {children}
        </main>
      </div>
      <AppToaster />
    </TooltipProvider>
  );
}
```

`activeHrefFor` maps nested routes to their nav item: `/applications/abc` maps to `/applications`, while `/applications/submitted` and `/applications/follow-ups` map to themselves.

**`useMediaQuery`.** Don't copy the prototype's version from `App.tsx` as it is. It reads `matchMedia` during the first render. Under server rendering, that makes the server's HTML and the browser's first render disagree, which React reports as a hydration error and which fails Check 6. Use this instead:

```ts
// src/lib/use-media-query.ts
"use client";
import * as React from "react";

/** false on the server and on the first client render, then the real value. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return matches;
}
```

On a narrow window, the sidebar can show expanded for a single frame before it collapses. That's acceptable.

**Counts that follow the view.** The sidebar's counts depend on Where, which is a URL param, on triage actions, and, from J6, on live weights. But a Next.js layout can't see search params, and doesn't re-render on client navigation. The recommended approach:
- The shell's client container reads `where` with `useSearchParams`. If `next build` asks for one, wrap it in `<Suspense>`.
- It gets its counts from a `getShellCounts({ where, weights?, thresholds? })` server action, which uses core's queries and `rank.ts`.
- It calls that action:
  - on mount
  - when Where changes
  - after every triage action
  - from J6, debounced while a weight moves
- It keeps the counts in a small client context, which the triage container can update optimistically.
- Triage server actions call `revalidatePath("/", "layout")`.

Another approach is fine if it meets the same acceptance (J5, J6). Record it in DECISIONS.

J5 and J6 did not build that server action. Triage writes don't call `revalidatePath` (D96): the view pushes its counts, and `GET /api/triage-counts` confirms them. While the sliders differ from the saved ranking, that GET includes the live weights and bands (D114). A debounced `getShellCounts` action would wait behind any other server action in the same tab.

**`ScoutCard`** takes `status` (`ok`, `attention` or `failed`) and `notices` (a short string, or `{ text, action }` when that line has a button), so the sidebar can say when the unattended scout needs Kris and, when the app passes an action, offer it. See frame `26-scout-attention-1440.png`, whose notices are strings and so have no button.

**On phones**, below 768px, the sidebar is hidden. It opens as a drawer from the menu button in the page header: see `mobileNav` in `App.tsx`, and frame `21-phone-nav.png`.

## Mapping data into kit props

The kit's types are in `components/jobhacker/types.ts`. The prototype's `src/demo/model.ts` (`toSummary`, `toDetail`) is the worked example.

| Kit field | Comes from |
|---|---|
| `JobSummary.company` | `companies.name` |
| `JobSummary.logoUrl` | Built in the client with `logoUrl()` from `company_domains.domain` (matched on the normalized company name) and the client id passed once. Null, so a monogram, when there is no domain, the state is `none`, or the client id is unset |
| `JobDetailData.logoTileUrl`, `.logoSymbolOnDarkUrl`, `.logoSymbolOnLightUrl`, `.logoWordmarkOnDarkUrl`, `.logoWordmarkOnLightUrl` | The header's cover (256 px icon) and both themes of the symbol and the wordmark, built in the client by `headerLogosFor()` (`src/app/lib/triage.ts`) from the same row as `logoUrl` (§ Company logos). The header picks the theme that contrasts with the art. Null when there is no domain, the row is `none`, or the client id is unset. A `typed` row's symbol and wordmark are always null |
| `.place` | The first non-remote row in `job_areas`, with its label from `criteria.yaml`, e.g. `{ id: "portland", label: "Portland" }`. Otherwise `null` |
| `.location`, `.remote` | `jobs.location_raw`, `jobs.remote_type` |
| `.compLabel` | `comp_min`/`comp_max`/`comp_currency`, formatted like `$215–400k`. Omit when unknown |
| `.ageHours` | Now minus `jobs.first_seen_at` |
| `.score`, `.band` | Computed on the client from dimensions × weights, with core's `rank.ts` |
| `.prescore` | `jobs.prescore` |
| `.state` | `jobs.status`: `new`, `scored` and `unscored` all map to `"new"`, with `score` null while unscored or stale. With an application, `prepped` maps to `"prepped"`, and every later status maps to `"submitted"` in the triage views. The applications pages show the application's own status (J7) |
| `JobDetailData.dimensions` | `job_scores.dimensions`: each one's score, reason and weight, with `points = weight × score` |
| `.formula` | Built the way `toDetail` builds it: `93 = 74 points ÷ 16 total weight × 20` |
| `.redFlags`, `.summary` | `job_scores` |
| `.description` | `parseDescription(jobs.description_text)` |
| `FillField[]` | `applications.fill_report`. `review` means a drafted answer that isn't approved yet |
| `TimelineGroup[]` | `events`, mapped to human titles (below). Never show `llm_usage` |

The real column names may differ. J1 records the actual schema in ARCHITECTURE, and that's what you map from.

The dimension keys differ between config and kit:

| Config and `job_scores` | Kit `DimKey` |
|---|---|
| `role_fit` | `role` |
| `tech_fit` | `tech` |
| `domain_interest` | `domain` |
| `seniority_fit` | `seniority` |
| `logistics_fit` | `logistics` |
| `comp_fit` | `comp` |

**Weights and bands always come from `criteria.yaml`.** The prototype's `DEFAULT_WEIGHTS` and thresholds are sample data. Never copy them into the app.

Event titles, matching the reference. `src/app/lib/activity.ts` (`eventSummary`) is the code; any type not listed is hidden:

| `events.type` | Title |
|---|---|
| `triage` | Shortlisted from triage (or Skipped, Archived) |
| `triage`, as an undo | Undid: {the action it undid} |
| `prep` | Prepared resume, cover note and answers ("Re-prepared" after the first; "Regenerated the resume" or "the cover note" for one section) |
| `draft_answers` | Drafted answers to the form's screening questions |
| `fill` | Filled the application in Chrome ({n} fields filled, {m} drafted for review), or "Opened the application in Chrome" when it found no fields |
| `answer_approved` | Approved a drafted answer (or Edited a drafted answer) |
| `submitted` | Marked submitted |
| `status` (application status change) | Moved to {status} |
| `follow_up` | Follow-up set for {date} (or Cleared the follow-up date) |
| `note` | Saved notes (or Cleared notes) |
| `score`, `llm_usage` | Not shown. Scoring writes no event; the score is on the job |

## Ranking on the client

The triage container receives every row's six dimension scores and holds `weights` and `thresholds` in state. It computes `score` and `band` with core's `rank.ts` in a `useMemo`. That's what makes the tuning sliders instant, and what makes the list's re-order animate.

Rows are keyed by id, and the list positions them by transform, so a new order slides into place on its own. `ui-reference/prototype-src/src/demo/views/TriageView.tsx` shows the whole container.

If `rank.ts` can't be imported from a client component, move its pure part into a module with no server imports. Never re-implement the formula.

## Places

`PlaceFilter` takes:
- `options`: each place in `criteria.yaml`, plus Remote, each with its count for the current view
- `value`: the selected ids. Empty means Anywhere
- `onChange`

`PlaceChip` marks a job that's in one of the places. Filtering stays in your container. The classifier lives in core (`docs/reference/PLACES.md`).

## Keyboard

- `useHotkeys(map)` binds lowercase `event.key` values. It ignores keys while you're typing in a field or while a dialog is open, except ⌘K and Escape.
- The prototype's map is in `TriageView.tsx`, and the shortcuts list in `App.tsx`. Keep the same keys: Kris learns them from the prototype.

**Triage keys:**

| Key | Action |
|---|---|
| J / ↓ | Next job |
| K / ↑ | Previous job |
| S | Shortlist |
| X | Skip |
| A | Archive |
| O | Open posting |
| U | Undo |
| Enter | Open the detail on phones |
| Esc | Close the panel |

**View keys:**

| Key | Action |
|---|---|
| 1 | All matches |
| 2 | Strong |
| 3 | Maybe |
| T | Tune |
| D | Density |

**Global keys:**

| Key | Action |
|---|---|
| ⌘K | Search and commands |
| ? | Shortcuts |

## Company logos

`CompanyLogo` takes an optional `src`. With one, it shows the image as a full-bleed tile. Without one, or when the image fails to load, it draws a monogram tile, in a stable color per company.

From J9, `src` is a Brandfetch Logo CDN URL, which Kris's browser loads straight from Brandfetch. SOURCES § Brand data has Brandfetch's rules, and every one of them binds the UI.
- **Core builds the URL:** `logoUrl()` in `src/core/brand/logo-url.ts`, from the company's domain in `company_domains` and `BRANDFETCH_CLIENT_ID`. It's a pure function, so client code can use it.
- **Two sizes:** 128 px for every list tile, so each company is one URL that the browser caches once, and 256 px for the header's cover (J11).
- **List rows carry the domain, not the URL.** The triage container builds URLs for the rows it renders, from the client ID it gets once as a prop. At 10,000 rows, a URL per row would add about a megabyte to the page.
- **A plain `<img>`, never `next/image`** or a server route. Brandfetch doesn't allow a server to fetch or cache its logos.
- **Every surface that shows a company passes `src`:** list rows, the detail, the palette, the applications pages and the Company logos page. § Checks, Check 10, checks it.
- **Automation never loads a real logo.** § Checks says how runs stand in for Brandfetch.
- **Companies the job text doesn't name** are looked up from Brand Search in Kris's browser, one at a time, and only an unambiguous match is stored (SOURCES § Brand data, D105). The open list paints the logo as each one comes back. Automated runs skip the lookup.
- **The Company logos page** (`/companies`, J10) lists the logo set, the companies with a Strong or Maybe job, so Kris can confirm, change or remove each one's domain. Its header counts the logos that actually loaded.
- **The picker** (J10) searches Brandfetch's Brand Search from the browser, in a client container, since kit components don't fetch. It keeps only the domain and brand id Kris picks.
- **The detail header** (J11, D112, D113) is `CompanyHeader`, shared by `JobDetail` (the triage pane, the phone sheet, `/job/[id]`) and, from J7, the application workspace. It uses four Logo CDN URLs, all with `fallback/404`, built by core's `companyHeaderLogos()` (`src/core/brand/site-icon.ts`):
  - **the art:** the 128 px icon, the list tile's own URL, so it's already cached, blurred into a color field
  - **the symbol:** `type/symbol` at 512 px, drawn large and tilted at the top right of the art. `theme/light` (a light glyph) when the art is dark, `theme/dark` (a dark glyph) when the art is light. With no symbol in the chosen theme, the icon takes its place. The other theme is not requested
  - **the cover:** the 256 px icon, in the large tile that opens J10's picker
  - **the company line:** the wordmark, `type/logo` at 72 px high, above the title, shown as served. `theme/light` unless the art behind the scrim is near white, in which case `theme/dark`. It is never wider than the cover and is always smaller than the title. Its `alt` is the company's name. A 404 shows the name, not the other theme
  - **Fallbacks:** each URL fails on its own. When the symbol fails, the art keeps the icon, and when the wordmark fails, the line shows the name as text. When the icon cannot be read, the light logo is used. When the icon fails, or there's no domain, the art is the monogram's color and letter. A `typed` row (J10) uses its `mark_url` for the art and the cover, and has no symbol or wordmark. A `none` row has no logos at all.
  - **Speed:** the triage container builds the URLs from the row it already has, so the next header renders the moment J or K is pressed. The art has a fixed height (460, 420 and 340 px at 1440, 1024 and phone widths). Images fade in as they arrive, and nothing waits for one. The art crossfades in 200 ms, or instantly with reduced motion. Once the title scrolls away, a compact bar sticks to the top.
  - The art is decoration, with an empty `alt`.

Without a client ID, every tile falls back to its monogram.

## Rules

- **Don't restyle kit components to taste.** To change the look, change the reference first (§ Changing the look).
- **Don't add colors, sizes or shadows outside `globals.css`.** The kit clears Tailwind's default palette, so `text-gray-*`, `bg-zinc-*` and the like don't render. That's on purpose.
- **State is never shown by color alone.** A band, a fill state or an error also carries a label or an icon.
- **Don't fetch data or call server actions inside `components/jobhacker/`.** Containers do that. Kit components take props.
- **Don't re-implement ranking in the UI.** Use core's `rank.ts`.
- **Don't add a UI library** beyond what the kit uses.
- **When the app needs something the reference doesn't show** (an existing feature the prototype left out, like application status changes), build it from kit primitives, following the reference's patterns. List it in STATUS so Kris can look at it. Don't drop the feature, and don't invent a new look for it.
- **When something in the reference won't work with the real data,** stop and say what and why in STATUS, rather than improvising.

## Checks

Each UI round's acceptance names the checks that apply to it. Its build agent runs them, and its verify agent runs them again. Paste each command with its output. An empty result from `rg` (exit code 1) is a pass.

**From J9, automation never calls Brandfetch.** Every Playwright run against the app goes through J9's stand-in helper, `tests/e2e/brandfetch.ts` (J9 § D.2), which routes Brandfetch's hosts to local placeholder images and canned search results. That covers screenshots, these checks, and the scale and speed checks. Lighthouse blocks the hosts with `--blocked-url-patterns`. Brandfetch doesn't allow programmatic access to its logos, and the client ID it would blame is Kris's. Real logos are checked in Kris's own browser.

1. **Tokens only.** All three of these come back empty:

   ```bash
   # Tailwind's default palette
   rg -n '\b(bg|text|border|ring|from|via|to|fill|stroke|outline|divide|shadow|accent|caret|decoration|placeholder)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}\b' src
   # raw hex outside the token file
   rg -n '#[0-9a-fA-F]{3,8}\b' src -g '!src/app/globals.css'
   # the old design system's tokens and font
   rg -n 'surface-(sunken|base|raised)|ink-(primary|secondary|muted)|signal-(high|mid|low)|status-(critical|good|warn)|IBM Plex' src
   ```

   J4 also lists every custom property that the old `globals.css` defined and the kit's doesn't, with `git show <last commit before J4>:src/app/globals.css | rg -o -- '--[a-z0-9-]+' | sort -u`. It saves the list as `docs/testing/old-tokens.txt`, and later rounds grep `src` for it too.
2. **The kit is untouched.** Run `diff -r ui-reference/prototype-src/src/kit/components/jobhacker src/components/jobhacker`. Every difference has a reason recorded in STATUS.
3. **Kit components don't fetch.** `rg -n "@/core|better-sqlite3|use server|fetch\(" src/components/jobhacker` comes back empty.
4. **Ranking comes from core.** Grep `src/app` and `src/components` for `* 20`, and for the band thresholds. Anything found must be a call into core's `rank.ts`.
5. **No plumbing in the page.** For each touched route, fetch the rendered HTML and run `rg -c 'llm_usage|draft_answers|/Users/|data/(jobhacker|logs|seeds)|jobhacker\.db'` on it. The count must be 0: no event names, no file-system paths.
6. **No console errors.** On a production build (`pnpm build`, then `pnpm start`), a Playwright pass over every touched route at the three sizes collects console errors and page errors, and finds none. `ui-reference/prototype-src/scripts/shoot.mjs` shows the listeners. From J9, one kind is expected, and left out: "Failed to load resource" for a Brandfetch URL, which is how a company Brandfetch doesn't know shows up (§ Company logos). Filter it by the message's URL, never by its text alone.
7. **The keyboard paths match the reference's,** for the keys the round covers (§ Keyboard).
8. **Screenshots** at 1440×900, 1024×768 and 390×844, each paired with its reference frame and read back (AGENTS § Definition of done). Every difference is fixed or listed with a reason.
9. **No server code in the client bundle.** No `"use client"` module, nor anything it imports, reaches `better-sqlite3`, `src/core/db`, `node:fs` or the config loader.
   - `pnpm build` fails on most such imports, so a green build is the first half of the evidence.
   - For the direct ones, run `rg -l '"use client"' src | xargs rg -n 'core/db|better-sqlite3|node:fs|config/load'`, which must come back empty.
   - Trace `rank.ts`'s imports by hand, and paste the list.
10. **Every company tile has a source** (from J9). Run `rg -n '<CompanyLogo' src`, and show that every use passes `src`, built by core's `logoUrl()` (§ Company logos). Then, with the stand-ins running, show that each touched route that lists companies with a domain renders at least one `img` whose `src` is on `cdn.brandfetch.io`. Reading the code isn't enough: a `src` that's never filled in passes the grep.

## Changing the look

If Kris asks for a different look, the reference changes first:
1. Edit `ui-reference/prototype-src`. The first time, run `npm install` and `npx playwright install chromium` there.
2. Run `npm run build`, then copy `dist/index.html` to `ui-reference/prototype.html`.
3. Run `npm run shoot` (or `node scripts/shoot.mjs ../screens`) to refresh `ui-reference/screens/`. It also prints any console errors it saw, and there must be none.
4. Kris looks at it.
5. The app then follows the reference.

That keeps the reference the single source of truth. "The agent interpreted it differently" is how the earlier UI attempts failed.

## Reproducing the prototype

```bash
cd ui-reference/prototype-src
npm install
npm run typecheck
npm test                              # the 54 place-classifier cases
npm run build                         # writes dist/index.html, one standalone file
CHROMIUM_PATH=... node scripts/shoot.mjs ../screens   # frames of every view; CHROMIUM_PATH is optional
node scripts/stress.mjs               # the 11k-row virtualization check
```

Opening `dist/index.html?stress` loads about 11,000 rows.
