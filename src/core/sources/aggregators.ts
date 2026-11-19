import { hostIsOn, urlHost } from '../util/host.js';

/**
 * Job boards: sites that list other companies' jobs (J29). Open & fill never
 * types into one of their pages, and an apply link on one is never the
 * employer's form. An employer's own careers site (careers.homedepot.com) is
 * not a job board, and neither is an ATS host (detect.ts).
 *
 * The spec's list, plus each other host with 3 or more search jobs that lists
 * other companies' jobs (STATUS, J29 build). Pure: nothing here fetches.
 */
export const AGGREGATOR_HOSTS: readonly string[] = [
  'jobleads.com',
  'learn4good.com',
  'trabajo.org',
  'jooble.org',
  'jobgether.com',
  'ziprecruiter.com',
  'jobright.ai',
  'jobmesh.io',
  'monster.com',
  'talent.com',
  'bebee.com',
  'remoterocketship.com',
  'remotejobs.dedyn.io',
  'upwork.com',
  'himalayas.app',
  'jobicy.com',
  'linkedin.com',
  'indeed.com',
  'glassdoor.com',
  // YC's Work at a Startup: 5 search jobs link to ycombinator.com/companies/<name>/jobs/<id>.
  'ycombinator.com',
  // Seen in JSearch job-details apply options at build time (J29): each lists other companies'
  // jobs. Free-hosting subdomains are listed whole, never their shared parent domain.
  'simplyhired.com',
  'jobrapido.com',
  'digitalhire.com',
  'tsenta.com',
  'talents.vaia.com',
  'birjob.com',
  'aworkado.co',
  'remotefront.com',
  'careervault.io',
  'lifeworq.com',
  'jobscout.liveblog365.com',
  'jobflow.r3k.liveblog365.com',
  'wfhsprint.2q.unaux.com',
  'verdix.r1l.web1337.net',
  'socomparepo.blogspot.com',
];

/** The job board a host belongs to, or null. */
export function aggregatorFor(host: string): string | null {
  return AGGREGATOR_HOSTS.find((domain) => hostIsOn(host, domain)) ?? null;
}

/** True when the URL's host is a job board's (us.jooble.org counts as jooble.org). */
export function isAggregatorUrl(url: string): boolean {
  const host = urlHost(url);
  return host !== null && aggregatorFor(host) !== null;
}
