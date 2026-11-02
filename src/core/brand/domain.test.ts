import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ashbyAdapter } from '../sources/ashby.js';
import { breezyAdapter } from '../sources/breezy.js';
import { greenhouseAdapter } from '../sources/greenhouse.js';
import { leverAdapter } from '../sources/lever.js';
import { polymerAdapter } from '../sources/polymer.js';
import { smartRecruitersAdapter } from '../sources/smartrecruiters.js';
import type { CompanyRef, SourceAdapter } from '../sources/types.js';
import { normalizeCompanyName } from '../util/hash.js';
import {
  type CompanyInput,
  type DomainChoice,
  type JobLink,
  PLATFORM_DOMAINS,
  descriptionMatchesName,
  domainMatchesName,
  findCompanyDomains,
  registrableDomain,
} from './domain.js';

function read(name: string): unknown {
  return JSON.parse(readFileSync(`tests/fixtures/${name}`, 'utf8'));
}

function job(partial: Partial<JobLink> & Pick<JobLink, 'url'>): JobLink {
  return {
    applyUrl: null,
    post: null,
    text: null,
    companyWebsite: null,
    sourceQuality: 'high',
    ...partial,
  };
}

function choice(name: string, jobs: JobLink[]): DomainChoice | null {
  const found = findCompanyDomains([{ name, jobs }]);
  const value = found.get(normalizeCompanyName(name));
  return value === undefined ? null : value;
}

const board = <T>(
  file: string,
  adapter: SourceAdapter<T>,
  company: CompanyRef,
): { company: string; url: string }[] => {
  const parsed = adapter.parse(read(file));
  return parsed.postings.map((posting) => ({
    company: company.name,
    url: adapter.normalize(posting, company).url,
  }));
};

describe('registrable domains', () => {
  it('reduces a careers host on a two-part public suffix', () => {
    expect(registrableDomain('https://careers.acme.co.uk/jobs')).toBe('acme.co.uk');
    expect(registrableDomain('https://careers.datadoghq.com/detail/1/?gh_jid=1')).toBe(
      'datadoghq.com',
    );
    expect(registrableDomain('not a url')).toBeNull();
    expect(registrableDomain('Next.js')).toBeNull();
    expect(registrableDomain('Node.js')).toBeNull();
  });
});

describe('name match', () => {
  it('matches a label that contains the name, and a name that contains a long label', () => {
    expect(domainMatchesName('acme.com', 'Acme')).toBe(true);
    expect(domainMatchesName('datadoghq.com', 'Datadog')).toBe(true);
    expect(domainMatchesName('typeform.com', 'Acme')).toBe(false);
    expect(domainMatchesName('x.com', 'Roblox')).toBe(false);
  });

  it('lets a description mention a short suffix, and a name that ends in its own suffix', () => {
    expect(descriptionMatchesName('datadoghq.com', 'Datadog')).toBe(true);
    expect(descriptionMatchesName('cloudflare.com', 'Cloud')).toBe(false);
    expect(descriptionMatchesName('mobi.ai', 'Mobi.AI')).toBe(true);
    expect(descriptionMatchesName('berlitzinstaladora.com.br', 'Berlitz')).toBe(false);
    expect(descriptionMatchesName('wearlively.com', 'Lively')).toBe(false);
  });
});

