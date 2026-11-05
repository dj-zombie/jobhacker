'use client';

import { Hint, Timeline, type TimelineGroup, toast } from '@/components/jobhacker';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Check,
  ChevronDown,
  ClipboardList,
  Code2,
  Copy,
  Download,
  RefreshCw,
  RotateCcw,
  Save,
  TriangleAlert,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import {
  regenerateAnswersAction,
  regenerateCoverAction,
  regenerateResumeAction,
  saveApplication,
  setFollowUpDateAction,
  setNotesAction,
} from '../lib/actions.js';
import type { CopyRow, WorkspaceAnswer } from '../lib/workspace-types.js';

/** The workspace's tab bodies (J7). Each edit is explicit: an unsaved marker, then Save. */

const FIELD =
  'w-full rounded-lg border border-line-2 bg-surface-1 px-3 text-sm text-fg outline-none transition-colors placeholder:text-fg-4 focus:border-brand/60 focus:bg-surface-2';

function failed(title: string, error?: string) {
  toast(title, { description: error, icon: <TriangleAlert className="text-danger" /> });
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * A value edited against the last saved one. A new saved value from the server is adopted
 * only while there are no unsaved edits, so a refresh never eats Kris's typing.
 */
function useDraft<T>(saved: T, same: (a: T, b: T) => boolean) {
  const [value, setValue] = React.useState(saved);
  const [base, setBase] = React.useState(saved);
  if (!same(saved, base) && same(value, base)) {
    setBase(saved);
    setValue(saved);
  }
  return {
    value,
    setValue,
    dirty: !same(value, base),
    commit: (next: T) => {
      setBase(next);
      setValue(next);
    },
    discard: () => setValue(base),
  };
}

const sameText = (a: string, b: string) => a === b;

function UnsavedMark({ show }: { show: boolean }) {
  return show ? <span className="text-xs text-maybe">Unsaved changes</span> : null;
}

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------

export function ResumePanel({
  jobId,
  pdfUrl,
  html,
  fileName,
  provided,
}: {
  jobId: number;
  pdfUrl: string | null;
  html: string;
  fileName: string;
  /** The PDF is Kris's own resume from `input/`, attached as it is. */
  provided: boolean;
}) {
  const router = useRouter();
  const [showSource, setShowSource] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const regenerate = async () => {
    setBusy(true);
    const id = toast.loading('Regenerating resume', {
      description: 'Grounded in profile.yaml. About 20 seconds.',
    });
    const res = await regenerateResumeAction(jobId);
    setBusy(false);
    if (res.ok) {
      toast('Regenerated resume', {
        id,
        description: res.fellBack
          ? `${res.fellBack} bullets kept from your profile as written.`
          : fileName,
      });
      router.refresh();
    } else {
      toast("Couldn't regenerate the resume", {
        id,
        description: res.error,
        icon: <TriangleAlert className="text-danger" />,
      });
    }
  };

  return (
    <>
      <div className="grid gap-5 lg:grid-cols-[1fr_220px]">
        <div className="overflow-hidden rounded-xl bg-surface-1 p-4 ring-1 ring-line sm:p-6">
          {pdfUrl ? (
            <object
              data={`${pdfUrl}#toolbar=0&navpanes=0&view=FitH`}
              type="application/pdf"
              aria-label={fileName}
              className="mx-auto block aspect-[8.5/11] w-full max-w-[640px] rounded-sm bg-paper shadow-pop"
            >
              <HtmlPreview html={html} title={fileName} />
            </object>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-fg-3">
                No PDF yet. Regenerate renders one. This is the resume as HTML.
              </p>
              <HtmlPreview html={html} title={fileName} />
            </div>
          )}
        </div>
        <div className="space-y-2">
          {pdfUrl ? (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: 'secondary' }), 'w-full justify-start')}
            >
              <Download />
              Open PDF
            </a>
          ) : null}
          {provided ? (
            <p className="px-1 pt-1 text-xs leading-relaxed text-fg-3">
              This is your own resume, from <code className="font-mono">input/resume.pdf</code>.
              Open & fill attaches it as it is. The tailored resume is held back until it matches
              your layout.
            </p>
          ) : (
            <>
              <Button
                variant="ghost"
                className="w-full justify-start"
                disabled={busy}
                onClick={() => void regenerate()}
              >
                <RefreshCw className={cn(busy && 'animate-spin')} />
                Regenerate
              </Button>
              <Button
                variant="ghost"
                className="w-full justify-start"
                aria-expanded={showSource}
                onClick={() => setShowSource((s) => !s)}
              >
                <Code2 />
                {showSource ? 'Hide HTML source' : 'View HTML source'}
              </Button>
              <p className="px-1 pt-1 text-2xs leading-relaxed text-fg-4">
                Every tailored bullet cites a bullet in your profile. Untrue lines are rejected
                before they get here.
              </p>
            </>
          )}
        </div>
      </div>
      {showSource && !provided ? (
        <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-surface-1 p-4 font-mono text-xs leading-relaxed text-fg-3 animate-rise-in">
          {html || 'No resume HTML yet.'}
        </pre>
      ) : null}
    </>
  );
}

