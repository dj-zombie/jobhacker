import { describe, expect, it } from 'vitest';
import type { Profile } from '../config/schemas.js';
import {
  dedupeExperience,
  educationDegree,
  educationMajor,
  experienceDescription,
  isPresent,
  parseProfileMonthYear,
  sanitizeDescription,
  savedEntryMatches,
} from './smartrecruiters.js';

const role = (
  id: string,
  company: string,
  title: string,
  start: string,
  end: string,
  bulletText: string,
): Profile['experience'][number] => ({
  id,
  company,
  title,
  start,
  end,
  bullets: bulletText ? [{ id: `${id}-b1`, text: bulletText }] : [],
});

describe('parseProfileMonthYear', () => {
  it('parses month-name dates in either case', () => {
    expect(parseProfileMonthYear('Nov 2025')).toEqual({
      month: 11,
      abbr: 'Nov',
      year: 2025,
      display: '11/2025',
    });
    expect(parseProfileMonthYear('AUG 2025')?.display).toBe('08/2025');
    expect(parseProfileMonthYear('Dec 2021')?.display).toBe('12/2021');
  });

  it('returns null when the profile states no month (never guess January)', () => {
    expect(parseProfileMonthYear('2013')).toBeNull();
    expect(parseProfileMonthYear('PRESENT')).toBeNull();
    expect(parseProfileMonthYear('')).toBeNull();
  });

  it('detects open-ended dates', () => {
    expect(isPresent('PRESENT')).toBe(true);
    expect(isPresent('current')).toBe(true);
    expect(isPresent('SEP 2024')).toBe(false);
  });
});

describe('dedupeExperience', () => {
  it('keeps the richest copy of an exact duplicate role, in profile order', () => {
    const roles = [
      role('a', 'Tailspin Agency', 'Front-End Developer', 'Oct 2013', 'Sep 2015', 'Did things.'),
      role('b', 'Acme', 'Engineer', 'Jan 2020', 'Feb 2021', 'Built.'),
      role('c', 'Tailspin Agency', 'Front-End Developer', '2013', '2015', ''),
    ];
    const deduped = dedupeExperience(roles);
    expect(deduped.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('keeps different titles at the same company and dates', () => {
    const roles = [
      role('a', 'Contoso Labs', 'Senior Frontend Developer', 'Dec 2021', 'Jan 2023', 'One.'),
      role('b', 'Contoso Labs', 'Ruby on Rails Developer', 'Dec 2021', 'Jan 2023', 'Two.'),
    ];
    expect(dedupeExperience(roles)).toHaveLength(2);
  });
});

describe('description and education helpers', () => {
  it('replaces semicolons the site rejects, keeping the facts', () => {
    expect(sanitizeDescription('Built X; shipped Y; led Z')).toBe('Built X, shipped Y, led Z');
    const r = role('a', 'Acme', 'Engineer', 'Jan 2020', 'Feb 2021', 'Did A; did B');
    expect(experienceDescription(r)).toBe('Did A, did B');
  });

  it('derives a major from coursework but never invents a degree', () => {
    expect(educationMajor('Computer Science Coursework')).toBe('Computer Science');
    expect(educationDegree('Computer Science Coursework')).toBe('');
    expect(educationDegree("Bachelor's in Computer Science")).toContain('Bachelor');
    expect(educationMajor("Bachelor's in Computer Science")).toBe('');
  });
});

describe('savedEntryMatches', () => {
  it('matches title-first labels, decoding the literal &amp; in saved labels', () => {
    expect(
      savedEntryMatches(
        'Edit experience Founder &amp; Lead Developer Fabrikam Audio LLC',
        'experience',
        'Founder & Lead Developer',
        'Fabrikam Audio LLC',
      ),
    ).toBe(true);
  });

  it('does not claim one Quality Assurance entry from another company\u2019s', () => {
    const pixel = 'Edit experience Quality Assurance Pixel Games';
    expect(
      savedEntryMatches(pixel, 'experience', 'Quality Assurance', 'Litware Online Entertainment'),
    ).toBe(false);
    expect(savedEntryMatches(pixel, 'experience', 'Quality Assurance', 'Pixel Games')).toBe(true);
  });

  it('accepts an entry saved without its company name', () => {
    expect(
      savedEntryMatches(
        'Edit experience Quality Assurance ,',
        'experience',
        'Quality Assurance',
        'Litware Online Entertainment',
      ),
    ).toBe(true);
  });

  it('matches education by school anywhere after the major', () => {
    expect(
      savedEntryMatches(
        'Edit education Computer Science Desert Mesa College',
        'education',
        'Desert Mesa College',
      ),
    ).toBe(true);
    expect(
      savedEntryMatches(
        'Edit education Computer Science Desert Mesa College',
        'education',
        'Coastal Ridge College',
      ),
    ).toBe(false);
  });
});
