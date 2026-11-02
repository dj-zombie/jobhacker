import { describe, expect, it } from 'vitest';
import { type EventLike, activityGroups, eventEntries, eventSummary } from './activity.js';

const NOW = new Date(2026, 9, 26, 20, 0).getTime();

function at(day: number, hour: number, minute = 0): string {
  return new Date(2026, 9, day, hour, minute).toISOString();
}

let nextId = 1;
function ev(type: string, iso: string, payload: unknown = {}): EventLike {
  return { id: nextId++, type, at: iso, payload };
}

describe('activityGroups', () => {
  it('titles events in words, newest first, grouped Today / Yesterday / date', () => {
    const events = [
      ev('triage', at(24, 9), { action: 'shortlist', from: 'scored', to: 'shortlisted' }),
      ev('llm_usage', at(24, 9, 5), { prompt: 'prep', input_tokens: 100 }),
      ev('prep', at(25, 10), { model: 'm', bullets: 8, needs_input: 0 }),
      ev('prep', at(26, 19, 20), { model: 'm', bullets: 8, needs_input: 2 }),
      ev('fill', at(26, 19, 34), {
        filled: 9,
        drafted: 2,
        unfilled: 2,
        unfilled_required: 0,
        resume_attached: true,
      }),
    ];
    const groups = activityGroups(events, NOW);
    expect(groups.map((g) => g.day)).toEqual(['Today', 'Yesterday', 'Oct 24']);
    expect(groups[0]?.items.map((i) => [i.title, i.detail])).toEqual([
      [
        'Filled the application in Chrome',
        '9 fields filled, 2 drafted for review, resume attached',
      ],
      ['Re-prepared resume, cover note and answers', '2 gaps left for you to fill'],
    ]);
    expect(groups[0]?.items[0]?.time).toBe('7:34 PM');
    expect(groups[1]?.items[0]?.title).toBe('Prepared resume, cover note and answers');
    expect(groups[2]?.items.map((i) => i.title)).toEqual(['Shortlisted from triage']);
  });

  it('never shows an internal event name or payload key', () => {
    const events = [
      ev('llm_usage', at(26, 8)),
      ev('draft_answers', at(26, 9), { questions: 4, answered: 2, needs_input: 1 }),
      ev('answer_approved', at(26, 10), { question: 'Tell us more', value_hash: 'abc' }),
      ev('answer_approved', at(26, 10, 5), {
        question: 'Tell us more',
        value_hash: 'd',
        edited: true,
      }),
      ev('submitted', at(26, 11), { follow_up_at: at(31, 11) }),
      ev('status', at(26, 12), { from: 'submitted', to: 'interviewing' }),
      ev('follow_up', at(26, 13), { follow_up_at: at(30, 9) }),
      ev('follow_up', at(26, 13, 30), { follow_up_at: null }),
      ev('note', at(26, 14), { chars: 12 }),
      ev('triage', at(26, 15), { action: 'undo', undid: 'archive' }),
      ev('some_future_type', at(26, 16), { x: 1 }),
    ];
    const items = activityGroups(events, NOW).flatMap((g) => g.items);
    expect(items.map((i) => i.title)).toEqual([
      'Undid: Archive',
      'Saved notes',
      'Cleared the follow-up date',
      'Follow-up set for Oct 30',
      'Moved to Interviewing',
      'Marked submitted',
      'Edited a drafted answer',
      'Approved a drafted answer',
      "Drafted answers to the form's screening questions",
    ]);
    const text = JSON.stringify(items);
    expect(text).not.toMatch(/llm_usage|draft_answers|answer_approved|follow_up|value_hash|_/);
    expect(items.find((i) => i.title === 'Marked submitted')?.detail).toBe(
      'Follow-up set for Oct 31',
    );
  });

  it('counts self-identification answers among the fields filled, as the report does', () => {
    const s = eventSummary(
      ev('fill', at(26, 9), { filled: 9, drafted: 2, unfilled: 3, self_identification: 3 }),
      true,
    );
    expect(s?.detail).toBe('12 fields filled, 2 drafted for review');
  });

  it('says when a fill found nothing to fill', () => {
    const s = eventSummary(ev('fill', at(26, 9), { filled: 0, unfilled: 0 }), true);
    expect(s).toMatchObject({ title: 'Opened the application in Chrome' });
  });

  it('gives a job page one line per event, in the order given, hiding bookkeeping', () => {
    const iso = at(26, 9);
    const entries = eventEntries([
      ev('llm_usage', iso, { model: 'm', input_tokens: 10 }),
      ev('triage', iso, { action: 'shortlist', from: 'scored', to: 'shortlisted' }),
      ev('prep', iso, { needs_input: 0 }),
      ev('prep', iso, { needs_input: 1 }),
      ev('some_new_type', iso, null),
    ]);
    expect(entries.map((e) => [e.label, e.detail])).toEqual([
      ['Shortlisted from triage', ''],
      ['Prepared resume, cover note and answers', ''],
      ['Re-prepared resume, cover note and answers', '1 gap left for you to fill'],
    ]);
    expect(entries.every((e) => !('payload' in e))).toBe(true);
  });

  it('names per-section regenerates', () => {
    expect(eventSummary(ev('prep', at(26, 9), { section: 'resume' }), true)?.title).toBe(
      'Regenerated the resume',
    );
    expect(eventSummary(ev('prep', at(26, 9), { section: 'cover' }), true)?.title).toBe(
      'Regenerated the cover note',
    );
  });
});
