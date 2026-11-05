/** The sample form's tab tells the demo's tab that its replay finished, and with what counts. */
export const FILL_CHANNEL = 'jobhacker-demo-fill';

export interface FillDone {
  type: 'fill-done';
  /** Matches the `run` the demo tab put in the form's URL, so an old tab can't answer. */
  run: string;
  filled: number;
  review: number;
  blank: number;
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

export function isFillDone(value: unknown): value is FillDone {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.type === 'fill-done' &&
    typeof v.run === 'string' &&
    isCount(v.filled) &&
    isCount(v.review) &&
    isCount(v.blank)
  );
}

/** The toast's sentence, in the prototype's words: filled includes the drafted ones. */
export function describeFill(done: Pick<FillDone, 'filled' | 'review' | 'blank'>): string {
  const drafted = done.review ? `, ${done.review} drafted for review` : '';
  const blank = done.blank ? `, ${done.blank} left blank` : '';
  return `${done.filled + done.review} fields filled${drafted}${blank}. Nothing was submitted.`;
}
