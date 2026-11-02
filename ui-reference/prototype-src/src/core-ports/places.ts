/*
  Places: which of Kris's areas a job's location falls in.

  Pure and deterministic, so it works on unscored jobs and in tests.
  Port this file to src/core/pipeline/places.ts unchanged; the config below
  becomes the `places:` block in criteria.yaml.

  This is a VIEW filter's classifier, never a gate (AGENTS invariant 8). A job
  that matches no place is still stored, scored and visible under "Anywhere".

  It parses locations into city/state pairs and compares whole names. It does
  not substring-match, so "Costa Mesa, CA" is not Mesa, "Glendale, CA" is not
  Glendale AZ, and a company called Phoenix is never in Phoenix (company names
  are never read at all).
*/

export type RemoteType = "remote" | "hybrid" | "onsite" | "unknown";

export interface PlaceDef {
  id: string;
  label: string;
  /** Shown as a hint next to the filter, e.g. "Hybrid only". */
  note?: string;
  /** Whole city names in the metro. */
  cities: string[];
  /** State codes and names the cities must be in when a state is written. */
  states: string[];
  /** "City, ST" pairs outside the main state, e.g. "Vancouver, WA" for Portland. */
  extra?: string[];
  /** Region names that mean the whole metro. */
  aliases?: string[];
}

export interface PlacesConfig {
  places: PlaceDef[];
  /** Remote roles count as Remote when open to these countries (or no country is named). */
  remoteCountries: string[];
}

export const REMOTE = "remote";

export const DEFAULT_PLACES: PlacesConfig = {
  places: [
    {
      id: "portland",
      label: "Portland",
      cities: [
        "Portland", "Beaverton", "Hillsboro", "Tigard", "Tualatin", "Lake Oswego", "Wilsonville",
        "Gresham", "Milwaukie", "Happy Valley", "Oregon City", "West Linn", "Sherwood", "Clackamas",
        "Forest Grove",
      ],
      states: ["OR", "Oregon"],
      extra: ["Vancouver, WA", "Camas, WA", "Washougal, WA"],
      aliases: ["Greater Portland", "Portland Metro", "Portland Metropolitan"],
    },
    {
      id: "phoenix",
      label: "Phoenix",
      cities: [
        "Phoenix", "Scottsdale", "Tempe", "Mesa", "Chandler", "Gilbert", "Glendale", "Peoria",
        "Surprise", "Goodyear", "Avondale", "Queen Creek", "Paradise Valley", "Fountain Hills",
        "Cave Creek", "Buckeye", "Casa Grande",
      ],
      states: ["AZ", "Arizona"],
      aliases: ["Greater Phoenix", "Phoenix Metro", "Phoenix Metropolitan", "Valley of the Sun"],
    },
  ],
  remoteCountries: ["US"],
};

export interface Classification {
  /** Place ids, plus "remote", in config order. Empty means "elsewhere". */
  areas: string[];
  /** The text that put the job in each area, for the "why" panel and for debugging. */
  evidence: Record<string, string>;
  /** States a remote role is limited to, when the posting says so. */
  remoteStates?: string[];
}

/* ---------------------------------------------------------------- data -- */

const US_STATES: Record<string, string> = {
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado",
  CT: "connecticut", DE: "delaware", FL: "florida", GA: "georgia", HI: "hawaii", ID: "idaho",
  IL: "illinois", IN: "indiana", IA: "iowa", KS: "kansas", KY: "kentucky", LA: "louisiana",
  ME: "maine", MD: "maryland", MA: "massachusetts", MI: "michigan", MN: "minnesota",
  MS: "mississippi", MO: "missouri", MT: "montana", NE: "nebraska", NV: "nevada",
  NH: "new hampshire", NJ: "new jersey", NM: "new mexico", NY: "new york", NC: "north carolina",
  ND: "north dakota", OH: "ohio", OK: "oklahoma", OR: "oregon", PA: "pennsylvania",
  RI: "rhode island", SC: "south carolina", SD: "south dakota", TN: "tennessee", TX: "texas",
  UT: "utah", VT: "vermont", VA: "virginia", WA: "washington", WV: "west virginia",
  WI: "wisconsin", WY: "wyoming", DC: "district of columbia",
};
const STATE_BY_NAME = new Map(Object.entries(US_STATES).map(([code, name]) => [name, code]));

