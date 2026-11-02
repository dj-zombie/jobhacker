import { existsSync } from 'node:fs';
import type { Profile } from '../config/schemas.js';
import {
  type FieldMapping,
  mapField,
  matchComboOption,
  matchOption,
  matchToggleOption,
  questionKey,
} from './field-map.js';
import { countryFromLocation, locationQuery, matchLocationOption } from './location.js';
import { nationalNumber, phoneCountryFor } from './phone.js';
import { type SafePage, SubmitRefusedError } from './safe-page.js';
import { configuredSelfIdValue, pickSelfIdOption } from './self-id.js';
import type {
  FillReport,
  FilledField,
  FormAdapter,
  OpenQuestion,
  RawFormField,
  UnfilledField,
} from './types.js';

/**
 * Fill one application form through a `SafePage` (FR-8, ARCHITECTURE § Flows
 * "Apply assist" steps 3–6). It maps each detected field; asks `draftAnswers`
 * (the writing model) once for every question nothing else covers; fills text,
 * selects, react-select and typeahead dropdowns, Yes/No toggles and
 * single-choice radio groups; uploads the resume and cover letter; fills
 * self-identification fields deterministically from `profile.yaml`
 * (`self-id.ts`, invariant 7/D66) and leaves consent checkboxes untouched;
 * outlines drafted answers in amber
 * and unfilled required fields in red; and returns a fill report. It never
 * submits — there is no code path to a submit control (invariant 1).
 */

export interface FillDeps {
  profile: Profile;
  /** key → answer text (standard answers + saved form answers, possibly edited). */
  answers: Record<string, string>;
  /** Path to the resume PDF to attach, if one exists. */
  resumePdfPath: string | null;
  /** The application's cover note, for a cover-letter text box. */
  coverNote?: string | null;
  /** Produce the cover-letter PDF, only called when the form has that upload. */
  coverLetterPdf?: () => Promise<string | null>;
  /** A cover letter is attachable even with a gapped note (provided PDF). */
  coverLetterAvailable?: boolean;
  /**
   * Draft answers to the open questions (called at most once, only when there
   * are any). Returns answers keyed by `questionKey(label)`; the caller saves
   * them so a re-fill reuses them.
   */
  draftAnswers?: (questions: OpenQuestion[]) => Promise<Record<string, string>>;
  /**
   * LLM mappings for fields the deterministic rules do not own. EEO and file
   * fields still follow `mapField`. Used by the generic adapter.
   */
  mapFields?: (fields: RawFormField[]) => Promise<Map<string, FieldMapping>>;
  /** ATS name stored on the report. Defaults to the adapter's own name. */
  reportAts?: string;
}

/** Text-like input types we will type into. */
const TEXT_TYPES = new Set(['text', 'email', 'tel', 'url', 'number', 'search', 'textarea', '']);

/** Radio groups that record consent are Kris's to answer, never ours. */
const CONSENT_RE =
  /consent|agree|acknowledg|terms|privacy|text messag|\bsms\b|marketing|subscribe|opt.?in/i;

/** Drafted answers Kris should review are outlined in amber. */
const REVIEW_COLOR = '#f59e0b';

/** One answerable unit: a single field, or a radio group answered together. */
interface Unit {
  /** The field mapping sees (a radio group uses its first radio, labelled by the group). */
  field: RawFormField;
  /** Radio options, when this unit is a radio group. */
  radios?: { label: string; selector: string }[];
}

function fieldLabel(field: RawFormField): string {
  return field.group || field.label || field.name || field.id || '(unnamed field)';
}

function toUnits(fields: RawFormField[]): Unit[] {
  const units: Unit[] = [];
  const groups = new Map<string, Unit>();
  for (const field of fields) {
    if (field.type === 'radio' && field.name) {
      const existing = groups.get(field.name);
      if (existing) {
        existing.radios?.push({ label: field.label, selector: field.selector });
        if (field.required) existing.field = { ...existing.field, required: true };
        continue;
      }
      const unit: Unit = {
        field: { ...field, group: field.group ?? field.label },
        radios: [{ label: field.label, selector: field.selector }],
      };
      groups.set(field.name, unit);
      units.push(unit);
      continue;
    }
    units.push({ field });
  }
  return units;
}

/** Could this unit become a question for the writing model? */
function isAskable(unit: Unit): boolean {
  const f = unit.field;
  if (f.isFile) return false;
  if (fieldLabel(f) === '(unnamed field)' || (f.label.trim() === '' && !f.group)) return false;
  if (f.type === 'checkbox') return false;
  if (unit.radios) {
    const text = `${f.group ?? ''} ${unit.radios.map((r) => r.label).join(' ')}`;
    return !CONSENT_RE.test(text);
  }
  return true;
}

