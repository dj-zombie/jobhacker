const nf = new Intl.NumberFormat("en-US");

/** 10025 -> "10,025" */
export function formatCount(n: number): string {
  return nf.format(n);
}

/** 10025 -> "10k", 1471 -> "1.5k", 336 -> "336" */
export function formatCompact(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}k`;
}

/** Hours ago -> "now", "4h", "3d", "5w" */
export function formatAge(hoursAgo: number): string {
  if (hoursAgo < 1) return "now";
  if (hoursAgo < 24) return `${Math.round(hoursAgo)}h`;
  const d = Math.round(hoursAgo / 24);
  if (d < 14) return `${d}d`;
  return `${Math.round(d / 7)}w`;
}
