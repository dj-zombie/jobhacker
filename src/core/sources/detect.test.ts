import { describe, expect, it } from 'vitest';
import { detectBoard, humanizeToken, plainCompanyName } from './detect.js';

describe('detectBoard', () => {
  it('reads the token from the four careers hosts', () => {
    expect(detectBoard('https://boards.greenhouse.io/discord')).toEqual({
      ats: 'greenhouse',
      token: 'discord',
    });
    expect(detectBoard('https://boards.greenhouse.io/stripe/jobs/8172508')).toEqual({
      ats: 'greenhouse',
      token: 'stripe',
    });
    expect(detectBoard('https://job-boards.greenhouse.io/discord/')).toEqual({
      ats: 'greenhouse',
      token: 'discord',
    });
    expect(
      detectBoard('https://jobs.lever.co/spotify/f7eb82ce-b57e-4dc0-b84a-7f7ec05bf66e/apply'),
    ).toEqual({
      ats: 'lever',
      token: 'spotify',
    });
    expect(detectBoard('https://www.jobs.ashbyhq.com/ramp/some-id?utm=1')).toEqual({
      ats: 'ashby',
      token: 'ramp',
    });
    expect(detectBoard('HTTP://JOBS.LEVER.CO/Spotify')).toEqual({ ats: 'lever', token: 'Spotify' });
  });

  it('reads the EU hosts and the token in an embed link', () => {
    expect(detectBoard('https://job-boards.eu.greenhouse.io/controlplane/jobs/501252')).toEqual({
      ats: 'greenhouse',
      token: 'controlplane',
    });
    expect(detectBoard('https://jobs.eu.lever.co/nordicsound')).toEqual({
      ats: 'lever',
      token: 'nordicsound',
    });
    expect(detectBoard('https://boards.greenhouse.io/embed/job_board?for=discord')).toEqual({
      ats: 'greenhouse',
      token: 'discord',
    });
  });

  it('rejects unknown hosts, the embed path with no token, and non-URLs', () => {
    expect(() => detectBoard('https://example.com/careers')).toThrow(
      /could not detect an ATS board/,
    );
    expect(() => detectBoard('https://boards.greenhouse.io/embed/job_board')).toThrow(
      /could not detect/,
    );
    expect(() => detectBoard('not a url')).toThrow(/could not detect/);
    expect(() => detectBoard('https://boards.greenhouse.io/')).toThrow(/could not detect/);
    expect(() => detectBoard('https://jobs.ashbyhq.com/jobs')).toThrow(/could not detect/);
  });

  it('rejects ATSs with no adapter', () => {
    expect(() => detectBoard('https://examplecorp.wd5.myworkdayjobs.com/External')).toThrow(
      /could not detect/,
    );
    expect(() => detectBoard('https://ats.rippling.com/example-audio/jobs')).toThrow(
      /could not detect/,
    );
  });
});

describe('humanizeToken', () => {
  it('title-cases a slug', () => {
    expect(humanizeToken('spotify')).toBe('Spotify');
    expect(humanizeToken('open-ai')).toBe('Open Ai');
  });
});

describe('plainCompanyName', () => {
  it("keeps a search hit's company name, and drops one that is a whole HN sentence", () => {
    expect(plainCompanyName(' SBI Coinhako ')).toBe('SBI Coinhako');
    expect(
      plainCompanyName(
        'Example Audio (https://example.com/) is hiring a firmware engineer. Onsite in Seattle.',
      ),
    ).toBeUndefined();
    expect(plainCompanyName('Example Audio | www.example.com')).toBeUndefined();
    expect(plainCompanyName('')).toBeUndefined();
    expect(plainCompanyName(undefined)).toBeUndefined();
  });
});