/** Build the question for an unmapped unit, reading a dropdown's options if needed. */
async function toQuestion(page: SafePage, unit: Unit): Promise<OpenQuestion | undefined> {
  const f = unit.field;
  const base = { label: questionKey(fieldLabel(f)), hint: f.hint ?? '', required: f.required };
  if (unit.radios) return { ...base, kind: 'choice', options: unit.radios.map((r) => r.label) };
  if (f.tag === 'toggle')
    return { ...base, kind: 'choice', options: f.options.map((o) => o.label) };
  if (f.tag === 'select') {
    const options = f.options.filter((o) => o.value !== '').map((o) => o.label);
    return options.length > 0 ? { ...base, kind: 'choice', options } : undefined;
  }
  if (f.isComboBox) {
    const options = await page.openComboboxOptions(f.selector);
    await page.dismissMenus();
    // A typeahead shows nothing until you type: draft text, then search it.
    if (options.length === 0) return { ...base, kind: 'text', options: [] };
    return { ...base, kind: 'choice', options: options.map((o) => o.text) };
  }
  if (f.tag === 'textarea') return { ...base, kind: 'textarea', options: [] };
  if (TEXT_TYPES.has(f.type)) return { ...base, kind: 'text', options: [] };
  return undefined;
}

/** A text/select field we filled and must verify actually stuck. */
interface PendingFill {
  field: RawFormField;
  value: string;
  via: FilledField['via'];
  source: string;
  kind: 'text' | 'select';
}