const CA_PROVINCES = new Set(["ON", "QC", "BC", "AB", "MB", "SK", "NS", "NB", "NL", "PE"]);

const NON_US = [
  "canada", "ontario", "quebec", "british columbia", "alberta", "united kingdom", "uk", "england",
  "scotland", "wales", "ireland", "germany", "france", "spain", "portugal", "netherlands",
  "belgium", "switzerland", "austria", "italy", "poland", "romania", "ukraine", "sweden", "norway",
  "denmark", "finland", "estonia", "czech", "hungary", "greece", "turkey", "india", "pakistan",
  "brazil", "mexico", "argentina", "colombia", "chile", "peru", "uruguay", "costa rica",
  "australia", "new zealand", "singapore", "japan", "china", "hong kong", "taiwan", "korea",
  "philippines", "vietnam", "indonesia", "malaysia", "thailand", "israel", "tel aviv",
  "south africa", "nigeria", "kenya", "egypt", "uae", "dubai", "emea", "europe", "eu", "apac",
  "latam", "latin america", "south america", "central america", "toronto", "london", "berlin", "paris", "dublin", "amsterdam", "lisbon", "madrid",
  "barcelona", "warsaw", "bangalore", "bengaluru", "sydney", "melbourne", "tokyo", "aarhus",
];
const NON_US_RE = new RegExp(`\\b(${NON_US.map((w) => w.replace(/ /g, "\\s+")).join("|")})\\b`, "i");

const US_RE = /\b(us|u\.s\.?|usa|u\.s\.a\.?|united states|america|north america|americas)\b/i;
const REMOTE_RE = /\b(remote|anywhere|distributed|work from home|wfh|telecommut\w*)\b/i;
const RESTRICTED_RE = /remote\s+(?:only\s+)?(?:in|within|from)\s+(?:the\s+)?([^|;()]+)/i;

/* ------------------------------------------------------------- helpers -- */

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

/** "OR" | "Oregon" | "or preferred" -> "OR". Null if not a US state. */
function stateCode(token: string | undefined): string | null {
  if (!token) return null;
  const t = norm(token).replace(/[^a-z .]/g, "").trim();
  if (!t) return null;
  const firstWord = t.split(" ")[0] ?? "";
  if (firstWord.length === 2 && US_STATES[firstWord.toUpperCase()]) return firstWord.toUpperCase();
  for (const [name, code] of STATE_BY_NAME) if (t === name || t.startsWith(`${name} `)) return code;
  return null;
}

function isProvince(token: string | undefined): boolean {
  if (!token) return false;
  const first = norm(token).split(" ")[0] ?? "";
  return CA_PROVINCES.has(first.toUpperCase());
}

