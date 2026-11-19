import { normalizeCompanyName } from '../util/hash.js';
import { aggregatorFor } from './aggregators.js';
import { boardFromUrl } from './detect.js';
import { isPlaceholderEmployer } from './placeholder-employers.js';
import type { ApplyOption } from './types.js';

/** The ATSs with a form filler. A link to one of their boards is the employer's own form. */
export const FORM_ATS = ['greenhouse', 'lever', 'ashby', 'smartrecruiters'] as const;
export type FormAts = (typeof FORM_ATS)[number];

/** The form ATS a link points at (detect.ts), or null. */
export function formAtsOf(url: string): FormAts | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const board = boardFromUrl(parsed);
  if (!board) return null;
  return (FORM_ATS as readonly string[]).includes(board.ats) ? (board.ats as FormAts) : null;
}

/** Host labels that say what a site is for, never whose it is. */
const GENERIC_LABELS = new Set([
  'www',
  'jobs',
  'job',
  'careers',
  'career',
  'apply',
  'boards',
  'job-boards',
  'hire',
  'hiring',
  'recruiting',
  'talent',
  'join',
  'work',
  'co',
  'com',
]);

/**
 * True when `token` (an ATS board token or a host label) spells the start of
 * the company's name: `netboxlabs` for "NetBox Labs, Inc.", `homedepot` for
 * "The Home Depot", `palantir` for "Palantir Technologies".
 */
export function tokenNamesCompany(token: string, company: string): boolean {
  const spelled = normalizeCompanyName(token.replace(/[-_.]+/g, ' ')).replace(/ /g, '');
  if (spelled.length < 3) return false;
  const words = normalizeCompanyName(company)
    .split(' ')
    .filter((word) => word.length > 0 && word !== 'the');
  let prefix = '';
  for (const word of words) {
    prefix += word;
    if (prefix === spelled) return true;
  }
  return false;
}

/**
 * True when the link is on the employer's own job system or site, as far as
 * the URL shows: an ATS board whose token names the company, or a host whose
 * name does. A job board is never the employer's, and nothing is tied to a
 * placeholder employer. JSearch groups postings by title, so a job's apply
 * options can be other companies' jobs (J29 fix); only a tied link is offered
 * or opened.
 */
export function isEmployerLink(url: string, company: string): boolean {
  if (isPlaceholderEmployer(company)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (aggregatorFor(host)) return false;
  const board = boardFromUrl(parsed);
  if (board) return tokenNamesCompany(board.token, company);
  const labels = host.split('.').slice(0, -1);
  return labels.some((label) => !GENERIC_LABELS.has(label) && tokenNamesCompany(label, company));
}

/**
 * The apply link to open for a search hit (J29). Only links tied to the
 * employer (`isEmployerLink`) count. In order: a Greenhouse, Lever, Ashby or
 * SmartRecruiters form, a link the source marked direct, any other tied link,
 * then `fallback` (JSearch's `job_apply_link`). Pure.
 */
export function rankApplyOptions(
  options: readonly ApplyOption[] | null | undefined,
  fallback: string,
  company: string,
): string {
  const tied = (options ?? []).filter((o) => isEmployerLink(o.url, company));
  const form = tied.find((o) => formAtsOf(o.url) !== null);
  if (form) return form.url;
  const direct = tied.find((o) => o.direct);
  if (direct) return direct.url;
  return tied[0]?.url ?? fallback;
}
