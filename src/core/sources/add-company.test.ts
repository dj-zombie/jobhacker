import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfigFile } from '../config/load.js';
import { companiesSchema } from '../config/schemas.js';
import { type Http, HttpError } from '../util/http.js';
import { addCompany } from './add-company.js';
import { greenhouseBoardUrl } from './greenhouse.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jobhacker-companies-'));
  dirs.push(dir);
  return dir;
}

function httpReturning(body: unknown): Http {
  return {
    async postJson() {
      throw new Error('postJson is not used by this fake');
    },
    async getJson() {
      return body;
    },
  };
}

describe('addCompany', () => {
  it('rejects an unknown URL without writing a file', async () => {
    const dir = tempDir();
    await expect(
      addCompany({ url: 'https://example.com/careers', http: httpReturning({}), dir }),
    ).rejects.toThrow(/could not detect an ATS board/);
    expect(() => readFileSync(join(dir, 'companies.yaml'), 'utf8')).toThrow();
  });

  it('rejects a board that 404s without writing a file', async () => {
    const dir = tempDir();
    const http: Http = {
      async postJson() {
        throw new Error('postJson is not used by this fake');
      },
      async getJson(url) {
        throw new HttpError(`HTTP 404 from ${url}`, url, 404);
      },
    };
    await expect(
      addCompany({ url: 'https://boards.greenhouse.io/missing', http, dir }),
    ).rejects.toThrow(/did not respond: HTTP 404/);
    expect(() => readFileSync(join(dir, 'companies.yaml'), 'utf8')).toThrow();
  });

  it('appends a verified Greenhouse board, using the name from the payload', async () => {
    const dir = tempDir();
    writeFileSyncExample(dir);
    const fixture: unknown = JSON.parse(
      readFileSync('tests/fixtures/greenhouse-discord.json', 'utf8'),
    );
    const urls: string[] = [];
    const http: Http = {
      async postJson() {
        throw new Error('postJson is not used by this fake');
      },
      async getJson(url) {
        urls.push(url);
        return fixture;
      },
    };

    const added = await addCompany({
      url: 'https://boards.greenhouse.io/discord/jobs/123',
      http,
      dir,
    });
    expect(urls).toEqual([greenhouseBoardUrl('discord')]);
    expect(added.already).toBe(false);
    expect(added.company).toMatchObject({
      name: 'Discord',
      ats: 'greenhouse',
      token: 'discord',
      active: true,
    });

    const again = await addCompany({ url: 'https://job-boards.greenhouse.io/discord', http, dir });
    expect(again.already).toBe(true);

    const loaded = loadConfigFile('companies', companiesSchema, dir);
    expect(loaded.companies.map((company) => company.token)).toEqual([
      'examplestudio',
      'exampleaudio',
      'discord',
    ]);
  });

  it('humanizes a Lever token and honors --name', async () => {
    const dir = tempDir();
    const http = httpReturning([]);
    const added = await addCompany({ url: 'https://jobs.lever.co/spotify', http, dir });
    expect(added.company.name).toBe('Spotify');
    expect(readFileSync(join(dir, 'companies.yaml'), 'utf8')).toContain('  - name: Spotify');

    const named = await addCompany({
      url: 'https://jobs.ashbyhq.com/ramp',
      http: httpReturning({ jobs: [] }),
      dir,
      name: 'Ramp',
    });
    expect(named.company).toMatchObject({ name: 'Ramp', ats: 'ashby', token: 'ramp' });
  });
});

function writeFileSyncExample(dir: string): void {
  writeFileSync(join(dir, 'companies.yaml'), readFileSync('config/companies.example.yaml', 'utf8'));
}
