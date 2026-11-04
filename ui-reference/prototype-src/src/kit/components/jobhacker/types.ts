/*
  The data contract between the app and the JobHacker components.
  Components are presentational: map rows from the DB into these shapes in a
  server component or loader, and pass them down. Nothing here computes a score.
*/

export type Band = "strong" | "maybe" | "no";
export type DimKey = "role" | "tech" | "domain" | "seniority" | "logistics" | "comp";
export type RemoteType = "remote" | "hybrid" | "onsite" | "unknown";
export type TriageState = "new" | "shortlisted" | "skipped" | "archived" | "prepped" | "submitted";
export type Density = "comfortable" | "compact";
export type TriageAction = "shortlist" | "skip" | "archive" | "open";

export interface JobSummary {
  id: string;
  title: string;
  company: string;
  /**
   * 128 px Brandfetch Logo CDN URL, loaded by the browser. Never a stored file.
   * The detail header blurs this into its art's color field, so the art starts
   * from the image the list already loaded. Absent, or a load that fails, falls
   * back to a monogram.
   */
  logoUrl?: string | null;
  location: string;
  remote: RemoteType;
  /** Already formatted, e.g. "$236–295k". Omit when the posting has none. */
  compLabel?: string | null;
  /** Hours since first seen. */
  ageHours: number;
  /** 0–100 ranked score. Null while unscored. */
  score?: number | null;
  band?: Band | null;
  /** 0–1 lexical prescore. Ordering only, never excludes. */
  prescore?: number | null;
  state: TriageState;
  /** The posting is closed. Shortlist still shows the row, with a Closed chip. */
  closed?: boolean;
  /** One of the user's named places (Portland, Phoenix…) when the job is in it. Remote is `remote`. */
  place?: { id: string; label: string } | null;
}

export interface DimensionRow {
  key: DimKey;
  label: string;
  /** 0–5, or null when the posting doesn't say (drops out of the average). */
  score: number | null;
  weight: number;
  /** weight × score, or null when score is null. */
  points: number | null;
  reason: string;
}

export type DescriptionBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

export interface JobDetailData extends JobSummary {
  /**
   * 256 px Brandfetch icon for the header's cover (up to 128 px on a 2× screen).
   * Absent falls back to `logoUrl`, then to the monogram.
   */
  logoTileUrl?: string | null;
  /**
   * Brandfetch `type=symbol` in `theme=light`: the light glyph, drawn large when the
   * art is dark. Absent falls back to the cover's icon.
   */
  logoSymbolOnDarkUrl?: string | null;
  /** Brandfetch `type=symbol` in `theme=dark`: the dark glyph, drawn when the art is light. */
  logoSymbolOnLightUrl?: string | null;
  /**
   * Brandfetch `type=logo` in `theme=light`: the light wordmark, for the dark scrim
   * under the title. Shown as served. Absent, or a load that fails, shows the name.
   */
  logoWordmarkOnDarkUrl?: string | null;
  /** Brandfetch `type=logo` in `theme=dark`: the dark wordmark, for a near-white scrim. */
  logoWordmarkOnLightUrl?: string | null;
  employment: string;
  postedLabel: string;
  /** When a scout last saw the posting, in the same words as `postedLabel`. */
  confirmedLabel: string;
  summary?: string;
  dimensions?: DimensionRow[];
  /** e.g. "93 = (30 + 8 + 6 + 10 + 20) ÷ 16 × 20" */
  formula?: string;
  redFlags?: string[];
  description?: DescriptionBlock[];
  prescoreNote?: string;
  model?: string;
  rubric?: string;
  scoredLabel?: string;
  postingUrl?: string;
}

export type FieldState = "filled" | "review" | "blank";
export type FieldSource = "profile" | "drafted" | "resume" | "cover-note" | "self-id";

export interface FillField {
  id: string;
  label: string;
  value?: string;
  state: FieldState;
  source?: FieldSource;
  required?: boolean;
  /** Why a field is blank, e.g. "No answer in your profile". */
  note?: string;
}

export interface TimelineItem {
  id: string;
  time: string;
  title: string;
  detail?: string;
  kind: "score" | "triage" | "prep" | "fill" | "draft" | "submit" | "note";
}

export interface TimelineGroup {
  day: string;
  items: TimelineItem[];
}
