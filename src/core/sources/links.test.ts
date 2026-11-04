import { describe, expect, it } from 'vitest';
import { boardLinks } from './links.js';

describe('boardLinks', () => {
  it('finds an Ashby board in an HN comment that links a posting', () => {
    const comment = [
      'Acme Robotics | Senior Frontend Engineer | Remote (US) | Full-time',
      'We build control software for warehouse robots.',
      'Apply: https://jobs.ashbyhq.com/acme-robotics/7c1e0c2a-1f7e-4b55-9d3a-3c2b1a0f9e11',
    ].join('\n');
    expect(boardLinks(comment)).toEqual([{ ats: 'ashby', token: 'acme-robotics', readable: true }]);
  });

  it('reads a JSearch apply_link on job-boards.greenhouse.io', () => {
    expect(
      boardLinks('https://job-boards.greenhouse.io/examplelabs/jobs/4012345007?gh_src=abc'),
    ).toEqual([{ ats: 'greenhouse', token: 'examplelabs', readable: true }]);
  });

  it('reads the EU Greenhouse and EU Lever hosts', () => {
    expect(
      boardLinks(
        'See https://job-boards.eu.greenhouse.io/controlplane/jobs/501252 or https://jobs.eu.lever.co/nordicsound/0b9c-11aa/apply',
      ),
    ).toEqual([
      { ats: 'greenhouse', token: 'controlplane', readable: true },
      { ats: 'lever', token: 'nordicsound', readable: true },
    ]);
  });

  it("takes Greenhouse's embed/job_app?for= token, not the word embed", () => {
    expect(
      boardLinks('https://boards.greenhouse.io/embed/job_app?for=examplegames&token=5551234'),
    ).toEqual([{ ats: 'greenhouse', token: 'examplegames', readable: true }]);
    expect(boardLinks('https://boards.greenhouse.io/embed/job_board?token=1')).toEqual([]);
  });

  it('returns a Workable link as unreadable, and other ATSs with no keyless adapter too', () => {
    expect(
      boardLinks(
        [
          'https://apply.workable.com/examplestudio/j/A1B2C3D4E5/',
          'https://examplecorp.wd5.myworkdayjobs.com/en-US/External/job/Portland-OR/Engineer_R123',
          'https://ats.rippling.com/example-audio/jobs/1d2c',
          'https://examplefilms.teamtailor.com/jobs/123-editor',
          'https://exampleberlin.jobs.personio.de/job/998877',
        ].join('\n'),
      ),
    ).toEqual([
      { ats: 'workable', token: 'examplestudio', readable: false },
      { ats: 'workday', token: 'examplecorp', readable: false },
      { ats: 'rippling', token: 'example-audio', readable: false },
      { ats: 'teamtailor', token: 'examplefilms', readable: false },
      { ats: 'personio', token: 'exampleberlin', readable: false },
    ]);
  });

  it('does not take jobs.ashbyhq.com/jobs, or an api path, as a token', () => {
    expect(boardLinks('https://jobs.ashbyhq.com/jobs')).toEqual([]);
    expect(boardLinks('https://jobs.lever.co/api/postings')).toEqual([]);
    expect(boardLinks('https://boards.greenhouse.io/embed')).toEqual([]);
  });

  it('keeps one link per board, the first casing seen, and strips trailing punctuation', () => {
    expect(
      boardLinks(
        'Roles at https://jobs.ashbyhq.com/SBI-Coinhako/123). Also jobs.ashbyhq.com/sbi-coinhako, and https://jobs.lever.co/acme.',
      ),
    ).toEqual([
      { ats: 'ashby', token: 'SBI-Coinhako', readable: true },
      { ats: 'lever', token: 'acme', readable: true },
    ]);
  });

  it('skips a token HN cut short with an ellipsis', () => {
    expect(boardLinks('https://jobs.ashbyhq.com/supercompa...')).toEqual([]);
    expect(boardLinks('https://jobs.ashbyhq.com/supercompany/12ab…')).toEqual([
      { ats: 'ashby', token: 'supercompany', readable: true },
    ]);
  });

  it('ignores hosts that are not job boards', () => {
    expect(
      boardLinks('https://example.com/careers https://news.ycombinator.com/item?id=1'),
    ).toEqual([]);
  });
});
