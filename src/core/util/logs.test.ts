import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dailyLogPath, logDateStamp, partitionLogsByAge, pruneOldLogs } from './logs.js';

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('log naming', () => {
  it('derives the UTC date stamp and daily path', () => {
    expect(logDateStamp('2026-10-23T01:16:00.000Z')).toBe('2026-10-23');
    expect(dailyLogPath('/logs', '2026-10-23T01:16:00.000Z')).toBe(
      '/logs/jobhacker-2026-10-23.log',
    );
  });
});

describe('partitionLogsByAge', () => {
  it('keeps files within the window and removes older daily logs', () => {
    const files = [
      'jobhacker-2026-10-23.log', // today
      'jobhacker-2026-10-10.log', // 13 days old → keep (within 14)
      'jobhacker-2026-10-08.log', // 15 days old → remove
      'jobhacker-2026-09-01.log', // old → remove
      'other.txt', // ignored
      'jobhacker-notadate.log', // ignored
    ];
    const { keep, remove } = partitionLogsByAge(files, 14, '2026-10-23T05:00:00.000Z');
    expect(keep).toEqual(['jobhacker-2026-10-23.log', 'jobhacker-2026-10-10.log']);
    expect(remove).toEqual(['jobhacker-2026-10-08.log', 'jobhacker-2026-09-01.log']);
  });
});

describe('pruneOldLogs', () => {
  it('deletes only the stale daily log files', () => {
    dir = mkdtempSync(join(tmpdir(), 'jobhacker-logs-'));
    for (const name of ['jobhacker-2026-10-23.log', 'jobhacker-2026-10-01.log', 'keepme.txt']) {
      writeFileSync(join(dir, name), 'x', 'utf8');
    }
    const removed = pruneOldLogs(dir, 14, '2026-10-23T05:00:00.000Z');
    expect(removed).toEqual(['jobhacker-2026-10-01.log']);
    const left = readdirSync(dir).sort();
    expect(left).toEqual(['jobhacker-2026-10-23.log', 'keepme.txt']);
  });

  it('returns nothing for a missing directory', () => {
    expect(pruneOldLogs('/no/such/dir/at/all', 14, '2026-10-23T05:00:00.000Z')).toEqual([]);
  });
});
