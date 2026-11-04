/** Plain values the server layout passes to the client shell. No server imports here. */

export interface ShellCounts {
  matches: number;
  fresh: number;
  shortlist: number;
  unscored: number;
  inProgress: number;
  submitted: number;
  followUps: number;
  /** Logo-set companies with no domain yet. A nudge, not an alarm. */
  logos: number;
}

export interface ScoutNotice {
  text: string;
  /** Set when the fix is to stop scouting this board. */
  retire?: { ats: string; token: string; name: string };
  /**
   * Set when the board is gone (J15): where JobHacker looked (null on a run from before J15) and
   * the boards it found, labelled for the card.
   */
  relocate?: {
    looked: string | null;
    candidates: Array<{ ats: string; token: string; label: string; detail: string }>;
  };
}

export interface ScoutCardView {
  status: 'ok' | 'attention' | 'failed';
  notices: ScoutNotice[];
  running: boolean;
  lastRunLabel: string;
  boards: number;
  newLastRun: number;
  modelCalls: number;
  progress: { done: number; total: number; found: number; unit?: 'Board' | 'Scoring' } | null;
}

/** A scout the shell is watching. Polled until `running` is false (J8). */
export interface ScoutRunView {
  runId: number;
  running: boolean;
  progress: ScoutCardView['progress'];
  ok: boolean | null;
  error: string | null;
  inserted: number | null;
  /** Jobs this run closed, and how many of those were shortlisted. */
  closed: number | null;
  closedShortlisted: number | null;
  boardsOk: number | null;
  boards: number | null;
  errorCount: number | null;
}

/** One job in ⌘K. The top 40 by the ranking in force, from anywhere. */
export interface PaletteJob {
  id: string;
  title: string;
  company: string;
  location: string;
  score: number;
  band: 'strong' | 'maybe' | 'no';
  /** Areas the job is in. The palette switches to Anywhere when the current Where hides it. */
  areas: string[];
  logoUrl: string | null;
}
