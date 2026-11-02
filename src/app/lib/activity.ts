import type { TimelineGroup, TimelineItem } from '@/components/jobhacker';
import { STATUS_LABEL } from './status.js';

/**
 * An application's events as Kris reads them (UI-KIT § Event titles). Pure, so
 * the server renders the titles and raw event types and payloads never reach
 * the page. Bookkeeping (`llm_usage`) and any type without a title are left out.
 */

export interface EventLike {
  id: number;
  type: string;
  at: string;
  payload: unknown;
}

export interface EventSummary {
  title: string;
  detail?: string;
  kind: TimelineItem['kind'];
}

function field(payload: unknown, key: string): unknown {
  if (typeof payload !== 'object' || payload === null || !(key in payload)) return undefined;
  return Reflect.get(payload, key);
}

function num(payload: unknown, key: string): number | undefined {
  const value = field(payload, key);
  return typeof value === 'number' ? value : undefined;
}

function str(payload: unknown, key: string): string | undefined {
  const value = field(payload, key);
  return typeof value === 'string' ? value : undefined;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Oct 31", in the server's time zone (Kris's Mac). */
export function shortDate(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const TRIAGE_TITLE: Record<string, string> = {
  shortlist: 'Shortlisted from triage',
  skip: 'Skipped',
  archive: 'Archived',
};

const TRIAGE_VERB: Record<string, string> = {
  shortlist: 'Shortlist',
  skip: 'Skip',
  archive: 'Archive',
};

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * One event's title. `firstPrep` is true for the earliest full prep, so later
 * ones read "Re-prepared". `null` hides the event.
 */
export function eventSummary(event: EventLike, firstPrep: boolean): EventSummary | null {
  const p = event.payload;
  switch (event.type) {
    case 'triage': {
      const action = str(p, 'action') ?? '';
      if (action === 'undo') {
        const undid = str(p, 'undid') ?? '';
        return { title: `Undid: ${TRIAGE_VERB[undid] ?? 'a triage action'}`, kind: 'triage' };
      }
      const title = TRIAGE_TITLE[action];
      return title ? { title, kind: 'triage' } : null;
    }
    case 'prep': {
      const section = str(p, 'section');
      if (section === 'resume') return { title: 'Regenerated the resume', kind: 'prep' };
      if (section === 'cover') return { title: 'Regenerated the cover note', kind: 'prep' };
      const gaps = num(p, 'needs_input') ?? 0;
      return {
        title: `${firstPrep ? 'Prepared' : 'Re-prepared'} resume, cover note and answers`,
        detail: gaps > 0 ? `${plural(gaps, 'gap')} left for you to fill` : undefined,
        kind: 'prep',
      };
    }
    case 'draft_answers': {
      const answered = num(p, 'answered') ?? 0;
      const questions = num(p, 'questions') ?? answered;
      const needs = num(p, 'needs_input') ?? 0;
      return {
        title: "Drafted answers to the form's screening questions",
        detail: `${answered} of ${plural(questions, 'question')} drafted${needs > 0 ? `, ${needs} need your input` : ''}`,
        kind: 'draft',
      };
    }
    case 'fill': {
      // Self-identification answers are fields on the form too, as the fill report counts them.
      const filled = (num(p, 'filled') ?? 0) + (num(p, 'self_identification') ?? 0);
      const drafted = num(p, 'drafted') ?? 0;
      const unfilled = num(p, 'unfilled') ?? 0;
      const required = num(p, 'unfilled_required') ?? 0;
      if (filled === 0 && unfilled === 0) {
        return {
          title: 'Opened the application in Chrome',
          detail: 'No fields found to fill',
          kind: 'fill',
        };
      }
      const parts = [`${plural(filled, 'field')} filled`];
      if (drafted > 0) parts.push(`${drafted} drafted for review`);
      if (required > 0) parts.push(`${required} required left blank`);
      if (field(p, 'resume_attached') === true) parts.push('resume attached');
      return { title: 'Filled the application in Chrome', detail: parts.join(', '), kind: 'fill' };
    }
    case 'answer_approved': {
      const question = str(p, 'question');
      return {
        title:
          field(p, 'edited') === true ? 'Edited a drafted answer' : 'Approved a drafted answer',
        detail: question ? truncate(question, 90) : undefined,
        kind: 'draft',
      };
    }
    case 'submitted': {
      const followUp = str(p, 'follow_up_at');
      return {
        title: 'Marked submitted',
        detail: followUp ? `Follow-up set for ${shortDate(followUp)}` : undefined,
        kind: 'submit',
      };
    }
    case 'status': {
      const to = str(p, 'to') ?? '';
      const label = STATUS_LABEL[to];
      return label ? { title: `Moved to ${label}`, kind: 'submit' } : null;
    }
    case 'follow_up': {
      const at = str(p, 'follow_up_at');
      return {
        title: at ? `Follow-up set for ${shortDate(at)}` : 'Cleared the follow-up date',
        kind: 'note',
      };
    }
    case 'note':
      return { title: (num(p, 'chars') ?? 0) > 0 ? 'Saved notes' : 'Cleared notes', kind: 'note' };
    default:
      return null;
  }
}

function dayLabel(at: Date, now: Date): string {
  const day = at.toDateString();
  if (day === now.toDateString()) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day === yesterday.toDateString()) return 'Yesterday';
  return at.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** The ids of every full prep after the first, oldest first. */
function laterPreps(events: readonly EventLike[]): Set<number> {
  const preps = events
    .filter((e) => e.type === 'prep' && str(e.payload, 'section') === undefined)
    .sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
  return new Set(preps.slice(1).map((e) => e.id));
}

export interface EventEntry {
  id: number;
  at: string;
  label: string;
  detail: string;
}

/** Events as one-line entries in the order given, for a compact history list. */
export function eventEntries(events: readonly EventLike[]): EventEntry[] {
  const later = laterPreps(events);
  return events.flatMap((event) => {
    const summary = eventSummary(event, !later.has(event.id));
    return summary
      ? [{ id: event.id, at: event.at, label: summary.title, detail: summary.detail ?? '' }]
      : [];
  });
}

/** Events, newest first, grouped by local day ("Today", "Yesterday", "Oct 24"). */
export function activityGroups(events: readonly EventLike[], nowMs: number): TimelineGroup[] {
  const later = laterPreps(events);
  const now = new Date(nowMs);
  const groups: TimelineGroup[] = [];
  const sorted = [...events].sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id);
  for (const event of sorted) {
    const summary = eventSummary(event, !later.has(event.id));
    if (!summary) continue;
    const at = new Date(event.at);
    if (Number.isNaN(at.getTime())) continue;
    const day = dayLabel(at, now);
    let group = groups[groups.length - 1];
    if (!group || group.day !== day) {
      group = { day, items: [] };
      groups.push(group);
    }
    group.items.push({
      id: String(event.id),
      time: at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      title: summary.title,
      detail: summary.detail,
      kind: summary.kind,
    });
  }
  return groups;
}
