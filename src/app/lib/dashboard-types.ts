import type { Band, FunnelStage } from '@/components/jobhacker';
import type { AppStatus } from './status.js';
import type { CompanyLogoRef } from './workspace-types.js';

/**
 * The dashboard's read-only snapshot (J23). Every field is serializable, so the server
 * (`getDashboard` in `queries.ts`) builds it from `computeStats`/`computeFunnel` and the real
 * applications, and the client `Dashboard` renders it. Mirrors the prototype's `DashboardModel`,
 * with the Mission board on real data (invariant 3): the newest event is the "last activity", and
 * the follow-up date and a note marker stand in for the typed tracking that J24 adds.
 */

/** A follow-up's urgency, for the row's chip tone. */
export type FollowUpDue = 'overdue' | 'today' | 'soon';

/** One application as the Mission board shows it: identity, stage, last real activity, follow-up. */
export interface InFlightApp {
  applicationId: number;
  company: string;
  title: string;
  logo: CompanyLogoRef;
  status: AppStatus;
  /** The newest event with a human title, as the board's "last activity" line. */
  activity: { label: string; at: string } | null;
  /** The follow-up date, when set and the application is past prepped. */
  followUp: { label: string; due: FollowUpDue } | null;
  /** Kris left a note. The row shows a marker; the text stays off the dashboard. */
  hasNote: boolean;
  /** A follow-up due today or overdue (invariant: equals the Follow-ups-due list). Sorts first. */
  needsAction: boolean;
}

export interface SectorRow {
  id: string;
  label: string;
  count: number;
  kind: 'place' | 'remote' | 'rest';
}

export interface DashboardSpendSource {
  name: string;
  calls: number;
  budget: number;
  credits?: number;
  creditBudget?: number;
}

export interface DashboardData {
  /** Match bands over the current scores; `matches` is strong + maybe. */
  signal: { strong: number; maybe: number; weak: number; matches: number; scored: number };
  today: { newToday: number; followUpsDue: number };
  /** The recon pipeline, widest first: harvested → past the gates → scored → matches. */
  funnel: FunnelStage[];
  boards: { active: number; byAts: { ats: string; count: number }[] };
  searchOnly: { total: number; bySource: { source: string; count: number }[] };
  sector: SectorRow[];
  inWhere: { strong: number; maybe: number };
  /** Open applications (not rejected/withdrawn/ghosted), most urgent first. */
  inFlight: InFlightApp[];
  openCount: number;
  needAction: number;
  apply: { prepared: number; filled: number; submitted: number; followUpsDue: number };
  fill: { ats: string; pct: number; forms: number }[];
  time: { medianMinutes: number | null; submissions: number };
  spend: { modelCalls: number; usd: number; sources: DashboardSpendSource[] };
  logos: { companies: number; withDomain: number; confirmed: number };
  scored: { current: number; stale: number; unscored: number };
  /** 0–100 scores (current key, past the gates) for the signal-spectrum histogram. */
  scores: number[];
  /** The band cutoffs, for the histogram's bands. */
  thresholds: { strong: number; maybe: number };
}

/** Re-exported so callers that only touch the band type don't reach into the kit. */
export type { Band };
