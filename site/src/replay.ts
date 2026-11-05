import type { FillRecording, FillStep } from './recording';

/**
 * Replays a recorded fill on the sample form: each value goes in where the filler put it, then
 * the outlines it drew. It sets values and fires the input and change events a real fill
 * fires. It never clicks, presses keys or submits (site/src/guard.test.ts).
 */

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** The ring on the field being filled, while it's being filled. */
const CURRENT = ['ring-4', 'ring-uv-hi/50'];

/** A stand-in PDF for the resume upload. The file input only needs a name and a type. */
const PDF = '%PDF-1.4\n% JobHacker demo: a stand-in resume\n';

export interface ReplayOptions {
  form: HTMLFormElement;
  recording: FillRecording;
  /** Values go in at once, and scrolling jumps. */
  reduceMotion: boolean;
  onStep: (index: number, step: FillStep) => void;
  signal: AbortSignal;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function controlFor(form: HTMLFormElement, id: string): Control | null {
  const el = form.querySelector(`#${CSS.escape(id)}`);
  return el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
    ? el
    : null;
}

function fire(el: Control, ...types: string[]): void {
  for (const type of types) el.dispatchEvent(new Event(type, { bubbles: true }));
}

/** Back to the blank form: no values, no outlines. */
export function resetForm(form: HTMLFormElement): void {
  form.reset();
  for (const el of Array.from(form.querySelectorAll<HTMLElement>('input, select, textarea'))) {
    el.style.outline = '';
    el.style.outlineOffset = '';
    el.classList.remove(...CURRENT);
  }
}

/** Every value and outline at once, as the filler left the form. */
export function applyFinal(form: HTMLFormElement, recording: FillRecording): void {
  for (const step of recording.steps) {
    const el = controlFor(form, step.id);
    if (el) setValue(el, step, step.value);
  }
  applyMarks(form, recording);
}

function setValue(el: Control, step: FillStep, value: string): void {
  if (step.kind === 'text' && !(el instanceof HTMLSelectElement)) {
    el.value = value;
    fire(el, 'input');
  } else if (step.kind === 'select' && el instanceof HTMLSelectElement) {
    el.value = value;
    fire(el, 'input', 'change');
  } else if (step.kind === 'check' && el instanceof HTMLInputElement) {
    el.checked = value === 'true';
    fire(el, 'change');
  } else if (step.kind === 'file' && el instanceof HTMLInputElement) {
    const files = new DataTransfer();
    for (const name of value.split(', ')) {
      files.items.add(new File([PDF], name, { type: 'application/pdf' }));
    }
    el.files = files.files;
    fire(el, 'input', 'change');
  }
}

/** The filler's outlines, as SafePage.highlight draws them, then the first red field in view. */
function applyMarks(form: HTMLFormElement, recording: FillRecording): HTMLElement | null {
  let firstBlank: HTMLElement | null = null;
  for (const step of recording.steps) {
    const el = step.mark ? controlFor(form, step.id) : null;
    if (!el || !step.mark) continue;
    el.style.outline = `2px solid ${recording.colors[step.mark]}`;
    el.style.outlineOffset = '2px';
    if (step.mark === 'blank' && !firstBlank) firstBlank = el;
  }
  return firstBlank;
}

async function typeInto(el: Control, text: string, signal: AbortSignal): Promise<void> {
  const frames = Math.max(4, Math.min(60, Math.ceil(text.length / 4)));
  for (let frame = 1; frame <= frames && !signal.aborted; frame++) {
    el.value = text.slice(0, Math.ceil((text.length * frame) / frames));
    fire(el, 'input');
    await wait(16, signal);
  }
  el.value = text;
}

/** Fill the form step by step. Resolves when it's done, or as soon as `signal` aborts. */
export async function replay({
  form,
  recording,
  reduceMotion,
  onStep,
  signal,
}: ReplayOptions): Promise<void> {
  resetForm(form);
  const scroll = (el: HTMLElement) =>
    el.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });

  for (const [index, step] of recording.steps.entries()) {
    if (signal.aborted) return;
    onStep(index, step);
    const el = controlFor(form, step.id);
    if (!el || step.kind === 'none') continue;
    scroll(el);
    el.classList.add(...CURRENT);
    if (step.kind === 'text' && !reduceMotion) {
      await wait(140, signal);
      await typeInto(el, step.value, signal);
      fire(el, 'change');
    } else {
      setValue(el, step, step.value);
    }
    await wait(reduceMotion ? 90 : 260, signal);
    el.classList.remove(...CURRENT);
  }
  if (signal.aborted) return;

  const firstBlank = applyMarks(form, recording);
  if (firstBlank) {
    await wait(reduceMotion ? 0 : 300, signal);
    scroll(firstBlank);
  }
}
