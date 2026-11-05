/**
 * Hooks a page that hosts the prototype can set. The prototype sets none, and then
 * behaves as it always has. The public demo (site/) sets `openAndFill` to open its
 * sample form, where a recorded run of the real filler replays, and `logos` to load
 * real logos from Brandfetch's Logo CDN in the visitor's browser.
 */

export interface FillResult {
  title: string;
  description: string;
}

/** Logo URLs for a company, or null for its letter. `white` ink is the light-colored asset. */
export interface DemoLogos {
  /** The list tile, 128 px. */
  tile: (company: string) => string | null;
  /** The header's cover, 256 px. */
  cover: (company: string) => string | null;
  symbol: (company: string, ink: "white" | "black") => string | null;
  wordmark: (company: string, ink: "white" | "black") => string | null;
}

export const demoHooks: {
  /**
   * Called from the Open & fill click, so the host may open a tab. Call `done` once:
   * with the toast to show, or with null for no toast.
   */
  openAndFill?: (appId: string, done: (result: FillResult | null) => void) => void;
  /** Read at render time, so set it before the first render. */
  logos?: DemoLogos;
} = {};