export async function fillForm(
  page: SafePage,
  adapter: FormAdapter,
  deps: FillDeps,
  url: string,
): Promise<FillReport> {
  const fields = await adapter.detectFields(page);
  const units = toUnits(fields);
  const llmMappings = deps.mapFields ? await deps.mapFields(fields) : undefined;

  // Draft every question nothing else covers, in one call.
  let answers = deps.answers;
  const ctx = () => ({
    profile: deps.profile,
    answers,
    coverNote: deps.coverNote ?? null,
    coverLetterAvailable: deps.coverLetterAvailable ?? false,
  });
  if (deps.draftAnswers) {
    const questions: OpenQuestion[] = [];
    const seen = new Set<string>();
    for (const unit of units) {
      if (unit.field.inEntryEditor) continue;
      if (!isAskable(unit) || mapField(unit.field, ctx()).kind !== 'unmapped') continue;
      const q = await toQuestion(page, unit);
      if (q && !seen.has(q.label)) {
        seen.add(q.label);
        questions.push(q);
      }
    }
    if (questions.length > 0) {
      const drafted = await deps.draftAnswers(questions);
      answers = { ...answers, ...drafted };
    }
  }

  const filled: FilledField[] = [];
  // Unfilled is tracked with the selector so we can outline required ones; the
  // selector is stripped before it goes into the report (invariant 4).
  const unfilled: (UnfilledField & { selector: string })[] = [];
  const review: string[] = [];
  const skippedEeo: string[] = [];
  const selfIdentification: { field: string; value: string }[] = [];
  const pending: PendingFill[] = [];
  let resumeAttached = false;

  const markUnfilled = (field: RawFormField, reason?: string) => {
    unfilled.push({
      field: fieldLabel(field),
      required: field.required,
      selector: field.selector,
      ...(reason ? { reason } : {}),
    });
  };
  const markFilled = (field: RawFormField, mapping: Extract<FieldMapping, { kind: 'value' }>) => {
    filled.push({ field: fieldLabel(field), via: mapping.via, source: mapping.source });
    if (mapping.via === 'draft') review.push(field.selector);
  };

  for (const unit of units) {
    const field = unit.field;
    // Entry-editor fields (SmartRecruiters experience/education) belong to
    // the section filler, which Adds and Saves each entry; they are not
    // standalone questions and are reported as entries, not fields.
    if (field.inEntryEditor) continue;
    let mapping = mapField(field, ctx());
    if (mapping.kind !== 'eeo' && mapping.kind !== 'file') {
      const over = llmMappings?.get(field.selector);
      if (over && (over.kind === 'value' || over.kind === 'needs_input')) mapping = over;
    }

    if (mapping.kind === 'eeo') {
      // Self-identification (invariant 7, D66): filled deterministically
      // from profile.yaml by fillSelfId — never from the LLM mapping, never
      // inferred. No configured answer and no decline option → blank, and
      // listed as needing Kris's input.
      const selected = await fillSelfId(page, unit, deps.profile);
      if (selected) selfIdentification.push({ field: fieldLabel(field), value: selected });
      else skippedEeo.push(fieldLabel(field));
      continue;
    }
    // A lone checkbox is never auto-checked (consent/agreement is Kris's, and
    // the entry editors' "I currently work here" box is the section filler's).
    if (field.type === 'checkbox' && !unit.radios) {
      markUnfilled(field, 'checkbox left for you');
      continue;
    }
    if (mapping.kind === 'unmapped') {
      markUnfilled(field);
      continue;
    }
    if (mapping.kind === 'needs_input') {
      markUnfilled(field, mapping.reason);
      continue;
    }

    try {
      if (mapping.kind === 'file') {
        const path =
          mapping.source === 'resume'
            ? deps.resumePdfPath
            : deps.coverLetterPdf
              ? await deps.coverLetterPdf()
              : null;
        if (path && existsSync(path)) {
          await page.setInputFiles(field.selector, path);
          if (mapping.source === 'resume') resumeAttached = true;
          filled.push({
            field: fieldLabel(field),
            via: mapping.source === 'resume' ? 'resume' : 'cover',
            source: mapping.source,
          });
        } else {
          markUnfilled(
            field,
            mapping.source === 'resume' ? 'no resume PDF' : 'no cover note to attach',
          );
        }
        continue;
      }

      // mapping.kind === 'value'
      if (unit.radios) {
        const choice = matchOption(
          unit.radios.map((r) => ({ value: r.selector, label: r.label })),
          mapping.value,
        );
        if (choice && isAskable(unit) && (await page.chooseRadio(choice)))
          markFilled(field, mapping);
        else markUnfilled(field, `no option matches "${mapping.value}"`);
        continue;
      }

      if (field.tag === 'toggle') {
        const option = matchToggleOption(field.options, mapping.value);
        let pressed = false;
        if (option) {
          try {
            pressed = await page.chooseToggle(field.selector, option.label);
          } catch (err) {
            if (!(err instanceof SubmitRefusedError)) throw err;
          }
        }
        if (pressed) markFilled(field, mapping);
        else
          markUnfilled(
            field,
            option ? 'the toggle did not take' : `no option matches "${mapping.value}"`,
          );
        continue;
      }

      if (field.tag === 'select') {
        const optionValue = matchOption(field.options, mapping.value);
        if (optionValue !== undefined) {
          await page.selectOption(field.selector, optionValue);
          pending.push({
            field,
            value: optionValue,
            via: mapping.via,
            source: mapping.source,
            kind: 'select',
          });
        } else {
          markUnfilled(field, `no option matches "${mapping.value}"`);
        }
        continue;
      }

      // Never auto-check consent/agreement checkboxes.
      if (field.type === 'checkbox' || field.type === 'radio') {
        markUnfilled(field);
        continue;
      }

      // Phone widget (SmartRecruiters): set the country from the profile
      // location first, then type the national number. A value the site
      // itself rejects is reported unfilled, never counted as filled.
      if (field.type === 'tel') {
        const country = phoneCountryFor(countryFromLocation(deps.profile.contact.location));
        const widget = country
          ? await page.setPhoneCountry(country.name, country.iso).catch(() => false)
          : false;
        if (country && widget) {
          await page.fill(field.selector, nationalNumber(mapping.value, country));
          await page.blurActive();
          const error = await page.phoneValidationError(field.selector);
          if (error) markUnfilled(field, `site validation: ${error}`);
          else markFilled(field, mapping);
          continue;
        }
      }

      // Autocomplete inputs (SmartRecruiters `spl-autocomplete`) do not
      // commit typed text: the matching menu option must be chosen.
      if (field.autocomplete) {
        const driven = await page.fillAutocomplete(field.selector, mapping.value, {
          locationMatch:
            mapping.source === 'contact.location' || /\b(location|city)\b/i.test(field.label),
        });
        if (driven) markFilled(field, mapping);
        else markUnfilled(field, `no dropdown option matches "${mapping.value}"`);
        continue;
      }

      // react-select and other custom comboboxes ignore a typed value, so they are
      // driven by choosing the matching option (typing a search first when the
      // menu shows nothing, or not the right thing, until you type).
      if (field.isComboBox) {
        const driven = await fillCombobox(page, field, mapping.value, mapping.source);
        if (driven) markFilled(field, mapping);
        else markUnfilled(field, `no dropdown option matches "${mapping.value}"`);
        continue;
      }

      if (TEXT_TYPES.has(field.type)) {
        await page.fill(field.selector, mapping.value);
        pending.push({
          field,
          value: mapping.value,
          via: mapping.via,
          source: mapping.source,
          kind: 'text',
        });
      } else {
        markUnfilled(field);
      }
    } catch (err) {
      // One widget that rejects a value must not abandon the rest of the form.
      if (err instanceof SubmitRefusedError) throw err;
      markUnfilled(field, 'could not be filled');
    }
  }

  // Verify the filled text/select values actually stuck. A hydrating React form
  // (live Greenhouse) can re-render just after a fill and wipe the value, while
  // the immediate read-back looked fine. Let the page settle, re-read, and
  // refill once. Whatever still fails to hold is reported as unfilled, so the
  // report never claims a field is filled when it is empty on screen.
  await page.settle();
  for (const p of pending) {
    try {
      let stuck = await valueStuck(page, p);
      if (!stuck) {
        if (p.kind === 'select') await page.selectOption(p.field.selector, p.value);
        else await page.fill(p.field.selector, p.value);
        stuck = await valueStuck(page, p);
      }
      if (stuck) {
        filled.push({ field: fieldLabel(p.field), via: p.via, source: p.source });
        if (p.via === 'draft') review.push(p.field.selector);
      } else {
        markUnfilled(p.field, 'the value did not stay after the page re-rendered');
      }
    } catch (err) {
      if (err instanceof SubmitRefusedError) throw err;
      markUnfilled(p.field, 'could not be filled');
    }
  }

  // Drafted answers in amber (review them); unfilled required fields in red,
  // scrolled to the first one (step 5).
  await page.highlight(review, REVIEW_COLOR);
  const unfilledRequired = unfilled.filter((u) => u.required).map((u) => u.selector);
  if (unfilledRequired.length > 0) {
    await page.highlight(unfilledRequired);
    const first = unfilledRequired[0];
    if (first) await page.scrollIntoView(first);
  }

  return {
    ats: deps.reportAts ?? adapter.ats,
    url,
    filled,
    unfilled: unfilled.map(({ selector: _selector, ...rest }) => rest),
    skipped_eeo: skippedEeo,
    self_identification: selfIdentification,
    resumeAttached,
  };
}

