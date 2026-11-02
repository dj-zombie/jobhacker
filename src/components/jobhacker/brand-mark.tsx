import { cn } from "@/lib/utils";

/** The JobHacker mark: a prompt chevron and cursor on the brand tile. */
export function BrandMark({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" className={cn("shrink-0", className)} aria-hidden>
      <defs>
        <linearGradient id="jh-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-brand-hi)" />
          <stop offset="1" stopColor="var(--color-brand-lo)" />
        </linearGradient>
      </defs>
      <rect width="28" height="28" rx="8" fill="url(#jh-mark)" />
      <rect x="0.5" y="0.5" width="27" height="27" rx="7.5" fill="none" stroke="var(--color-white)" strokeOpacity="0.18" />
      <path
        d="M8.2 9.2 L13.4 14 L8.2 18.8"
        fill="none"
        stroke="var(--color-white)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="15.2" y="17.4" width="6.4" height="2.6" rx="1.3" fill="var(--color-white)" fillOpacity="0.85" />
    </svg>
  );
}