/** Split a location field into separate places. " or " / " and " only in lowercase, so the state code OR survives. */
function splitEntries(raw: string): string[] {
  return raw
    .split(/\s*(?:;|\||\/|•|\n)\s*|\s+or\s+|\s+and\s+|\s+&\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function hasNonUS(text: string): boolean {
  const t = text.replace(/new mexico/gi, "nm");
  return NON_US_RE.test(t);
}

function restrictedStates(entry: string): string[] | null {
  const m = entry.match(RESTRICTED_RE);
  if (!m?.[1]) return null;
  if (US_RE.test(m[1])) return null; // "remote in the US" is a country, not a restriction
  const codes = m[1]
    .split(/,|\s+and\s+|\s+or\s+/)
    .map((t) => stateCode(t))
    .filter((c): c is string => !!c);
  return codes.length ? codes : null;
}

interface Compiled {
  def: PlaceDef;
  cities: Set<string>;
  states: Set<string>;
  extra: { city: string; state: string }[];
  aliases: string[];
}

function compile(cfg: PlacesConfig): Compiled[] {
  return cfg.places.map((def) => ({
    def,
    cities: new Set(def.cities.map(norm)),
    states: new Set(def.states.map((s) => stateCode(s)).filter((c): c is string => !!c)),
    extra: (def.extra ?? []).map((e) => {
      const [city, st] = e.split(",");
      return { city: norm(city ?? ""), state: stateCode(st) ?? "" };
    }),
    aliases: (def.aliases ?? []).map(norm),
  }));
}

/* ---------------------------------------------------------------- main -- */

/**
 * Classify one job. `location` is the raw location text (several fields can be
 * joined with " | "). `title` is only consulted when the location says nothing
 * useful, for postings like "Senior Software Engineer (Portland)".
 */
export function classifyPlaces(
  job: { location: string; remote: RemoteType; title?: string },
  cfg: PlacesConfig = DEFAULT_PLACES,
): Classification {
  const compiled = compile(cfg);
  const found = new Map<string, string>();
  let remoteStates: string[] | undefined;
  const add = (id: string, why: string) => {
    if (!found.has(id)) found.set(id, why);
  };

  const raw = job.location ?? "";
  const anyNonUS = hasNonUS(raw);

  for (const entry of splitEntries(raw)) {
    const lower = norm(entry);
    const nonUS = hasNonUS(lower) || isProvince(entry.split(",")[1]);

    // Remote entries: a city in the same entry is SEO or HQ, not where you'd work.
    if (REMOTE_RE.test(entry)) {
      const restricted = restrictedStates(entry);
      if (restricted) {
        remoteStates = [...new Set([...(remoteStates ?? []), ...restricted])];
        for (const p of compiled)
          if (restricted.some((s) => p.states.has(s))) add(p.def.id, `remote in ${restricted.join(", ")}`);
      } else if (!nonUS && cfg.remoteCountries.includes("US")) {
        add(REMOTE, entry);
      }
      continue;
    }

    if (nonUS) continue;

    const parts = entry.split(",").map((s) => s.trim());
    // "Hybrid - Portland", "Portland (Hybrid)", "HQ: Tempe" -> the city alone.
    const city = norm(
      (parts[0] ?? "")
        .replace(/\(.*?\)/g, "")
        .replace(/^(hybrid|on-?site|in[- ]office|office|hq|headquarters)\b\s*[-:]?\s*/i, ""),
    );
    const st = stateCode(parts[1]);
    const onlyState = parts.length === 1 ? stateCode(parts[0]) : null;

    for (const p of compiled) {
      if (p.aliases.some((a) => lower.includes(a))) {
        add(p.def.id, entry);
        continue;
      }

      if (onlyState && p.states.has(onlyState)) {
        add(p.def.id, entry);
      } else if (p.extra.some((e) => e.city === city && e.state === st)) {
        add(p.def.id, entry);
      } else if (p.cities.has(city) && (st === null || p.states.has(st))) {
        // A bare city is accepted ("Phoenix"); a city in another state is not ("Glendale, CA").
        add(p.def.id, entry);
      }
    }
  }

  // The ATS said remote but the text named no country: count it as Remote unless it's clearly abroad.
  if (job.remote === "remote" && !anyNonUS && !remoteStates && cfg.remoteCountries.includes("US")) {
    add(REMOTE, `remote (${raw || "no location"})`);
  }

  // Nothing usable in the location: look for "(Portland)" in the title.
  if (found.size === 0 && job.title && !anyNonUS) {
    const m = job.title.match(/\(([^)]+)\)/);
    if (m?.[1]) {
      const inner = norm(m[1]);
      for (const p of compiled) if ([...p.cities].some((c) => inner === c)) add(p.def.id, `title: ${m[0]}`);
    }
  }

  const order = [...cfg.places.map((p) => p.id), REMOTE];
  const areas = order.filter((id) => found.has(id));
  return { areas, evidence: Object.fromEntries(found), ...(remoteStates ? { remoteStates } : {}) };
}
