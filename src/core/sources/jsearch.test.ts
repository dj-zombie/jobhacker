import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Http } from '../util/http.js';
import {
  JSEARCH_TIMEOUT_MS,
  jsearchAdapter,
  jsearchDetailsUrl,
  parseJsearch,
  parseJsearchDetails,
} from './jsearch.js';

const FIXTURES = join(process.cwd(), 'tests/fixtures');

describe('jsearchAdapter', () => {
  it('waits 45s and does not retry', async () => {
    let timeoutMs: number | undefined;
    let maxTries: number | undefined;
    let sawKey = false;
    const http: Http = {
      async getJson(_url, init) {
        timeoutMs = init?.timeoutMs;
        maxTries = init?.maxTries;
        sawKey = init?.headers?.['x-api-key'] === 'test-key';
        return {
          data: [
            {
              job_id: 'abc',
              job_title: 'Senior Frontend Engineer',
              employer_name: 'Example',
              job_apply_link: 'https://boards.greenhouse.io/example/jobs/1',
            },
          ],
        };
      },
      async postJson() {
        throw new Error('postJson is not used');
      },
    };
    const hits = await jsearchAdapter.search(
      {
        titles: ['senior frontend engineer'],
        remoteOnly: true,
        location: 'United States',
        since: '2026-10-01T00:00:00.000Z',
      },
      { http, key: 'test-key', charge: () => true },
    );
    expect(timeoutMs).toBe(JSEARCH_TIMEOUT_MS);
    expect(JSEARCH_TIMEOUT_MS).toBe(45_000);
    expect(maxTries).toBe(1);
    expect(sawKey).toBe(true);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.posting.externalId).toBe('abc');
  });

  it('does not call when the budget is spent', async () => {
    const http: Http = {
      async getJson() {
        throw new Error('should not call');
      },
      async postJson() {
        throw new Error('postJson is not used');
      },
    };
    const hits = await jsearchAdapter.search(
      {
        titles: ['senior frontend engineer'],
        remoteOnly: false,
        since: '2026-10-01T00:00:00.000Z',
      },
      { http, key: 'test-key', charge: () => false },
    );
    expect(hits).toEqual([]);
  });
});

describe('parseJsearch', () => {
  it('rejects a body with no listings', () => {
    expect(() => parseJsearch({ status: 'OK' })).toThrow(/no listings/);
  });
});

type Row = Record<string, unknown>;
const SEARCH = JSON.parse(readFileSync(join(FIXTURES, 'jsearch-search.json'), 'utf8')) as {
  data: Row[];
};
const DETAILS = JSON.parse(readFileSync(join(FIXTURES, 'jsearch-details.json'), 'utf8')) as {
  data: Row[];
};

/** The first recorded job, its apply links replaced. */
function withOptions(options: unknown[], overrides: Row = {}): Row {
  const first = SEARCH.data[0];
  if (!first) throw new Error('jsearch-search.json has no jobs');
  return { ...first, apply_options: options, ...overrides };
}

function only(row: Row) {
  const hits = parseJsearch({ data: [row] });
  expect(hits).toHaveLength(1);
  const hit = hits[0];
  if (!hit) throw new Error('no hit');
  return hit.posting;
}

const JOBLEADS = {
  publisher: 'JobLeads',
  apply_link: 'https://www.jobleads.com/us/job/senior-frontend-engineer--remote--e1',
  is_direct: false,
};
const ASHBY = {
  publisher: 'Ashby',
  apply_link: 'https://jobs.ashbyhq.com/fabrikam/7c1e/application',
  is_direct: false,
};

