import { AppToaster, FillReadiness, FillReport, toast } from '@/components/jobhacker';
import type { FillField } from '@/components/jobhacker/types';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ArrowLeft, RotateCcw, SkipForward } from 'lucide-react';
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import SAMPLE_FORM from '../form/sample-form.html?raw';
import './base.css';
import { DemoBanner } from './banner';
import { FILL_CHANNEL, type FillDone } from './fill-channel';
import recordingJson from './fill-recording.json';
import { mount } from './mount';
import type { FillRecording } from './recording';
import { applyFinal, replay } from './replay';

const RECORDING = recordingJson as FillRecording;
const STEPS = RECORDING.steps.length;

const params = new URLSearchParams(window.location.search);
/** Set when the demo's Open & fill opened this tab; the answer goes back under it. */
const RUN = params.get('run');

type Phase = 'waiting' | 'filling' | 'done';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

function Swatch({ color, children }: { color: string; children: string }) {
  return (
    <li className="flex items-center gap-2">
      <span
        aria-hidden
        className="size-3 shrink-0 rounded-[3px] bg-paper"
        style={{ outline: `2px solid ${color}`, outlineOffset: '1px' }}
      />
      {children}
    </li>
  );
}

function StatusCard({
  phase,
  index,
  label,
  onReplay,
  onSkip,
}: {
  phase: Phase;
  index: number;
  label: string;
  onReplay: () => void;
  onSkip: () => void;
}) {
  const done = phase === 'done';
  const shown = done ? STEPS : index;
  const fromDemo = RUN !== null && window.opener !== null;
  return (
    <section
      aria-labelledby="replay-title"
      className="surface-card chamfer relative rounded-xl border border-line bg-surface-2 p-4"
    >
      <p className="hud-label text-fg-3">Open &amp; fill · replay</p>
      <h2 id="replay-title" className="mt-1.5 font-display text-lg text-fg">
        {done ? 'Filled. Nothing was submitted.' : 'Filling the sample form'}
      </h2>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-4">
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-200"
            style={{ width: `${(shown / STEPS) * 100}%` }}
          />
        </div>
        <span className="font-mono text-2xs tnum text-fg-3" aria-live="polite">
          {shown} / {STEPS}
        </span>
      </div>
      <p className="mt-1.5 h-4 truncate font-mono text-2xs text-fg-3">
        {done ? 'Outlined what needs you' : label}
      </p>
      <p className="mt-3 text-xs leading-relaxed text-fg-2">
        A recording of JobHacker's real filler on this form, in headless Chrome, as the demo's
        fictional candidate. It replays here at reading speed; the real fill took{' '}
        {(RECORDING.fillMs / 1000).toFixed(1)} s.
      </p>
      <ul className="mt-3 space-y-1.5 text-xs text-fg-2">
        <Swatch color={RECORDING.colors.review}>Drafted by the model: check it</Swatch>
        <Swatch color={RECORDING.colors.blank}>Required, and left for you</Swatch>
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        {done ? (
          <Button size="sm" variant="secondary" onClick={onReplay}>
            <RotateCcw />
            Replay
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={onSkip}>
            <SkipForward />
            Skip to the end
          </Button>
        )}
        {fromDemo ? (
          <Button size="sm" variant="ghost" onClick={() => window.close()}>
            <ArrowLeft />
            Back to the application
          </Button>
        ) : (
          <Button size="sm" variant="ghost" asChild>
            <a href="/">
              <ArrowLeft />
              Try the demo
            </a>
          </Button>
        )}
      </div>
    </section>
  );
}

function Report({ fields, onApprove }: { fields: FillField[]; onApprove: (id: string) => void }) {
  const count = (state: FillField['state']) => fields.filter((f) => f.state === state).length;
  const later = () =>
    toast('In the app, this opens the Answers tab', {
      description: 'The demo keeps nothing, so there is nowhere to save an answer.',
    });
  return (
    <section aria-label="Fill report" className="space-y-5">
      <FillReadiness
        filled={count('filled')}
        review={count('review')}
        blank={count('blank')}
        requiredBlank={fields.filter((f) => f.state === 'blank' && f.required).length}
        resumeAttached={RECORDING.report.resumeAttached}
      />
      <FillReport
        fields={fields}
        selfIdNote={RECORDING.report.selfIdNote}
        onApprove={onApprove}
        onEdit={later}
        onAddAnswer={later}
        onCopy={() => toast('Copied', { description: 'Paste it into the form.' })}
      />
    </section>
  );
}

