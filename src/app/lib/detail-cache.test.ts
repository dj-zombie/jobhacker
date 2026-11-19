import { describe, expect, it } from 'vitest';
import { addCapped, prefetchIds } from './detail-cache.js';

const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const none = () => false;

describe('prefetchIds', () => {
  it('takes the nearest jobs first, alternating ahead and behind', () => {
    expect(prefetchIds(ids, 3, none, 3, 1)).toEqual(['e', 'c', 'f', 'g']);
  });

  it('skips jobs already loaded, and the selected one', () => {
    const has = (id: string) => id === 'c' || id === 'e';
    expect(prefetchIds(ids, 3, has, 3, 1)).toEqual(['f', 'g']);
    expect(prefetchIds(ids, 3, none, 0, 0)).toEqual([]);
  });

  it('stops at either end of the list', () => {
    expect(prefetchIds(ids, 0, none, 2, 2)).toEqual(['b', 'c']);
    expect(prefetchIds(ids, 6, none, 2, 2)).toEqual(['f', 'e']);
  });

  it('loads nothing when nothing is selected', () => {
    expect(prefetchIds(ids, -1, none, 3, 1)).toEqual([]);
    expect(prefetchIds([], 0, none, 3, 1)).toEqual([]);
  });
});

describe('addCapped', () => {
  it('adds entries, and drops the oldest once past the cap', () => {
    const start = new Map([
      [1, 'one'],
      [2, 'two'],
    ]);
    const next = addCapped(
      start,
      [
        [3, 'three'],
        [4, 'four'],
      ],
      3,
      null,
    );
    expect([...next.keys()]).toEqual([2, 3, 4]);
    expect([...start.keys()]).toEqual([1, 2]);
  });

  it('never drops the kept entry, even when it is the oldest', () => {
    const start = new Map([
      [1, 'one'],
      [2, 'two'],
    ]);
    const next = addCapped(start, [[3, 'three']], 2, 1);
    expect([...next.keys()]).toEqual([1, 3]);
  });

  it('moves a re-added entry to the newest place', () => {
    const start = new Map([
      [1, 'one'],
      [2, 'two'],
    ]);
    const next = addCapped(start, [[1, 'uno']], 2, null);
    expect([...next.entries()]).toEqual([
      [2, 'two'],
      [1, 'uno'],
    ]);
  });
});
