import type { Ats } from '../config/schemas.js';
import type { Http } from '../util/http.js';

/** `remote | hybrid | onsite | unknown`, matching the `jobs.remote_type` column. */
export const REMOTE_TYPES = ['remote', 'hybrid', 'onsite', 'unknown'] as const;
export type RemoteType = (typeof REMOTE_TYPES)[number];

/** The company a posting is being normalized for. */
export interface CompanyRef {
  name: string;
  ats: Ats;
  token: string;
}

/**
 * Job fields ready for insert. Scout adds the company id, timestamps, hashes,
 * and status. This is the "db shape" from ARCHITECTURE § Sources, minus
 * bookkeeping that does not come from the board.
 */
export interface NormalizedPosting {
  ats: Ats;
  externalId: string;
  title: string;
  locationRaw: string | null;
  remoteType: RemoteType;
  employmentType: string | null;
  url: string;
  applyUrl: string | null;
  descriptionText: string;
  compMin: number | null;
  compMax: number | null;
  compCurrency: string | null;
  postedAt: string | null;
  /**
   * A company-website field from the source, when it has one (JSearch's
   * `employer_website`). Not stored on the job. The domain finder reads it
   * at scout time (J9).
   */
  companyWebsite?: string | null;
}

export interface ParsedBoard<T> {
  postings: T[];
  /** Human-readable reasons for postings that were dropped. */
  skipped: string[];
}

/**
 * One ATS. `parse` drops individual bad postings. It throws `BoardParseError`
 * when the payload is not a board, or when every posting fails to parse —
 * scout must not treat that as "the board is empty" and close live jobs.
 */
export interface SourceAdapter<T> {
  kind: 'board';
  needsKey: boolean;
  ats: Ats;
  fetchBoard(token: string, http: Http, key?: string): Promise<unknown>;
  parse(raw: unknown): ParsedBoard<T>;
  normalize(posting: T, company: CompanyRef): NormalizedPosting;
}

export class BoardParseError extends Error {
  override readonly name = 'BoardParseError';
}
