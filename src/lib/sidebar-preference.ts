/** Cookie the root layout reads so the first paint matches the pinned sidebar. */
export const SIDEBAR_COOKIE = 'jobhacker_sidebar';

export type SidebarPreference = 'expanded' | 'rail';

/** Anything other than an explicit rail is the wide sidebar. */
export function sidebarPreferenceFromCookie(value: string | undefined | null): SidebarPreference {
  return value === 'rail' ? 'rail' : 'expanded';
}

/**
 * Below 1280 the rail is the layout, whatever was saved. On a wide window the
 * saved choice wins. Phones never mount this sidebar.
 */
export function sidebarIsRail(narrow: boolean, preference: SidebarPreference): boolean {
  return narrow || preference === 'rail';
}

/** A year, this site only. No `Secure`, so it sticks on http://localhost. */
export function sidebarCookie(preference: SidebarPreference): string {
  return `${SIDEBAR_COOKIE}=${preference}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

/**
 * The rail's count chip, only when the whole count fits in two characters.
 * "34" and "2" fit on a 36px icon. "1,204" and "10k" stay in the tooltip.
 */
export function railBadgeText(count: number | string | undefined): string | null {
  if (typeof count === 'number' && !Number.isFinite(count)) return null;
  if (count == null || count === 0 || count === '0') return null;
  const text = String(count);
  return text.length <= 2 ? text : null;
}