function FormPage() {
  const formHost = useRef<HTMLDivElement>(null);
  const run = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<Phase>('waiting');
  const [index, setIndex] = useState(0);
  const [label, setLabel] = useState('Starting');
  const [approved, setApproved] = useState<ReadonlySet<string>>(new Set());
  const wide = useMediaQuery('(min-width: 1024px)');
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const html = useMemo(() => ({ __html: SAMPLE_FORM }), []);

  const form = useCallback(() => {
    const el = formHost.current?.querySelector('form');
    return el instanceof HTMLFormElement ? el : null;
  }, []);

  const finish = useCallback(() => {
    setPhase('done');
    if (!RUN) return;
    const message: FillDone = {
      type: 'fill-done',
      run: RUN,
      filled: RECORDING.report.filled,
      review: RECORDING.report.review,
      blank: RECORDING.report.blank,
    };
    const channel = new BroadcastChannel(FILL_CHANNEL);
    channel.postMessage(message);
    channel.close();
  }, []);

  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;

  const start = useCallback(
    (delay: number) => {
      const el = form();
      if (!el) return;
      run.current?.abort();
      const controller = new AbortController();
      run.current = controller;
      setApproved(new Set());
      setPhase('filling');
      setIndex(0);
      setLabel('Starting');
      window.setTimeout(() => {
        if (controller.signal.aborted) return;
        void replay({
          form: el,
          recording: RECORDING,
          reduceMotion: reduceMotionRef.current,
          signal: controller.signal,
          onStep: (i, step) => {
            setIndex(i + 1);
            setLabel(step.label);
          },
        }).then(() => {
          if (!controller.signal.aborted) finish();
        });
      }, delay);
    },
    [form, finish],
  );

  const skip = useCallback(() => {
    const el = form();
    run.current?.abort();
    if (!el) return;
    applyFinal(el, RECORDING);
    finish();
  }, [form, finish]);

  // The sample form can't be submitted: no action, a disabled button, and this.
  useEffect(() => {
    const el = form();
    if (!el) return;
    const cancel = (event: Event) => event.preventDefault();
    el.addEventListener('submit', cancel);
    return () => el.removeEventListener('submit', cancel);
  }, [form]);

  // Start after a beat with the empty form on screen.
  useEffect(() => {
    start(900);
    return () => run.current?.abort();
  }, [start]);

  const fields = useMemo(
    () =>
      RECORDING.report.fields.map(
        (f): FillField => (approved.has(f.id) ? { ...f, state: 'filled' } : f),
      ),
    [approved],
  );
  const approve = (id: string) => setApproved((all) => new Set(all).add(id));

  const status = (
    <StatusCard
      phase={phase}
      index={index}
      label={label}
      onReplay={() => start(300)}
      onSkip={skip}
    />
  );
  const report =
    phase === 'done' ? (
      <Report fields={fields} onApprove={approve} />
    ) : (
      <p className="rounded-xl border border-dashed border-line-2 px-3.5 py-3 text-sm text-fg-3">
        The fill report appears here when the fill finishes.
      </p>
    );

  return (
    <TooltipProvider>
      <div className="min-h-full bg-canvas text-fg">
        <DemoBanner page="form" />
        <div className="mx-auto grid max-w-[1240px] grid-cols-1 gap-6 px-5 py-6 max-sm:px-3 lg:grid-cols-[minmax(0,1fr)_420px]">
          {wide ? null : status}
          <div
            ref={formHost}
            className="min-w-0 rounded-xl bg-paper p-6 shadow-[0_24px_60px_-30px_rgb(0_0_0/0.8)] max-sm:p-4"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: site/form/sample-form.html, not user input
            dangerouslySetInnerHTML={html}
          />
          {wide ? (
            <aside className="space-y-5 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
              {status}
              {report}
            </aside>
          ) : (
            report
          )}
        </div>
      </div>
      <AppToaster />
    </TooltipProvider>
  );
}

createRoot(mount()).render(
  <StrictMode>
    <FormPage />
  </StrictMode>,
);
