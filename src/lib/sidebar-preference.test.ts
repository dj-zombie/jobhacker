import { describe, expect, it } from 'vitest';
import {
  railBadgeText,
  sidebarCookie,
  sidebarIsRail,
  sidebarPreferenceFromCookie,
} from './sidebar-preference.js';

describe('sidebarPreferenceFromCookie', () => {
  it('treats anything but rail as expanded', () => {
    expect(sidebarPreferenceFromCookie(undefined)).toBe('expanded');
    expect(sidebarPreferenceFromCookie(null)).toBe('expanded');
    expect(sidebarPreferenceFromCookie('expanded')).toBe('expanded');
    expect(sidebarPreferenceFromCookie('wide')).toBe('expanded');
    expect(sidebarPreferenceFromCookie('rail')).toBe('rail');
  });
});

describe('sidebarIsRail', () => {
  it('keeps the rail below 1280 whatever was saved', () => {
    expect(sidebarIsRail(true, 'expanded')).toBe(true);
    expect(sidebarIsRail(true, 'rail')).toBe(true);
  });

  it('honors the saved choice on a wide window', () => {
    expect(sidebarIsRail(false, 'expanded')).toBe(false);
    expect(sidebarIsRail(false, 'rail')).toBe(true);
  });
});

describe('sidebarCookie', () => {
  it('writes a year-long SameSite cookie', () => {
    expect(sidebarCookie('rail')).toBe(
      'jobhacker_sidebar=rail; Path=/; Max-Age=31536000; SameSite=Lax',
    );
  });
});

describe('railBadgeText', () => {
  it('shows a short count and leaves a long one to the tooltip', () => {
    expect(railBadgeText(undefined)).toBeNull();
    expect(railBadgeText(0)).toBeNull();
    expect(railBadgeText('0')).toBeNull();
    expect(railBadgeText(2)).toBe('2');
    expect(railBadgeText(34)).toBe('34');
    expect(railBadgeText(150)).toBeNull();
    expect(railBadgeText('10k')).toBeNull();
    expect(railBadgeText('1,204')).toBeNull();
    expect(railBadgeText(Number.NaN)).toBeNull();
  });
});
