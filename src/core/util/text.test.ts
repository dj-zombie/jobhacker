import { describe, expect, it } from 'vitest';
import { decodeEntities, htmlToText, normalizeWhitespace, tokenize, truncate } from './text.js';

describe('normalizeWhitespace', () => {
  it('collapses runs of whitespace and trims', () => {
    expect(normalizeWhitespace('  a\t\n  b   c ')).toBe('a b c');
  });

  it('leaves clean text unchanged', () => {
    expect(normalizeWhitespace('hello world')).toBe('hello world');
  });
});

describe('decodeEntities', () => {
  it('decodes named, decimal and hex entities', () => {
    expect(decodeEntities('A &amp; B &#38; C &#x26; D')).toBe('A & B & C & D');
    expect(decodeEntities('&nbsp;')).toBe(' ');
    expect(decodeEntities('&mdash;')).toBe('\u2014');
  });

  it('leaves unknown entities untouched', () => {
    expect(decodeEntities('&notanentity;')).toBe('&notanentity;');
  });

  it('leaves out-of-range and surrogate code points as text instead of throwing', () => {
    expect(decodeEntities('&#x110000;')).toBe('&#x110000;');
    expect(decodeEntities('&#9999999;')).toBe('&#9999999;');
    expect(decodeEntities('&#xD800;')).toBe('&#xD800;');
    expect(decodeEntities('&#39;')).toBe("'");
  });
});

describe('htmlToText', () => {
  it('turns block tags into line breaks and strips inline tags', () => {
    const html =
      '<h1>Role</h1><p>We use <strong>React</strong> &amp; Node.</p><ul><li>One</li><li>Two</li></ul>';
    expect(htmlToText(html)).toBe('Role\nWe use React & Node.\nOne\nTwo');
  });

  it('drops script and style content', () => {
    const html = '<style>.a{color:red}</style><p>Hi</p><script>evil()</script>';
    expect(htmlToText(html)).toBe('Hi');
  });

  it('collapses excess whitespace within lines', () => {
    expect(htmlToText('<p>a    b\t c</p>')).toBe('a b c');
  });
});

describe('truncate', () => {
  it('returns input unchanged when short enough', () => {
    expect(truncate('short', 10)).toBe('short');
  });

  it('cuts on a word boundary and stays within max', () => {
    expect(truncate('the quick brown fox jumps', 12)).toBe('the quick\u2026');
  });

  it('hard-cuts a single long token so the result is still within max', () => {
    expect(truncate('abcdefghij', 4)).toBe('abc\u2026');
    expect(truncate('hello', 1)).toBe('\u2026');
    expect(truncate('hello', 0)).toBe('');
  });
});

describe('tokenize', () => {
  it('lowercases and keeps tech tokens like c++ and next.js', () => {
    expect(tokenize('React, Next.js and C++!')).toEqual(['react', 'next.js', 'and', 'c++']);
  });

  it('returns an empty array for punctuation only', () => {
    expect(tokenize('—, . !')).toEqual([]);
  });
});