function HtmlPreview({ html, title }: { html: string; title: string }) {
  return (
    <iframe
      title={title}
      srcDoc={html}
      sandbox=""
      className="mx-auto block aspect-[8.5/11] w-full max-w-[640px] rounded-sm bg-paper shadow-pop"
    />
  );
}

// ---------------------------------------------------------------------------
// Cover note
// ---------------------------------------------------------------------------

export function CoverEditor({
  jobId,
  saved,
  focusSignal,
}: {
  jobId: number;
  saved: string;
  /** Bumped when Add answer on a cover-note gap jumps here. */
  focusSignal: number;
}) {
  const router = useRouter();
  const draft = useDraft(saved, sameText);
  const [busy, setBusy] = React.useState<'save' | 'regenerate' | null>(null);
  const ref = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (focusSignal > 0) ref.current?.focus();
  }, [focusSignal]);

  const save = async () => {
    setBusy('save');
    const res = await saveApplication(jobId, { coverNote: draft.value });
    setBusy(null);
    if (!res.ok) return failed("Couldn't save the cover note", res.error);
    draft.commit(draft.value);
    toast('Saved cover note');
    router.refresh();
  };

  const regenerate = async () => {
    setBusy('regenerate');
    const id = toast.loading('Regenerating cover note', {
      description: 'Grounded in profile.yaml.',
    });
    const res = await regenerateCoverAction(jobId);
    setBusy(null);
    if (!res.ok || res.coverNote === undefined) {
      toast("Couldn't regenerate the cover note", {
        id,
        description: res.error,
        icon: <TriangleAlert className="text-danger" />,
      });
      return;
    }
    draft.commit(res.coverNote);
    toast('Regenerated cover note', {
      id,
      description: res.grounded ? undefined : 'Some lines were held back. Check for gaps to fill.',
    });
    router.refresh();
  };

  return (
    <div className="surface-card rounded-xl p-1">
      <label htmlFor="cover-note" className="sr-only">
        Cover note
      </label>
      <textarea
        ref={ref}
        id="cover-note"
        value={draft.value}
        onChange={(e) => draft.setValue(e.target.value)}
        rows={16}
        placeholder="No cover note yet. Regenerate writes one from your profile."
        className="block w-full resize-y rounded-lg bg-transparent p-4 text-base leading-relaxed text-fg outline-none placeholder:text-fg-4 focus-visible:bg-surface-2/40"
      />
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2.5">
        <span className="text-xs tnum text-fg-3">{countWords(draft.value)} words</span>
        <UnsavedMark show={draft.dirty} />
        {draft.dirty ? (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={draft.discard}>
            <RotateCcw />
            Discard
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            disabled={busy !== null}
            onClick={() => void regenerate()}
          >
            <RefreshCw className={cn(busy === 'regenerate' && 'animate-spin')} />
            Regenerate
          </Button>
        )}
        <Button size="sm" disabled={!draft.dirty || busy !== null} onClick={() => void save()}>
          <Save />
          Save
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

function answerMap(answers: WorkspaceAnswer[]): Record<string, string> {
  return Object.fromEntries(answers.map((a) => [a.key, a.value]));
}

const sameAnswers = (a: Record<string, string>, b: Record<string, string>) =>
  JSON.stringify(a) === JSON.stringify(b);

export function AnswersEditor({
  jobId,
  answers,
  reviewKeys,
  focus,
}: {
  jobId: number;
  answers: WorkspaceAnswer[];
  /** Questions whose drafted answer still needs a look. */
  reviewKeys: ReadonlySet<string>;
  /** The question Edit or Add answer jumped to. */
  focus: { key: string; signal: number } | null;
}) {
  const router = useRouter();
  const saved = React.useMemo(() => answerMap(answers), [answers]);
  const draft = useDraft(saved, sameAnswers);
  const [busy, setBusy] = React.useState<'save' | 'reload' | null>(null);
  const refs = React.useRef(new Map<string, HTMLInputElement | HTMLTextAreaElement>());

  React.useEffect(() => {
    if (!focus) return;
    const el = refs.current.get(focus.key);
    if (!el) return;
    el.focus();
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focus]);

  const standard = answers.filter((a) => a.standard);
  const questions = answers.filter((a) => !a.standard);
  const stored = new Set(answers.filter((a) => a.stored).map((a) => a.key));
  const set = (key: string, value: string) => draft.setValue({ ...draft.value, [key]: value });

  const save = async () => {
    // A question never answered stays unsaved while empty: an empty saved answer means
    // "blank on purpose", and that is Kris's call, not a side effect of Save.
    const next = Object.fromEntries(
      Object.entries(draft.value).filter(([key, value]) => stored.has(key) || value.trim() !== ''),
    );
    setBusy('save');
    const res = await saveApplication(jobId, { answers: next });
    setBusy(null);
    if (!res.ok) return failed("Couldn't save the answers", res.error);
    draft.commit(draft.value);
    toast('Saved answers');
    router.refresh();
  };

  const reload = async () => {
    setBusy('reload');
    const res = await regenerateAnswersAction(jobId);
    setBusy(null);
    if (!res.ok) return failed("Couldn't reload the standard answers", res.error);
    toast('Reloaded standard answers from your profile');
    router.refresh();
  };

  const bind = (key: string) => (el: HTMLInputElement | HTMLTextAreaElement | null) => {
    if (el) refs.current.set(key, el);
    else refs.current.delete(key);
  };

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-fg">Standard answers</h3>
        {standard.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {standard.map((a) => (
              <label key={a.key} className="block">
                <span className="mb-1 block text-xs text-fg-3">{a.label}</span>
                <input
                  ref={bind(a.key)}
                  value={draft.value[a.key] ?? ''}
                  onChange={(e) => set(a.key, e.target.value)}
                  className={cn(FIELD, 'h-9')}
                />
              </label>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-line-2 px-3.5 py-3 text-sm text-fg-3">
            No standard answers yet. They come from standard_answers in profile.yaml.
          </p>
        )}
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold text-fg">Questions on this job's form</h3>
        <div className="space-y-3">
          {questions.map((a) => {
            const value = draft.value[a.key] ?? '';
            return (
              <label key={a.key} className="block">
                <span className="mb-1 flex items-center gap-2 text-xs text-fg-3">
                  {a.label}
                  {reviewKeys.has(a.key) ? (
                    <span className="rounded-full bg-maybe-wash px-1.5 text-2xs text-maybe">
                      Drafted
                    </span>
                  ) : null}
                </span>
                <textarea
                  ref={bind(a.key)}
                  value={value}
                  onChange={(e) => set(a.key, e.target.value)}
                  placeholder="No answer yet. Leave blank to skip this optional question."
                  rows={value.length > 120 ? 6 : 2}
                  className={cn(FIELD, 'resize-y py-2 leading-relaxed')}
                />
              </label>
            );
          })}
          {questions.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line-2 px-3.5 py-3 text-sm text-fg-3">
              This form only asks the standard questions.
            </p>
          ) : null}
        </div>
      </section>
      <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-2 border-t border-line bg-panel/95 px-1 py-2.5 backdrop-blur">
        <UnsavedMark show={draft.dirty} />
        {draft.dirty ? (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={draft.discard}>
            <RotateCcw />
            Discard
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            disabled={busy !== null}
            onClick={() => void reload()}
          >
            <RefreshCw className={cn(busy === 'reload' && 'animate-spin')} />
            Reload from profile
          </Button>
        )}
        <Button size="sm" disabled={!draft.dirty || busy !== null} onClick={() => void save()}>
          <Save />
          Save
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity: follow-up date, notes, and the timeline
// ---------------------------------------------------------------------------

export function ActivityPanel({
  jobId,
  followUpDate,
  notes,
  groups,
}: {
  jobId: number;
  followUpDate: string;
  notes: string;
  groups: TimelineGroup[];
}) {
  const router = useRouter();
  const date = useDraft(followUpDate, sameText);
  const note = useDraft(notes, sameText);
  const [busy, setBusy] = React.useState(false);

  const saveDate = async (value: string | null) => {
    setBusy(true);
    const res = await setFollowUpDateAction(jobId, value);
    setBusy(false);
    if (!res.ok) return failed("Couldn't save the follow-up date", res.error);
    date.commit(value ?? '');
    toast(value ? 'Saved follow-up date' : 'Cleared the follow-up date');
    router.refresh();
  };

  const saveNotes = async () => {
    setBusy(true);
    const res = await setNotesAction(jobId, note.value);
    setBusy(false);
    if (!res.ok) return failed("Couldn't save the notes", res.error);
    note.commit(note.value);
    toast('Saved notes');
    router.refresh();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
      <div className="min-w-0">
        {groups.length ? (
          <Timeline groups={groups} />
        ) : (
          <p className="rounded-xl border border-dashed border-line-2 px-3.5 py-3 text-sm text-fg-3">
            Nothing has happened on this application yet.
          </p>
        )}
      </div>
      <div className="space-y-3">
        <section className="surface-card chamfer relative rounded-xl p-4">
          <label htmlFor="follow-up" className="text-sm font-semibold text-fg">
            Follow-up
          </label>
          <p className="mt-0.5 text-xs text-fg-3">It shows under Follow-ups on this day.</p>
          <input
            id="follow-up"
            type="date"
            value={date.value}
            onChange={(e) => date.setValue(e.target.value)}
            className={cn(FIELD, 'mt-2.5 h-9 [color-scheme:dark]')}
          />
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <UnsavedMark show={date.dirty} />
            {followUpDate && !date.dirty ? (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                disabled={busy}
                onClick={() => void saveDate(null)}
              >
                Clear
              </Button>
            ) : null}
            <Button
              size="sm"
              className={cn(!(followUpDate && !date.dirty) && 'ml-auto')}
              disabled={!date.dirty || !date.value || busy}
              onClick={() => void saveDate(date.value)}
            >
              <Save />
              Save
            </Button>
          </div>
        </section>
        <section className="surface-card chamfer relative rounded-xl p-4">
          <label htmlFor="notes" className="text-sm font-semibold text-fg">
            Notes
          </label>
          <textarea
            id="notes"
            value={note.value}
            onChange={(e) => note.setValue(e.target.value)}
            rows={5}
            placeholder="Recruiter names, call times, anything to remember."
            className={cn(FIELD, 'mt-2.5 resize-y py-2 leading-relaxed')}
          />
          <div className="mt-2.5 flex items-center gap-2">
            <UnsavedMark show={note.dirty} />
            <Button
              size="sm"
              className="ml-auto"
              disabled={!note.dirty || busy}
              onClick={() => void saveNotes()}
            >
              <Save />
              Save
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The copy-paste fallback
// ---------------------------------------------------------------------------

export function CopyPastePanel({
  rows,
  open: initialOpen,
  reason,
}: {
  rows: CopyRow[];
  open: boolean;
  reason: string;
}) {
  const [open, setOpen] = React.useState(initialOpen);
  const [lastOpen, setLastOpen] = React.useState(initialOpen);
  if (initialOpen !== lastOpen) {
    setLastOpen(initialOpen);
    setOpen(initialOpen);
  }
  if (rows.length === 0) return null;
  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-line bg-surface-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3.5 py-3 text-left outline-none transition-colors hover:bg-surface-2 hover:row-wash focus-visible:bg-surface-2 focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-uv-hi"
      >
        <ClipboardList className="size-4 shrink-0 text-fg-3" />
        <span className="text-sm font-semibold text-fg">Answers to copy and paste</span>
        <span className="font-mono text-xs tnum text-fg-3">{rows.length}</span>
        <ChevronDown
          className={cn(
            'ml-auto size-4 shrink-0 text-fg-3 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open ? (
        <div className="animate-rise-in border-t border-line">
          <p className="px-3.5 py-2.5 text-xs text-fg-3">{reason}</p>
          <ul className="divide-y divide-line border-t border-line">
            {rows.map((row) => (
              <li key={row.key} className="flex items-start gap-3 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-fg-3">{row.label}</div>
                  <div className="mt-1 whitespace-pre-line text-sm leading-relaxed text-fg">
                    {row.value}
                  </div>
                </div>
                <CopyValue value={row.value} label={row.label} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function CopyValue({ value, label }: { value: string; label: string }) {
  const [done, setDone] = React.useState(false);
  const line = value.split('\n')[0]?.trim() ?? '';
  const preview = line.length > 0 && line.length <= 72 ? line : undefined;
  return (
    <Hint label={done ? 'Copied' : `Copy ${label}`} detail={done ? undefined : preview} side="left">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Copy ${label}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
          } catch {
            toast("Couldn't copy", {
              description:
                'The browser refused the clipboard. Select the text and copy it by hand.',
              icon: <TriangleAlert className="text-danger" />,
            });
            return;
          }
          setDone(true);
          window.setTimeout(() => setDone(false), 1200);
          toast('Copied', { description: 'Paste it into the form.' });
        }}
      >
        {done ? <Check className="text-strong" /> : <Copy />}
      </Button>
    </Hint>
  );
}
