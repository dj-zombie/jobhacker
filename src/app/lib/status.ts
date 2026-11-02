/**
 * Application statuses as the pipeline shows them. Labels and chip colors follow the
 * reference's `StatusChip`; the three closed statuses share its neutral "closed" look.
 * Pure and client-safe: no DB access.
 */

export const STATUS_ORDER = [
  'prepped',
  'submitted',
  'interviewing',
  'offer',
  'rejected',
  'withdrawn',
  'ghosted',
] as const;

export type AppStatus = (typeof STATUS_ORDER)[number];

export const STATUS_LABEL: Record<string, string> = {
  prepped: 'Prepped',
  submitted: 'Submitted',
  interviewing: 'Interviewing',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  ghosted: 'Ghosted',
};

const STATUS_CLASS: Record<string, string> = {
  prepped: 'bg-brand-wash text-brand-hi ring-brand/25',
  submitted: 'bg-strong-wash text-strong ring-strong/25',
  interviewing: 'bg-info-wash text-info ring-info/25',
  offer: 'bg-maybe-wash text-maybe ring-maybe/25',
};

const CLOSED_CLASS = 'bg-surface-3 text-fg-3 ring-line-2';

export const STATUS_CHIP =
  'inline-flex h-5 shrink-0 items-center rounded-full px-2 text-2xs font-medium ring-1 ring-inset';

export function statusChipClass(status: string): string {
  return STATUS_CLASS[status] ?? CLOSED_CLASS;
}

export function isAppStatus(value: string): value is AppStatus {
  return (STATUS_ORDER as readonly string[]).includes(value);
}
