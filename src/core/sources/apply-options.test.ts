import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isEmployerLink, rankApplyOptions, tokenNamesCompany } from './apply-options.js';
import { applyOptionsOf } from './jsearch.js';
import { isPlaceholderEmployer, shownEmployer } from './placeholder-employers.js';

const GROUPED = JSON.parse(readFileSync('tests/fixtures/jsearch-details-grouped.json', 'utf8')) as {
  data: Parameters<typeof applyOptionsOf>[0][];
};

describe('tokenNamesCompany', () => {
  it('reads a token as the start of the company name, past case, spaces and legal suffixes', () => {
    expect(tokenNamesCompany('netboxlabs', 'NetBox Labs, Inc.')).toBe(true);
    expect(tokenNamesCompany('homedepot', 'The Home Depot')).toBe(true);
    expect(tokenNamesCompany('palantir', 'Palantir Technologies')).toBe(true);
    expect(tokenNamesCompany('general-intuition', 'General Intuition')).toBe(true);
    expect(tokenNamesCompany('Canva', 'Canva')).toBe(true);
  });

  it('is false for another company, a fragment of a word, or a token under 3 letters', () => {
    expect(tokenNamesCompany('olo', 'GreatFrontEnd')).toBe(false);
    expect(tokenNamesCompany('codilime', 'Oowlish')).toBe(false);
    expect(tokenNamesCompany('net', 'NetBox Labs')).toBe(false);
    expect(tokenNamesCompany('labs', 'NetBox Labs')).toBe(false);
    expect(tokenNamesCompany('hp', 'HP')).toBe(false);
  });
});

describe('isEmployerLink', () => {
  it("ties an ATS board or a site to the employer by the name in the URL's host or board", () => {
    expect(isEmployerLink('https://jobs.ashbyhq.com/fabrikam/7c1e', 'Fabrikam')).toBe(true);
    expect(isEmployerLink('https://boards.greenhouse.io/stripe/jobs/1', 'Stripe, Inc.')).toBe(true);
    expect(isEmployerLink('https://sprouts.wd5.myworkdayjobs.com/x/job/1', 'Sprouts')).toBe(true);
    expect(isEmployerLink('https://careers.homedepot.com/job/123', 'The Home Depot')).toBe(true);
    expect(isEmployerLink('https://oowlish.com/jobs/senior-frontend', 'Oowlish')).toBe(true);
    expect(
      isEmployerLink(
        'https://www.greatfrontend.com/jobs/senior-front-end-software-engineer',
        'GreatFrontEnd',
      ),
    ).toBe(true);
  });

  it("is false for another company's board, a job board, a placeholder, or a name in the path", () => {
    expect(isEmployerLink('https://jobs.ashbyhq.com/olo/1', 'GreatFrontEnd')).toBe(false);
    expect(isEmployerLink('https://www.birjob.com/jobs/react-codilime-1', 'CodiLime')).toBe(false);
    expect(
      isEmployerLink('https://talents.vaia.com/companies/general-intuition/x', 'General Intuition'),
    ).toBe(false);
    expect(isEmployerLink('https://remote.com/jobs/1', 'Remote')).toBe(false);
    expect(isEmployerLink('https://careers.example.com/oowlish/1', 'Oowlish')).toBe(false);
    expect(isEmployerLink('ftp://oowlish.com/jobs', 'Oowlish')).toBe(false);
  });

  it("ties none of job 51039's recorded links to Remote, Oowlish or CodiLime", () => {
    const recorded = GROUPED.data[0];
    if (!recorded) throw new Error('jsearch-details-grouped.json has no job');
    const options = applyOptionsOf(recorded) ?? [];
    expect(options.length).toBe(8);
    for (const company of ['Remote', 'Oowlish', 'CodiLime', 'General Intuition']) {
      expect(options.filter((o) => isEmployerLink(o.url, company))).toEqual([]);
      expect(rankApplyOptions(options, 'https://www.jobleads.com/x', company)).toBe(
        'https://www.jobleads.com/x',
      );
    }
  });
});

describe('placeholder employers', () => {
  it('reads Remote, Confidential and Stealth as no employer, and shows them as not named', () => {
    for (const name of ['Remote', 'CONFIDENTIAL', 'Stealth', 'Stealth Startup', ' remote ']) {
      expect(isPlaceholderEmployer(name)).toBe(true);
      expect(shownEmployer(name)).toBe('Employer not named');
    }
    for (const name of ['Remote.com', 'Remote Technology, Inc.', 'Oowlish', 'Stealth Labs']) {
      expect(isPlaceholderEmployer(name)).toBe(false);
      expect(shownEmployer(name)).toBe(name);
    }
  });
});