describe('finder', () => {
  const cases: {
    title: string;
    companies: CompanyInput[];
    name: string;
    expect: DomainChoice | null;
  }[] = [
    {
      title: 'careers subdomain on a two-part suffix',
      companies: [{ name: 'Acme', jobs: [job({ url: 'https://careers.acme.co.uk/jobs/1' })] }],
      name: 'Acme',
      expect: { domain: 'acme.co.uk', source: 'url' },
    },
    {
      title: 'Datadog careers host',
      companies: [
        {
          name: 'Datadog',
          jobs: [job({ url: 'https://careers.datadoghq.com/detail/7985840/?gh_jid=7985840' })],
        },
      ],
      name: 'Datadog',
      expect: { domain: 'datadoghq.com', source: 'url' },
    },
    {
      title: 'apply url when the posting url is an ATS host',
      companies: [
        {
          name: 'Acme',
          jobs: [
            job({
              url: 'https://job-boards.greenhouse.io/acme/jobs/1',
              applyUrl: 'https://careers.acme.com/apply/1',
            }),
          ],
        },
      ],
      name: 'Acme',
      expect: { domain: 'acme.com', source: 'apply_url' },
    },
    {
      title: 'link whose domain does not match the name',
      companies: [{ name: 'Acme', jobs: [job({ url: 'https://typeform.com/to/acme' })] }],
      name: 'Acme',
      expect: null,
    },
    {
      title: 'x.com does not match Roblox',
      companies: [{ name: 'Roblox', jobs: [job({ url: 'https://x.com/roblox' })] }],
      name: 'Roblox',
      expect: null,
    },
    {
      title: 'HN post link',
      companies: [
        {
          name: 'Flexibits',
          jobs: [
            job({
              url: 'https://news.ycombinator.com/item?id=1',
              post: 'Flexibits is hiring. https://flexibits.com/jobs',
              sourceQuality: 'low',
            }),
          ],
        },
      ],
      name: 'Flexibits',
      expect: { domain: 'flexibits.com', source: 'hn_link' },
    },
    {
      title: 'JSearch employer website, even when the label is not the name',
      companies: [
        {
          name: 'Acme',
          jobs: [
            job({
              url: 'https://www.indeed.com/viewjob?jk=1',
              companyWebsite: 'https://widgets.io',
            }),
          ],
        },
      ],
      name: 'Acme',
      expect: { domain: 'widgets.io', source: 'jsearch_website' },
    },
    {
      title: 'jobs that disagree: the domain most of them point at',
      companies: [
        {
          name: 'Acme',
          jobs: [
            job({ url: 'https://careers.acme.com/a' }),
            job({ url: 'https://careers.acme.com/b' }),
            job({ url: 'https://acme.io/c' }),
          ],
        },
      ],
      name: 'Acme',
      expect: { domain: 'acme.com', source: 'url' },
    },
    {
      title: 'a tie on count and quality finds nothing',
      companies: [
        {
          name: 'Acme',
          jobs: [job({ url: 'https://acme.com/a' }), job({ url: 'https://acme.io/b' })],
        },
      ],
      name: 'Acme',
      expect: null,
    },
    {
      title: 'a tie on count goes to the higher source quality',
      companies: [
        {
          name: 'Acme',
          jobs: [
            job({ url: 'https://acme.com/a', sourceQuality: 'low' }),
            job({ url: 'https://acme.io/b', sourceQuality: 'high' }),
          ],
        },
      ],
      name: 'Acme',
      expect: { domain: 'acme.io', source: 'url' },
    },
    {
      title: 'a link in the job text when the posting url is an ATS host',
      companies: [
        {
          name: 'Figma',
          jobs: [
            job({
              url: 'https://boards.greenhouse.io/figma/jobs/1',
              text: 'See https://www.figma.com/careers for more.',
            }),
          ],
        },
      ],
      name: 'Figma',
      expect: { domain: 'figma.com', source: 'description' },
    },
    {
      title: 'an email domain in the job text',
      companies: [
        {
          name: 'Acme',
          jobs: [
            job({
              url: 'https://boards.greenhouse.io/acme/jobs/1',
              text: 'Write to hr@acme.com.',
            }),
          ],
        },
      ],
      name: 'Acme',
      expect: { domain: 'acme.com', source: 'description' },
    },
    {
      title: 'a bare hostname in the job text',
      companies: [
        {
          name: 'GitLab',
          jobs: [
            job({
              url: 'https://boards.greenhouse.io/gitlab/jobs/1',
              text: 'GitLab.com is hiring.',
            }),
          ],
        },
      ],
      name: 'GitLab',
      expect: { domain: 'gitlab.com', source: 'description' },
    },
    {
      title: 'a framework name is not a domain',
      companies: [
        {
          name: 'Next',
          jobs: [
            job({
              url: 'https://boards.greenhouse.io/next/jobs/1',
              text: 'We use Next.js and Node.js every day.',
            }),
          ],
        },
      ],
      name: 'Next',
      expect: null,
    },
    {
      title: 'a link whose domain does not match the name stays empty',
      companies: [
        {
          name: 'Lively',
          jobs: [
            job({
              url: 'https://jobs.lever.co/lively/1',
              text: 'Form I-9: https://uscis.gov/i-9',
            }),
          ],
        },
      ],
      name: 'Lively',
      expect: null,
    },
    {
      title: 'other companies mentioning the site do not take it away',
      companies: [
        {
          name: 'Cloudflare',
          jobs: [
            job({
              url: 'https://boards.greenhouse.io/cloudflare/jobs/1',
              text: 'Work at https://www.cloudflare.com/careers',
            }),
            job({
              url: 'https://boards.greenhouse.io/cloudflare/jobs/2',
              text: 'Also https://blog.cloudflare.com/hello',
            }),
            job({
              url: 'https://boards.greenhouse.io/cloudflare/jobs/3',
              text: 'Watch https://cloudflare.tv',
            }),
          ],
        },
        {
          name: 'Cloud',
          jobs: [
            job({
              url: 'https://boards.greenhouse.io/cloud/jobs/1',
              text: 'We use https://www.cloudflare.com',
            }),
          ],
        },
        {
          name: 'Acme',
          jobs: [
            job({
              url: 'https://boards.greenhouse.io/acme/jobs/1',
              text: 'https://www.cloudflare.com/learning',
            }),
          ],
        },
      ],
      name: 'Cloudflare',
      expect: { domain: 'cloudflare.com', source: 'description' },
    },
    {
      title: 'a domain three companies point at never counts',
      companies: ['Acme', 'Beta', 'Gamma'].map((name) => ({
        name,
        jobs: [
          job({
            url: `https://${name.toLowerCase()}.com/jobs`,
            companyWebsite: 'https://recruiter.example/jobs',
          }),
        ],
      })),
      name: 'Acme',
      expect: { domain: 'acme.com', source: 'url' },
    },
  ];

  it.each(cases)('$title', ({ companies, name, expect: expected }) => {
    const found = findCompanyDomains(companies);
    expect(found.get(normalizeCompanyName(name)) ?? null).toEqual(expected);
  });

  it('drops the shared domain for the companies that had nothing else', () => {
    const found = findCompanyDomains([
      { name: 'Acme', jobs: [job({ url: null, companyWebsite: 'https://recruiter.example' })] },
      {
        name: 'Beta',
        jobs: [job({ url: null, companyWebsite: 'https://jobs.recruiter.example' })],
      },
      { name: 'Gamma', jobs: [job({ url: null, companyWebsite: 'https://recruiter.example/x' })] },
    ]);
    expect(found.get('acme')).toBeNull();
    expect(found.get('beta')).toBeNull();
    expect(found.get('gamma')).toBeNull();
  });

  it.each(PLATFORM_DOMAINS)('rejects platform host %s', (domain) => {
    const label = domain.split('.')[0] ?? domain;
    expect(choice(label, [job({ url: `https://${domain}/jobs` })])).toBeNull();
  });

  it('takes every board-fixture posting and HN story ids, and finds no company domain there', () => {
    const postings = [
      ...board('greenhouse-discord.json', greenhouseAdapter, {
        name: 'Discord',
        ats: 'greenhouse',
        token: 'discord',
      }),
      ...board('lever-spotify.json', leverAdapter, {
        name: 'Spotify',
        ats: 'lever',
        token: 'spotify',
      }),
      ...board('ashby-ramp.json', ashbyAdapter, { name: 'Ramp', ats: 'ashby', token: 'ramp' }),
      ...board('smartrecruiters-smartrecruiters.json', smartRecruitersAdapter, {
        name: 'SmartRecruiters',
        ats: 'smartrecruiters',
        token: 'smartrecruiters',
      }),
      ...board('breezy-rhynocare.json', breezyAdapter, {
        name: 'Rhynocare',
        ats: 'breezy',
        token: 'rhynocare',
      }),
      ...board('polymer-aperturelabs.json', polymerAdapter, {
        name: 'Aperture Labs',
        ats: 'polymer',
        token: 'aperturelabs',
      }),
    ];
    const story = read('hn-story.json') as { hits: { objectID: string; children: number[] }[] };
    const hit = story.hits[0];
    if (!hit) throw new Error('hn fixture has no story');
    const hnUrls = [hit.objectID, ...hit.children.slice(0, 15)].map(
      (id) => `https://news.ycombinator.com/item?id=${id}`,
    );
    const urls = [...postings.map((posting) => posting.url), ...hnUrls];
    expect(urls.length).toBeGreaterThanOrEqual(20);
    for (const url of urls) {
      expect(choice('Fixture Co', [job({ url })])).toBeNull();
    }
    for (const posting of postings) {
      expect(choice(posting.company, [job({ url: posting.url })])).toBeNull();
    }
  });
});
