import { describe, expect, it } from 'vitest';
import { detectBoard, humanizeToken } from './detect.js';

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

  it('rejects unknown hosts, the embed path, and non-URLs', () => {
    expect(() => detectBoard('https://example.com/careers')).toThrow(
      /could not detect an ATS board/,
    );
    expect(() => detectBoard('https://boards.greenhouse.io/embed/job_board?for=discord')).toThrow(
      /could not detect/,
    );
    expect(() => detectBoard('not a url')).toThrow(/could not detect/);
    expect(() => detectBoard('https://boards.greenhouse.io/')).toThrow(/could not detect/);
  });
});

describe('humanizeToken', () => {
  it('title-cases a slug', () => {
    expect(humanizeToken('spotify')).toBe('Spotify');
    expect(humanizeToken('open-ai')).toBe('Open Ai');
  });
});