describe('JSearch apply options (recorded)', () => {
  it('parses the options on every recorded search job, and drops a malformed one', () => {
    const hits = parseJsearch(SEARCH);
    expect(hits).toHaveLength(3);
    for (const hit of hits) expect(hit.posting.applyOptions?.length).toBeGreaterThan(0);

    const posting = only(
      withOptions([
        JOBLEADS,
        { publisher: 'Broken', apply_link: 'not a url' },
        { publisher: 'Mail', apply_link: 'mailto:jobs@fabrikam.example' },
        { apply_link: 'https://fabrikam.example/careers/1' },
        'junk',
      ]),
    );
    expect(posting.applyOptions?.map((o) => o.publisher)).toContain('JobLeads');
    expect(posting.applyOptions?.some((o) => o.publisher === 'Broken')).toBe(false);
    expect(posting.applyOptions?.some((o) => o.publisher === 'Mail')).toBe(false);
    expect(posting.applyOptions?.some((o) => o.url.includes('fabrikam.example'))).toBe(false);
  });

  it('keeps no options as null when JSearch sent none', () => {
    const posting = only(withOptions([], { apply_options: undefined }));
    expect(posting.applyOptions).toBeNull();
  });

  it("an Ashby link beats a JobLeads link when it's the employer's board", () => {
    const posting = only(
      withOptions([JOBLEADS, ASHBY], {
        employer_name: 'Fabrikam',
        job_apply_link: JOBLEADS.apply_link,
        job_publisher: 'JobLeads',
      }),
    );
    expect(posting.applyUrl).toBe(ASHBY.apply_link);
  });

  it("another company's form is never the apply URL, and nothing is tied to a placeholder", () => {
    for (const employer of ['Credible', 'Remote', 'Confidential']) {
      const posting = only(
        withOptions([JOBLEADS, ASHBY, { ...ASHBY, apply_link: 'https://remote.com/jobs/1' }], {
          employer_name: employer,
          job_apply_link: JOBLEADS.apply_link,
          job_publisher: 'JobLeads',
        }),
      );
      expect(posting.applyUrl).toBe(JOBLEADS.apply_link);
    }
  });

  it("a direct link on the employer's own site beats a job board", () => {
    const direct = {
      publisher: 'Fabrikam Careers',
      apply_link: 'https://careers.fabrikam.example/jobs/42',
      is_direct: true,
    };
    const posting = only(
      withOptions([JOBLEADS, direct], {
        employer_name: 'Fabrikam',
        job_apply_link: JOBLEADS.apply_link,
        job_publisher: 'JobLeads',
      }),
    );
    expect(posting.applyUrl).toBe(direct.apply_link);
    expect(posting.applyOptions?.find((o) => o.url === direct.apply_link)?.direct).toBe(true);
    const elsewhere = only(
      withOptions([JOBLEADS, direct], {
        employer_name: 'Credible',
        job_apply_link: JOBLEADS.apply_link,
        job_publisher: 'JobLeads',
      }),
    );
    expect(elsewhere.applyUrl).toBe(JOBLEADS.apply_link);
  });

  it('all job boards falls back to job_apply_link', () => {
    const hits = parseJsearch(SEARCH);
    for (const [i, hit] of hits.entries()) {
      expect(hit.posting.applyUrl).toBe(SEARCH.data[i]?.job_apply_link);
    }
  });

  it('url is unchanged: still job_apply_link, whatever the apply URL', () => {
    const posting = only(
      withOptions([JOBLEADS, ASHBY], {
        employer_name: 'Fabrikam',
        job_apply_link: JOBLEADS.apply_link,
        job_publisher: 'JobLeads',
      }),
    );
    expect(posting.url).toBe(JOBLEADS.apply_link);
    expect(posting.applyUrl).toBe(ASHBY.apply_link);
  });
});

describe('parseJsearchDetails (recorded)', () => {
  it('reads every apply option for the job', () => {
    const details = parseJsearchDetails(DETAILS);
    expect(details).toHaveLength(1);
    const first = details[0];
    expect(first?.jobId).toBe(DETAILS.data[0]?.job_id);
    expect(first?.applyLink).toBe(DETAILS.data[0]?.job_apply_link);
    const recorded = DETAILS.data[0]?.apply_options;
    expect(Array.isArray(recorded) ? recorded.length : 0).toBeGreaterThan(1);
    expect(first?.options).toHaveLength(Array.isArray(recorded) ? recorded.length : 0);
  });

  it('reads an empty data as not found, and a job with no options as []', () => {
    expect(parseJsearchDetails({ status: 'OK', data: [] })).toEqual([]);
    const row = DETAILS.data[0];
    const [none] = parseJsearchDetails({ data: [{ ...row, apply_options: null }] });
    expect(none?.options).toEqual([]);
  });

  it('asks for one job by id', () => {
    expect(jsearchDetailsUrl('a b==')).toBe(
      'https://api.openwebninja.com/jsearch/job-details?job_id=a+b%3D%3D',
    );
  });
});