/**
 * Fill one self-identification field from `profile.yaml` (invariant 7, D66).
 * Returns the exact option text selected, or `undefined` when the field was
 * left blank (no configured answer matches and no decline option exists, or
 * the widget did not take). A configured non-decline value on a free-text
 * field is typed verbatim; `decline` on a free-text field stays blank,
 * because there is no option to select and typing "decline" would be a guess
 * at the form's wording.
 */
async function fillSelfId(
  page: SafePage,
  unit: Unit,
  profile: Profile,
): Promise<string | undefined> {
  const field = unit.field;
  const configured = configuredSelfIdValue(profile, fieldLabel(field));
  try {
    if (unit.radios) {
      const picked = pickSelfIdOption(
        unit.radios.map((r) => r.label),
        configured,
      );
      if (!picked) return undefined;
      const radio = unit.radios.find((r) => r.label === picked);
      if (!radio) return undefined;
      return (await page.chooseRadio(radio.selector)) ? picked : undefined;
    }
    if (field.tag === 'toggle') {
      const picked = pickSelfIdOption(
        field.options.map((o) => o.label),
        configured,
      );
      if (!picked) return undefined;
      return (await page.chooseToggle(field.selector, picked)) ? picked : undefined;
    }
    if (field.tag === 'select') {
      const picked = pickSelfIdOption(
        field.options.map((o) => o.label),
        configured,
      );
      if (!picked) return undefined;
      const optionValue = matchOption(field.options, picked);
      if (optionValue === undefined) return undefined;
      await page.selectOption(field.selector, optionValue);
      return (await page.inputValue(field.selector)) === optionValue ? picked : undefined;
    }
    if (field.autocomplete) {
      // SmartRecruiters `spl-autocomplete`: typed text does not commit until
      // its menu option is chosen, and a combobox-style choose can leave the
      // text showing while the widget still reports the field required
      // (observed live 2026-10-24 on Canva's gender-identity question).
      // Pick from the offered options first, then commit through
      // `fillAutocomplete` with exactly that option's text.
      const suggestions = await page.typeaheadOptions(field.selector, configured);
      const picked = pickSelfIdOption(
        suggestions.map((o) => o.text),
        configured,
      );
      if (!picked) return undefined;
      if (!(await page.fillAutocomplete(field.selector, picked))) return undefined;
      const shown = (await page.inputValue(field.selector)).replace(/\s+/g, '').toLowerCase();
      return shown.includes(picked.replace(/\s+/g, '').toLowerCase()) ? picked : undefined;
    }
    if (field.isComboBox) {
      // Choose directly from the harvested options and read back. Never
      // clear the input on failure: on SmartRecruiters-style widgets,
      // clearing a typed search makes the widget commit its highlighted
      // suggestion — a value nobody picked (observed live 2026-10-24, when
      // a "White" search with no matching option left the first suggested
      // category in the race box).
      const chooseFrom = async (
        options: { text: string; tag: string }[],
      ): Promise<string | undefined> => {
        const picked = pickSelfIdOption(
          options.map((o) => o.text),
          configured,
        );
        if (!picked) return undefined;
        const option = options.find((o) => o.text === picked);
        if (!option) return undefined;
        await page.chooseComboboxOption(option.tag);
        await page.settle(800);
        const shown = (
          (await page.comboboxValue(field.selector)) || (await page.inputValue(field.selector))
        )
          .replace(/\s+/g, '')
          .toLowerCase();
        return shown.includes(picked.replace(/\s+/g, '').toLowerCase()) ? picked : undefined;
      };
      const fromMenu = await chooseFrom(await page.openComboboxOptions(field.selector));
      if (fromMenu) return fromMenu;
      await page.dismissMenus();
      // Typeahead widgets show options only after a search is typed. Search
      // with the configured text itself, then pick from what is offered.
      return chooseFrom(await page.typeaheadOptions(field.selector, configured));
    }
    if (TEXT_TYPES.has(field.type) || field.tag === 'textarea') {
      if (configured.trim().toLowerCase() === 'decline') return undefined;
      await page.fill(field.selector, configured);
      return (await page.inputValue(field.selector)).trim().length > 0 ? configured : undefined;
    }
  } catch (err) {
    if (err instanceof SubmitRefusedError) throw err;
    return undefined;
  }
  return undefined;
}

