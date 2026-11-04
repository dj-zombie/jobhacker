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
  /** A place's cities, including each `extra` city. JobsPipe `city_or`. JSearch ignores this. */
  cities?: string[];
  /** ISO 3166-2 regions, `US-` plus a two-letter state. JobsPipe `region_or`. */
  regions?: string[];
  /** Countries a remote role may be open to. JobsPipe `job_country_code_or` on the remote query. */
  remoteCountries?: string[];
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
  /**
   * Credits still left in this source's monthly credit budget. Absent on
   * sources that are budgeted in calls only.
   */
  creditsLeft?(): number;
  /** Add the credits this call was charged, and the balance the source reported. */
  recordCredits?(charged: number, remaining: number): void;
  /** A posting in the response was not stored, with the reason (invariant 8). */
  noteSkipped?(reason: string): void;
  /**
   * The credit budget has nothing left, so this call is not made. Same close
   * effect as `charge` returning false, without counting a call.
   */
  stopForCredits?(): void;
  /**
   * An external id that was in the raw response, whether or not it is ingested.
   * HN close uses these. Absent means the ingested hit ids are the response.
   */
  noteResponseId?(id: string): void;
  /**
   * The listing was not read to the end, so a close must not treat this
   * response as the full set.
   */
  noteIncomplete?(): void;
}

export interface SearchAdapter {
  kind: 'search';
  name: 'jsearch' | 'jobspipe' | 'hn';
  needsKey: boolean;
  /** Dollars charged to `source_usage` per call. Free tiers stay at 0. */
  costPerCall: number;
  search(query: SearchQuery, ctx: SearchContext): Promise<SearchHit[]>;
}
