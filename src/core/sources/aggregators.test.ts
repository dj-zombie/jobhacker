import { describe, expect, it } from 'vitest';
import { AGGREGATOR_HOSTS, aggregatorFor, isAggregatorUrl } from './aggregators.js';

describe('isAggregatorUrl', () => {
  it('matches a job board on its registrable domain, subdomains included', () => {
    expect(isAggregatorUrl('https://us.jooble.org/x')).toBe(true);
    expect(isAggregatorUrl('https://www.jobleads.com/us/job/abc')).toBe(true);
    expect(isAggregatorUrl('https://us.trabajo.org/job-1')).toBe(true);
    expect(isAggregatorUrl('https://us.remotejobs.dedyn.io/job/1')).toBe(true);
    expect(isAggregatorUrl('https://www.linkedin.com/jobs/view/1')).toBe(true);
    expect(isAggregatorUrl('https://www.ycombinator.com/companies/initech/jobs/1')).toBe(true);
  });

  it("is false for ATS hosts and an employer's own careers site", () => {
    expect(isAggregatorUrl('https://jobs.ashbyhq.com/initech/1')).toBe(false);
    expect(isAggregatorUrl('https://careers.homedepot.com/job/123')).toBe(false);
    expect(isAggregatorUrl('https://job-boards.greenhouse.io/initech/jobs/1')).toBe(false);
    expect(isAggregatorUrl('https://initech.wd1.myworkdaysite.com/jobs/1')).toBe(false);
  });

  it('reads the host only, never the path or query', () => {
    expect(isAggregatorUrl('https://careers.initech.example/?src=jobleads.com')).toBe(false);
    expect(isAggregatorUrl('https://notjooble.org/x')).toBe(false);
    expect(isAggregatorUrl('not a url')).toBe(false);
    expect(isAggregatorUrl('mailto:jobs@jobleads.com')).toBe(false);
  });

  it('names the board a host is on', () => {
    expect(aggregatorFor('us.jooble.org')).toBe('jooble.org');
    expect(aggregatorFor('careers.homedepot.com')).toBeNull();
    expect(new Set(AGGREGATOR_HOSTS).size).toBe(AGGREGATOR_HOSTS.length);
  });
});