/**
 * Did a filled value survive? A select must hold the exact option value. A text
 * field only needs to be non-empty: some inputs reformat what you type (phone,
 * dates), and the failure mode we guard against is a re-render clearing it.
 */
async function valueStuck(page: SafePage, p: PendingFill): Promise<boolean> {
  const current = await page.inputValue(p.field.selector);
  return p.kind === 'select' ? current === p.value : current.trim().length > 0;
}

function pickOption(
  options: { text: string; tag: string }[],
  desired: string,
  source: string,
): string | undefined {
  if (options.length === 0) return undefined;
  if (source === 'contact.location') return matchLocationOption(options, desired);
  return matchComboOption(options, desired);
}

/**
 * Drive a combobox to `desired`: open it and pick the matching option; if none
 * matches (or a typeahead shows none until you type), type a search with
 * `fill` and pick from the suggestions. Confirms the control then shows the
 * chosen option. Returns false (field left unfilled, typed search cleared) if
 * nothing matches or the value did not take.
 */
async function fillCombobox(
  page: SafePage,
  field: RawFormField,
  desired: string,
  source: string,
): Promise<boolean> {
  let options = await page.openComboboxOptions(field.selector);
  let tag = pickOption(options, desired, source);
  let typed = false;
  if (!tag) {
    await page.dismissMenus();
    const query = source === 'contact.location' ? locationQuery(desired) : desired;
    options = await page.typeaheadOptions(field.selector, query);
    typed = true;
    tag = pickOption(options, desired, source);
  }
  const chosen = options.find((o) => o.tag === tag)?.text ?? '';
  const giveUp = async () => {
    if (typed) await page.fill(field.selector, '');
    await page.dismissMenus();
    return false;
  };
  if (!tag) return giveUp();
  try {
    await page.chooseComboboxOption(tag);
  } catch (err) {
    if (err instanceof SubmitRefusedError) return giveUp();
    throw err;
  }
  await page.settle(800);
  const shownSelect = (await page.comboboxValue(field.selector)).trim().toLowerCase();
  const shown = shownSelect || (await page.inputValue(field.selector)).trim().toLowerCase();
  const want = chosen.trim().toLowerCase();
  const ok = shown.length > 0 && (shown === want || shown.includes(want) || want.includes(shown));
  if (!ok) return giveUp();
  return true;
}
