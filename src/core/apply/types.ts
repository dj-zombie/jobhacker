import type { SafePage } from './safe-page.js';

/**
 * Shared types for apply-assist (FR-8, ARCHITECTURE § Flows "Apply assist").
 * The browser never submits: all page access goes through `SafePage`, and the
 * adapters under `adapters/` are forbidden from calling click/press/submit/
 * keyboard (enforced by the grep guard in `guard.test.ts`).
 */

/** A form field discovered on the page, with everything mapping needs. */
export interface RawFormField {
  /** A selector that uniquely resolves this element on the page. */
  selector: string;
  /**
   * `toggle` is a group of `aria-pressed` buttons answering one question
   * (Ashby's Yes/No). Its `selector` is the group and `options` are the buttons.
   */
  tag: 'input' | 'textarea' | 'select' | 'toggle';
  /** The input `type` (lowercased), `select`/`textarea`/`toggle` for those tags. */
  type: string;
  name: string | null;
  id: string | null;
  /** Resolved visible label (from `<label>`, aria-*, or placeholder). */
  label: string;
  required: boolean;
  /** `<select>` options, or a toggle group's buttons (empty for other tags). */
  options: { value: string; label: string }[];
  /** True when the field is a file input. */
  isFile: boolean;
  /**
   * True for a custom dropdown (react-select and similar): an input with
   * `role=combobox` or `aria-autocomplete=list`. Typing into it does not select
   * an option, so the fill loop drives it by choosing an option.
   */
  isComboBox: boolean;
  /**
   * True when the input lives inside a `spl-autocomplete` (SmartRecruiters):
   * typed text does not commit until the matching menu option is chosen, and
   * an unchosen value is cleared on blur.
   */
  autocomplete?: boolean;
  /**
   * True when the field is inside an Add/Edit entry editor (experience or
   * education on SmartRecruiters). The generic fill loop leaves these to the
   * section filler, which Saves each entry; they are not separate questions.
   */
  inEntryEditor?: boolean;
  /**
   * True when the field sits inside a voluntary self-identification / EEO
   * section (detected by a section heading). Belt-and-suspenders with the
   * per-label `isEeoField` check in `field-map.ts` (invariant 7).
   */
  inEeoSection: boolean;
  /** Help text shown with the question (Ashby descriptions), capped. */
  hint?: string;
  /** For a radio button: the question its group answers (the option is `label`). */
  group?: string;
}

/**
 * A form adapter. Greenhouse, Lever, and Ashby have their own. `generic` is
 * the path for every other page. Keep these free of click/press/submit.
 */
export interface FormAdapter {
  ats: 'greenhouse' | 'lever' | 'ashby' | 'generic';
  /** True when this adapter handles the given apply URL. */
  canHandle(url: string): boolean;
  /** Find the fillable fields on the open application page. */
  detectFields(page: SafePage): Promise<RawFormField[]>;
}

/**
 * A form question no profile rule or saved answer covers, sent to the writing
 * model for a draft. `label` doubles as the key the answer is saved under.
 */
export interface OpenQuestion {
  label: string;
  hint: string;
  required: boolean;
  /** `choice` answers must be one of `options`; `text` is one line; `textarea` is prose. */
  kind: 'text' | 'textarea' | 'choice';
  options: string[];
}

/** One filled field in the report. */
export interface FilledField {
  field: string;
  /**
   * `draft` is a model-drafted (or human-edited) answer to a question on this
   * form: Kris reviews these before submitting. `cover` is the cover note.
   */
  via: 'profile' | 'answer' | 'resume' | 'draft' | 'cover';
  /** Profile key or answer key the value came from. */
  source: string;
}

/** One field left unfilled (either unmapped, or its value was missing). */
export interface UnfilledField {
  field: string;
  required: boolean;
  /** Why it was left, when known (e.g. "needs your input: …"). */
  reason?: string;
}

/** The result of filling a form (FR-8, persisted to the application + events). */
export interface FillReport {
  ats: string;
  url: string;
  filled: FilledField[];
  unfilled: UnfilledField[];
  /**
   * EEO / self-identification fields left blank because neither a configured
   * answer nor a decline option existed (invariant 7, D66). These need Kris.
   */
  skipped_eeo: string[];
  /**
   * Self-identification fields filled from `profile.yaml` (invariant 7, D66):
   * the field and the exact option selected, so Kris sees what was entered
   * before he submits. Values come only from his config, never inferred.
   */
  self_identification: { field: string; value: string }[];
  resumeAttached: boolean;
}

/** Thrown for apply-flow problems (missing application, unsupported ATS, …). */
export class ApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApplyError';
  }
}
