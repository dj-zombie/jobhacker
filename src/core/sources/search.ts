import type { Http } from '../util/http.js';
import type { NormalizedPosting } from './types.js';

/** Generated from `preferences.md` by `query-gen.ts`. Not hand-written per run. */
export interface SearchQuery {
  titles: string[];
  location?: string;
  remoteOnly: boolean;
  since: string;
  page?: number;
  /** The area this query is for (`remote` or a place id). Logging only; never filters results. */
  area?: string;
}

export interface SearchHit {
  companyName: string;
  posting: NormalizedPosting;
}

export interface SearchContext {
  http: Http;
  key?: string;
  /**
   * Record one metered call against this source's monthly budget.
   * Returns false when the budget is already spent; the adapter must not call.
   */
  charge(): boolean;
}

export interface SearchAdapter {
  kind: 'search';
  name: 'jsearch' | 'jobspipe' | 'hn';
  needsKey: boolean;
  /** Dollars charged to `source_usage` per call. Free tiers stay at 0. */
  costPerCall: number;
  search(query: SearchQuery, ctx: SearchContext): Promise<SearchHit[]>;
}
