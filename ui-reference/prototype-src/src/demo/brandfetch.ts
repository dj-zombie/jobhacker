/**
 * Real logos for the prototype, the same way the public demo does it (D165, SOURCES § Brand data):
 * the app's own Brandfetch Logo CDN URLs, loaded by the browser with a demo client ID. The ID is
 * supplied at runtime (main.tsx) and is never committed, so the built prototype ships no ID and
 * makes zero Brandfetch requests — it shows the stand-in marks. With an ID, `demoHooks.logos`
 * points here and the real marks load in the browser.
 *
 * Self-contained on purpose: the prototype can't import across its build root, so the domain map
 * and URL builders are copied from `site/src/brand-domains.ts` and `src/core/brand/logo-url.ts`.
 * They only decide which sample company gets a real logo; drift just means a stand-in instead.
 */

import type { DemoLogos } from "./demo-hooks";

/** Company → domain, copied from `site/src/brand-domains.ts`. */
const BRAND_DOMAINS: ReadonlyMap<string, string> = new Map([
  ["A Place For Mom", "aplaceformom.com"],
  ["ABC Legal Services", "abclegal.com"],
  ["Afresh", "afresh.com"],
  ["Altruist", "altruist.com"],
  ["Aura", "aura.com"],
  ["Backblaze", "backblaze.com"],
  ["Bunch", "bunch.capital"],
  ["Canva", "canva.com"],
  ["Carwow", "carwow.co.uk"],
  ["Checkr", "checkr.com"],
  ["Cloudflare", "cloudflare.com"],
  ["Code for America", "codeforamerica.org"],
  ["d-Matrix", "d-matrix.ai"],
  ["DataGrail", "datagrail.io"],
  ["Datadog", "datadoghq.com"],
  ["DISCO", "csdisco.com"],
  ["Discord", "discord.com"],
  ["Elastic", "elastic.co"],
  ["Fictiv", "fictiv.com"],
  ["Flexe", "flexe.com"],
  ["GitLab", "gitlab.com"],
  ["Gruve", "gruve.ai"],
  ["Invisible Technologies", "invisible.co"],
  ["JetBrains", "jetbrains.com"],
  ["Lendbuzz", "lendbuzz.com"],
  ["Linear", "linear.app"],
  ["Mozilla", "mozilla.com"],
  ["Notion", "notion.so"],
  ["Ocrolus", "ocrolus.com"],
  ["PagerDuty", "pagerduty.com"],
  ["Panthalassa", "panthalassa.com"],
  ["Patch", "patch.com"],
  ["Perplexity", "perplexity.ai"],
  ["Plasmidsaurus", "plasmidsaurus.com"],
  ["Practice Better", "practicebetter.io"],
  ["Ramp", "ramp.com"],
  ["Render", "render.com"],
  ["Roadie", "roadie.com"],
  ["Roblox", "roblox.com"],
  ["Scout Motors", "scoutmotors.com"],
  ["Sentry", "sentry.io"],
  ["Smarsh", "smarsh.com"],
  ["SmartRent", "smartrent.com"],
  ["SoundCloud", "soundcloud.com"],
  ["Spotify", "spotify.com"],
  ["StarTree", "startree.ai"],
  ["Supabase", "supabase.com"],
  ["Tailscale", "tailscale.com"],
  ["Talkspace", "talkspace.com"],
  ["Tonal", "tonal.com"],
  ["Typeform", "typeform.com"],
  ["Veeam Software", "veeam.com"],
  ["Vercel", "vercel.com"],
  ["Webflow", "webflow.com"],
  ["Wonderschool", "wonderschool.com"],
  ["Zocdoc", "zocdoc.com"],
]);

/**
 * Whether the demo would load a real logo for this company. The stand-ins mirror this so the
 * no-ID frames show a graphical mark for exactly the companies that get one live, and the
 * monogram for the rest (Axion, Imo Online, Phoenix, Thermal Works, and anything unmapped).
 */
export function hasBrandDomain(company: string): boolean {
  return BRAND_DOMAINS.has(company);
}

/** Copied from `src/core/brand/logo-url.ts`: sizes, hostname check, and the CDN URL builders. */
const LOGO_TILE_PX = 128;
const LOGO_HEADER_PX = 256;
const LOGO_SYMBOL_PX = 512;
const LOGO_WORDMARK_H_PX = 72;
const SIZES = new Set([LOGO_TILE_PX, LOGO_HEADER_PX]);
const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

type LogoTheme = "light" | "dark";

function logoUrl(domain: string | null, clientId: string, size: number): string | null {
  if (!domain || clientId.length === 0 || !SIZES.has(size) || !HOSTNAME.test(domain)) return null;
  return `https://cdn.brandfetch.io/domain/${domain}/w/${size}/h/${size}/fallback/404/type/icon?c=${encodeURIComponent(clientId)}`;
}

function brandAssetUrl(
  domain: string | null,
  clientId: string,
  type: "symbol" | "wordmark",
  theme: LogoTheme,
): string | null {
  if (!domain || clientId.length === 0 || !HOSTNAME.test(domain)) return null;
  const path =
    type === "symbol"
      ? `w/${LOGO_SYMBOL_PX}/h/${LOGO_SYMBOL_PX}/theme/${theme}/fallback/404/type/symbol`
      : `h/${LOGO_WORDMARK_H_PX}/theme/${theme}/fallback/404/type/logo`;
  return `https://cdn.brandfetch.io/domain/${domain}/${path}?c=${encodeURIComponent(clientId)}`;
}

/**
 * The `demoHooks.logos` provider that loads the real marks. No ID, no hook: the stand-ins stay.
 * Mirrors `site/src/brand.ts` so the prototype and the public demo show the same thing.
 */
export function brandfetchLogos(clientId: string): DemoLogos | undefined {
  if (clientId.length === 0) return undefined;
  const domain = (company: string) => BRAND_DOMAINS.get(company) ?? null;
  const theme = (ink: "white" | "black"): LogoTheme => (ink === "white" ? "light" : "dark");
  return {
    tile: (company) => logoUrl(domain(company), clientId, LOGO_TILE_PX),
    cover: (company) => logoUrl(domain(company), clientId, LOGO_HEADER_PX),
    symbol: (company, ink) => brandAssetUrl(domain(company), clientId, "symbol", theme(ink)),
    wordmark: (company, ink) => brandAssetUrl(domain(company), clientId, "wordmark", theme(ink)),
  };
}
