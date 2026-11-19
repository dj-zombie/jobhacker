import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyOptionsOf } from '../sources/jsearch.js';
import type { ApplyOption } from '../sources/types.js';
import { ashbyAdapter } from './adapters/ashby.js';
import { greenhouseAdapter } from './adapters/greenhouse.js';
import { leverAdapter } from './adapters/lever.js';
import { smartRecruitersAdapter } from './adapters/smartrecruiters.js';
import { FILLABLE_ATS } from './apply.js';
import { type PlanInput, planApply, resolveApplyUrl, selectAdapter } from './plan.js';

const JOBLEADS = 'https://www.jobleads.com/us/job/senior-frontend-engineer--remote--e1';
const ASHBY = 'https://jobs.ashbyhq.com/initech/0a1b2c/application';

function searchJob(
  applyUrl: string,
  applyOptions: ApplyOption[] | null = null,
  company = 'Initech',
): PlanInput {
  return {
    job: { ats: 'jsearch', url: applyUrl, applyUrl, externalId: 'js-1', applyOptions },
    company,
    employerLink: null,
    boardToken: null,
  };
}

/** Job 51039's job-details response, recorded 2026-11-11: Oowlish's posting, listed as "Remote". */
const GROUPED = JSON.parse(readFileSync('tests/fixtures/jsearch-details-grouped.json', 'utf8')) as {
  data: Parameters<typeof applyOptionsOf>[0][];
};

describe('resolveApplyUrl', () => {
  it('keeps a Greenhouse URL that is already on greenhouse.io', () => {
    expect(
      resolveApplyUrl({
        ats: 'greenhouse',
        url: 'https://job-boards.greenhouse.io/discord/jobs/8214127002',
        applyUrl: null,
        externalId: '8214127002',
        boardToken: 'discord',
      }),
    ).toBe('https://job-boards.greenhouse.io/discord/jobs/8214127002');
  });

  it('opens the Greenhouse embed when the stored URL is a company career page', () => {
    // Stripe's absolute_url is stripe.com and that page has no application form.
    expect(
      resolveApplyUrl({
        ats: 'greenhouse',
        url: 'https://stripe.com/jobs/search?gh_jid=8172510',
        applyUrl: null,
        externalId: '8172510',
        boardToken: 'stripe',
      }),
    ).toBe('https://job-boards.greenhouse.io/embed/job_app?for=stripe&token=8172510');
  });

  it('opens the SmartRecruiters easy-apply form instead of the job ad', () => {
    const ad = 'https://jobs.smartrecruiters.com/Canva/6000000001468836';
    expect(
      resolveApplyUrl({
        ats: 'smartrecruiters',
        url: ad,
        applyUrl: ad,
        externalId: '6000000001468836',
        boardToken: 'canva',
      }),
    ).toBe(`${ad}?oga=true`);
  });

  it('leaves a SmartRecruiters easy-apply URL alone', () => {
    const form = 'https://jobs.smartrecruiters.com/oneclick-ui/company/Canva/publication/abc';
    expect(
      resolveApplyUrl({
        ats: 'smartrecruiters',
        url: form,
        applyUrl: form,
        externalId: 'abc',
        boardToken: 'canva',
      }),
    ).toBe(form);
  });

  it('prefers an explicit apply URL for Lever and Ashby', () => {
    expect(
      resolveApplyUrl({
        ats: 'lever',
        url: 'https://jobs.lever.co/spotify/abc',
        applyUrl: 'https://jobs.lever.co/spotify/abc/apply',
        externalId: 'abc',
        boardToken: 'spotify',
      }),
    ).toBe('https://jobs.lever.co/spotify/abc/apply');
  });
});

describe('selectAdapter', () => {
  it("falls back to the job's ATS, then generic", () => {
    for (const ats of FILLABLE_ATS)
      expect(selectAdapter(ats, 'https://example.com/x').ats).toBe(ats);
    expect(selectAdapter('smartrecruiters', 'https://example.com/x').ats).toBe('smartrecruiters');
    expect(selectAdapter('jsearch', 'https://careers.initech.example/apply').ats).toBe('generic');
  });

  it("picks the adapter by the URL's host before job.ats", () => {
    expect(selectAdapter('jsearch', ASHBY).ats).toBe('ashby');
    expect(selectAdapter('hn', 'https://jobs.lever.co/initech/abc').ats).toBe('lever');
    expect(selectAdapter('jsearch', 'https://grnh.se/abc123').ats).toBe('greenhouse');
    expect(selectAdapter('jobspipe', 'https://jobs.smartrecruiters.com/Initech/1').ats).toBe(
      'smartrecruiters',
    );
    expect(selectAdapter('greenhouse', ASHBY).ats).toBe('ashby');
  });

  it('matches the host, never a domain in the query string', () => {
    const sneaky = 'https://www.jobleads.com/apply?next=https://jobs.lever.co/initech/abc';
    expect(leverAdapter.canHandle(sneaky)).toBe(false);
    expect(ashbyAdapter.canHandle('https://example.com/?ref=jobs.ashbyhq.com')).toBe(false);
    expect(greenhouseAdapter.canHandle('https://example.com/greenhouse.io/x')).toBe(false);
    expect(smartRecruitersAdapter.canHandle('https://x.example/?jobs.smartrecruiters.com')).toBe(
      false,
    );
    expect(leverAdapter.canHandle('https://jobs.eu.lever.co/initech/abc')).toBe(true);
    expect(ashbyAdapter.canHandle(ASHBY)).toBe(true);
    expect(greenhouseAdapter.canHandle('https://job-boards.greenhouse.io/initech/jobs/1')).toBe(
      true,
    );
    expect(selectAdapter('jsearch', sneaky).ats).toBe('generic');
  });
});

