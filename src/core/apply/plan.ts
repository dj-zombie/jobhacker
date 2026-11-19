import { aggregatorFor } from '../sources/aggregators.js';
import { isEmployerLink } from '../sources/apply-options.js';
import type { ApplyOption } from '../sources/types.js';
import { urlHost } from '../util/host.js';
import { ashbyAdapter } from './adapters/ashby.js';
import { genericAdapter } from './adapters/generic.js';
import { greenhouseAdapter } from './adapters/greenhouse.js';
import { leverAdapter } from './adapters/lever.js';
import { smartRecruitersAdapter } from './adapters/smartrecruiters.js';
import type { FormAdapter } from './types.js';

/**
 * What Open & fill will do for one application, decided before Chrome is
 * touched (J29). Pure: no I/O, no clock. A job board's page is never opened
 * for filling; the employer's own link, when Kris set one, comes first.
 */

const GREENHOUSE_BOARD = /greenhouse\.io|grnh\.se/i;

/**
 * A SmartRecruiters job ad has an "I'm interested" button and no form. The
 * public posting's apply URL adds `oga=true`, which redirects to Easy Apply.
 */
export function openSmartRecruitersForm(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!/^jobs\.smartrecruiters\.com$/i.test(parsed.hostname)) return url;
  if (
    parsed.pathname.includes('/oneclick-ui/') ||
    parsed.pathname.includes('/external-referrals/')
  ) {
    return url;
  }
  if (parsed.searchParams.get('oga') === 'true') return parsed.toString();
  parsed.searchParams.set('oga', 'true');
  return parsed.toString();
}

/**
 * The URL to open. An explicit apply URL wins. A Greenhouse job whose stored
 * URL is the company's own career page (Stripe does this) has no form there;
 * the embedded Greenhouse application does.
 */
export function resolveApplyUrl(input: {
  ats: string;
  url: string;
  applyUrl: string | null;
  externalId: string;
  boardToken: string | null;
}): string {
  const explicit = input.applyUrl?.trim();
  if (explicit) return openSmartRecruitersForm(explicit);
  if (
    input.ats === 'greenhouse' &&
    input.boardToken &&
    input.externalId &&
    !GREENHOUSE_BOARD.test(input.url)
  ) {
    const token = encodeURIComponent(input.boardToken);
    const id = encodeURIComponent(input.externalId);
    return `https://job-boards.greenhouse.io/embed/job_app?for=${token}&token=${id}`;
  }
  return openSmartRecruitersForm(input.url);
}

/** The ATSs with their own form adapter, tried by the URL's host. */
const FORM_ADAPTERS: readonly FormAdapter[] = [
  greenhouseAdapter,
  leverAdapter,
  ashbyAdapter,
  smartRecruitersAdapter,
];

/** The adapter whose ATS hosts this URL, or undefined. */
export function adapterForHost(url: string): FormAdapter | undefined {
  return FORM_ADAPTERS.find((adapter) => adapter.canHandle(url));
}

/**
 * The form adapter for a page: the one whose host the URL is on, then the
 * job's own ATS, then generic. A JSearch hit whose link is on Ashby is filled
 * as an Ashby form.
 */
export function selectAdapter(ats: string, url: string): FormAdapter {
  return (
    adapterForHost(url) ?? FORM_ADAPTERS.find((adapter) => adapter.ats === ats) ?? genericAdapter
  );
}

export type PlanAdapter = FormAdapter['ats'];

/** One of the employer's own apply links, as the job-board notice lists it. */
export interface PlanOption {
  publisher: string;
  url: string;
  host: string;
  direct: boolean;
}

export type ApplyPlan =
  | {
      kind: 'open';
      url: string;
      adapter: PlanAdapter;
      /** `employer`: the link Kris set on the application. */
      from: 'employer' | 'job';
    }
  | {
      kind: 'stop';
      reason: 'job-board';
      /** The job-board link that stopped it. Never opened. */
      url: string;
      host: string;
      /** Who hosts the stopped link, when the source named it. */
      publisher: string | null;
      /** The job's stored apply links on the employer's own site or job system. */
      options: PlanOption[];
      /** Its other stored links: job boards, and sites not tied to the employer. Never listed. */
      otherLinks: number;
    };

export interface PlanInput {
  job: {
    ats: string;
    url: string;
    applyUrl: string | null;
    externalId: string;
    applyOptions: readonly ApplyOption[] | null;
  };
  /** The stored company name, which decides which apply links are the employer's. */
  company: string;
  /** `applications.apply_url`: the employer's own link, set by Kris. */
  employerLink: string | null;
  boardToken: string | null;
}

/**
 * The job's stored apply links, minus any on `exceptHost` (the stopped
 * link's), split into the employer's own and a count of the rest.
 */
export function planOptions(
  options: readonly ApplyOption[] | null,
  company: string,
  exceptHost?: string,
): { options: PlanOption[]; otherLinks: number } {
  const tied: PlanOption[] = [];
  let otherLinks = 0;
  for (const option of options ?? []) {
    const host = urlHost(option.url);
    if (!host || host === exceptHost) continue;
    if (!isEmployerLink(option.url, company)) {
      otherLinks += 1;
      continue;
    }
    tied.push({ publisher: option.publisher, url: option.url, host, direct: option.direct });
  }
  return { options: tied, otherLinks };
}

export function planApply(input: PlanInput): ApplyPlan {
  const employer = input.employerLink?.trim();
  const url = employer
    ? openSmartRecruitersForm(employer)
    : resolveApplyUrl({
        ats: input.job.ats,
        url: input.job.url,
        applyUrl: input.job.applyUrl,
        externalId: input.job.externalId,
        boardToken: input.boardToken,
      });
  const host = urlHost(url);
  if (host && aggregatorFor(host)) {
    const publisher =
      input.job.applyOptions?.find((option) => option.url === url || urlHost(option.url) === host)
        ?.publisher ?? null;
    return {
      kind: 'stop',
      reason: 'job-board',
      url,
      host,
      publisher,
      ...planOptions(input.job.applyOptions, input.company, host),
    };
  }
  return {
    kind: 'open',
    url,
    adapter: selectAdapter(input.job.ats, url).ats,
    from: employer ? 'employer' : 'job',
  };
}
