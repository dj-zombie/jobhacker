import type { Ats } from '../config/schemas.js';
import type { Http } from '../util/http.js';
import { ashbyAdapter } from './ashby.js';
import { breezyAdapter, breezyCompanyName } from './breezy.js';
import { greenhouseAdapter, greenhouseCompanyName } from './greenhouse.js';
import { leverAdapter } from './lever.js';
import { polymerAdapter, polymerCompanyName } from './polymer.js';
import { smartRecruitersAdapter, smartRecruitersCompanyName } from './smartrecruiters.js';
import { teamtailorAdapter } from './teamtailor.js';
import type { CompanyRef, NormalizedPosting, ParsedBoard, SourceAdapter } from './types.js';
import { workableAdapter } from './workable.js';

/** A board adapter erased to the runtime shape scout and discovery call. */
export interface BoardRuntime {
  needsKey: boolean;
  ats: Ats;
  fetchBoard(token: string, http: Http, key?: string): Promise<unknown>;
  parse(raw: unknown): ParsedBoard<unknown>;
  normalize(posting: unknown, company: CompanyRef): NormalizedPosting;
  companyName(raw: unknown): string | undefined;
}

export function loadBoard(ats: string): BoardRuntime | undefined {
  switch (ats) {
    case 'greenhouse':
      return wrap(greenhouseAdapter, greenhouseCompanyName);
    case 'lever':
      return wrap(leverAdapter);
    case 'ashby':
      return wrap(ashbyAdapter);
    case 'smartrecruiters':
      return wrap(smartRecruitersAdapter, smartRecruitersCompanyName);
    case 'breezy':
      return wrap(breezyAdapter, breezyCompanyName);
    case 'polymer':
      return wrap(polymerAdapter, polymerCompanyName);
    case 'workable':
      return wrap(workableAdapter);
    case 'teamtailor':
      return wrap(teamtailorAdapter);
    default:
      return undefined;
  }
}

function wrap<T>(
  adapter: SourceAdapter<T>,
  companyName?: (raw: unknown) => string | undefined,
): BoardRuntime {
  return {
    needsKey: adapter.needsKey,
    ats: adapter.ats,
    fetchBoard: (token, http, key) => adapter.fetchBoard(token, http, key),
    parse: (raw) => adapter.parse(raw) as ParsedBoard<unknown>,
    normalize: (posting, company) => adapter.normalize(posting as T, company),
    companyName: (raw) => companyName?.(raw),
  };
}
