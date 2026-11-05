import { z } from 'zod';

/**
 * What `pnpm demo:record` (scripts/record-demo-fill.ts) saw the real filler do to the sample
 * form, and what /form/ replays. The recorder and the tests validate against this schema; the
 * page imports only the type, so zod stays out of the bundle.
 */

const stepSchema = z
  .object({
    /** The control's id in site/form/sample-form.html. */
    id: z.string().min(1),
    label: z.string(),
    /** How the replay sets it: `none` is a field the filler left alone but outlined. */
    kind: z.enum(['text', 'select', 'check', 'file', 'none']),
    /** Text, the option value, `true` for a checked box, or the attached file names. */
    value: z.string(),
    /** The outline the filler drew: amber to review, red for a required field left blank. */
    mark: z.enum(['review', 'blank']).nullable(),
  })
  .strict();

const fieldSchema = z
  .object({
    id: z.string().min(1),
    label: z.string(),
    value: z.string().optional(),
    state: z.enum(['filled', 'review', 'blank']),
    source: z.enum(['profile', 'drafted', 'resume', 'cover-note', 'self-id']).optional(),
    required: z.boolean().optional(),
    note: z.string().optional(),
  })
  .strict();

const count = z.number().int().nonnegative();

export const recordingSchema = z
  .object({
    about: z.string(),
    /** sha256 of site/form/sample-form.html when this was recorded. */
    formSha256: z.string().regex(/^[0-9a-f]{64}$/),
    ats: z.string(),
    url: z.string().url(),
    /** How long the real fill took in headless Chrome. */
    fillMs: count,
    /** The outline colors the filler used, as it drew them. */
    colors: z.object({ review: z.string(), blank: z.string() }).strict(),
    /** In form order. */
    steps: z.array(stepSchema),
    /** The app's fill report for this run (core/apply/fill-view.ts), in the kit's shape. */
    report: z
      .object({
        fields: z.array(fieldSchema),
        filled: count,
        review: count,
        blank: count,
        requiredBlank: count,
        resumeAttached: z.boolean(),
        selfIdNote: z.string(),
      })
      .strict(),
    /** The drafting step: the open questions, and what grounding let through. */
    draft: z
      .object({
        questions: z.array(z.string()),
        answered: count,
        needsInput: count,
        rejected: count,
      })
      .strict(),
    submits: z.literal(0),
  })
  .strict();

export type FillRecording = z.infer<typeof recordingSchema>;
export type FillStep = FillRecording['steps'][number];