describe('planApply', () => {
  it("stops on a JobLeads link, listing only the employer's own links and counting the rest", () => {
    const options: ApplyOption[] = [
      { publisher: 'JobLeads', url: JOBLEADS, direct: false },
      { publisher: 'LinkedIn', url: 'https://www.linkedin.com/jobs/view/1', direct: false },
      { publisher: 'Initech Careers', url: 'https://careers.initech.example/jobs/9', direct: true },
    ];
    expect(planApply(searchJob(JOBLEADS, options))).toEqual({
      kind: 'stop',
      reason: 'job-board',
      url: JOBLEADS,
      host: 'jobleads.com',
      publisher: 'JobLeads',
      options: [
        {
          publisher: 'Initech Careers',
          url: 'https://careers.initech.example/jobs/9',
          host: 'careers.initech.example',
          direct: true,
        },
      ],
      otherLinks: 1,
    });
  });

  it("never lists another company's posting from JSearch's group (job 51039, recorded)", () => {
    const recorded = GROUPED.data[0];
    if (!recorded) throw new Error('jsearch-details-grouped.json has no job');
    const options = applyOptionsOf(recorded) ?? [];
    expect(options.map((o) => o.url).join(' ')).toMatch(/general-intuition.*codilime/);
    const plan = planApply(searchJob(JOBLEADS, options, 'Remote'));
    expect(plan).toMatchObject({ kind: 'stop', host: 'jobleads.com', options: [], otherLinks: 7 });
    const named = planApply(searchJob(JOBLEADS, options, 'Oowlish'));
    expect(named).toMatchObject({ kind: 'stop', options: [], otherLinks: 7 });
    const codilime = planApply(searchJob(JOBLEADS, options, 'CodiLime'));
    expect(codilime).toMatchObject({ kind: 'stop', options: [], otherLinks: 7 });
  });

  it("leaves the stopped board's other copies of the same job out of the count", () => {
    const tracked = `${JOBLEADS}?utm_source=google_jobs_apply`;
    const plan = planApply(
      searchJob(JOBLEADS, [
        { publisher: 'JobLeads', url: tracked, direct: false },
        { publisher: 'Learn4Good', url: 'https://www.learn4good.com/jobs/1', direct: false },
      ]),
    );
    expect(plan).toMatchObject({
      kind: 'stop',
      host: 'jobleads.com',
      publisher: 'JobLeads',
      options: [],
      otherLinks: 1,
    });
  });

  it('stops on a job board with no stored options (JobsPipe, HN)', () => {
    const plan = planApply({
      job: {
        ats: 'jobspipe',
        url: 'https://www.indeed.com/viewjob?jk=abc',
        applyUrl: 'https://www.indeed.com/viewjob?jk=abc',
        externalId: 'jp-1',
        applyOptions: null,
      },
      company: 'Initech',
      employerLink: null,
      boardToken: null,
    });
    expect(plan).toMatchObject({
      kind: 'stop',
      host: 'indeed.com',
      publisher: null,
      options: [],
      otherLinks: 0,
    });
  });

  it('opens a JSearch job whose apply link is on Ashby with the Ashby adapter', () => {
    expect(planApply(searchJob(ASHBY))).toEqual({
      kind: 'open',
      url: ASHBY,
      adapter: 'ashby',
      from: 'job',
    });
  });

  it('puts the employer link Kris set ahead of a JobLeads apply URL', () => {
    const input = { ...searchJob(JOBLEADS), employerLink: ' https://jobs.lever.co/initech/abc ' };
    expect(planApply(input)).toEqual({
      kind: 'open',
      url: 'https://jobs.lever.co/initech/abc',
      adapter: 'lever',
      from: 'employer',
    });
  });

  it('opens an employer careers page with the generic adapter', () => {
    expect(planApply(searchJob('https://careers.homedepot.com/job/123'))).toMatchObject({
      kind: 'open',
      adapter: 'generic',
    });
  });

  it('keeps the Greenhouse embed and SmartRecruiters oga rules', () => {
    expect(
      planApply({
        job: {
          ats: 'greenhouse',
          url: 'https://stripe.com/jobs/search?gh_jid=8172510',
          applyUrl: null,
          externalId: '8172510',
          applyOptions: null,
        },
        company: 'Stripe',
        employerLink: null,
        boardToken: 'stripe',
      }),
    ).toEqual({
      kind: 'open',
      url: 'https://job-boards.greenhouse.io/embed/job_app?for=stripe&token=8172510',
      adapter: 'greenhouse',
      from: 'job',
    });
    const ad = 'https://jobs.smartrecruiters.com/Canva/6000000001468836';
    expect(
      planApply({
        job: {
          ats: 'smartrecruiters',
          url: ad,
          applyUrl: ad,
          externalId: '6000000001468836',
          applyOptions: null,
        },
        company: 'Canva',
        employerLink: null,
        boardToken: 'canva',
      }),
    ).toEqual({ kind: 'open', url: `${ad}?oga=true`, adapter: 'smartrecruiters', from: 'job' });
  });
});
