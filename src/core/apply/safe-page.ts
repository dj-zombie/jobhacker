import type { Page } from 'playwright-core';
import type { RawFormField } from './types.js';

/**
 * `SafePage` (ARCHITECTURE § SafePage) wraps a Playwright `Page` and is the ONLY
 * thing the apply flow is allowed to touch. It enforces invariant 1: there is no
 * method that can submit a form. The write surface is exactly
 * `goto/fill/selectOption/check/setInputFiles`; everything else is a read
 * (`query/readText/inputValue/isChecked/scanFields`) or a non-submitting UI aid
 * (`highlight`, `scrollIntoView`). The single click method, `safeClick`, refuses
 * any submit-like target and exists only to open custom dropdowns. Custom
 * controls are driven by synthetic events scoped to one field and guarded the
 * same way: react-select options (`chooseComboboxOption`), typeaheads
 * (`typeaheadOptions`, which only `fill`s), and form-less Yes/No toggles
 * (`chooseToggle`, which refuses anything with a form owner).
 *
 * A raw `Page` must never leave this file or `browser.ts`.
 */

/** Accessible name / text that indicates a submit-or-send control. */
export const SUBMIT_TEXT_RE = /submit|apply|send|finish|complete/i;

/** Pure predicate: does this accessible name / text read as a submit control? */
export function isSubmitLikeText(text: string): boolean {
  return SUBMIT_TEXT_RE.test(text);
}

/**
 * Greenhouse job boards are a Remix/React app. Values written before hydration
 * are wiped. The marker strings are in the server HTML, so a static form
 * (Lever, our fixtures) does not wait.
 */
export function pageMayHydrate(html: string): boolean {
  return /__react|react-select|data-reactroot|remix-css/i.test(html);
}

/** Thrown by `safeClick` when asked to click a submit-like element (invariant 1). */
export class SubmitRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubmitRefusedError';
  }
}

export class SafePage {
  constructor(private readonly page: Page) {}

  /**
   * tsx compiles functions with an esbuild `__name` helper. Playwright sends
   * those functions into the page, where the helper does not exist. Define it
   * before the next navigation. A string, so this call is not itself rewritten.
   */
  private installPageHelper(): Promise<void> {
    return this.page
      .addInitScript(
        'globalThis.__name = globalThis.__name || ((target, value) => Object.defineProperty(target, "name", { value, configurable: true }));',
      )
      .then(() => undefined);
  }

  // --- Navigation / writes (the only state-changing surface) ----------------

  async goto(url: string): Promise<void> {
    await this.installPageHelper();
    await this.page.goto(url, { waitUntil: 'load' });
    // Client-rendered forms (Ashby, SmartRecruiters Easy Apply) are an empty
    // shell at 'load', and Easy Apply keeps its inputs in open shadow roots.
    // A hidden input in that shell does not count either: the field has to
    // be on screen.
    // Poll from Node with a function predicate, never a string one:
    // Playwright evaluates a string predicate with an in-page `eval`, which
    // a nonce CSP (Ashby) forbids — the fill died before it started there.
    // Function evaluations go through CDP, like every other method here.
    await this.pollPredicate(() => {
      const ready = (node: Document | ShadowRoot): boolean => {
        const list = node.querySelectorAll('input, textarea, select');
        for (const el of Array.from(list)) {
          const type = (el.getAttribute('type') || '').toLowerCase();
          if (
            type === 'hidden' ||
            type === 'submit' ||
            type === 'button' ||
            type === 'reset' ||
            type === 'image'
          )
            continue;
          const control = el as HTMLInputElement;
          if (control.disabled || control.readOnly || el.getAttribute('aria-hidden') === 'true')
            continue;
          if (el.getClientRects().length > 0) return true;
        }
        const all = node.querySelectorAll('*');
        for (const el of Array.from(all)) {
          if (el.shadowRoot && ready(el.shadowRoot)) return true;
        }
        return false;
      };
      return ready(document);
    }, 20000);
    const html = await this.page.content();
    if (!pageMayHydrate(html)) return;
    // Hydration may never attach. Fill anyway; the report shows what stuck.
    await this.pollPredicate(() => {
      const el = document.querySelector('input, textarea, select');
      if (!el) return false;
      return Object.keys(el).some((key) => key.startsWith('__react'));
    }, 8000);
    // Let late-loading sections (custom questions) arrive and re-render before we
    // fill, so a re-render does not wipe values we just typed. Best effort.
    await this.settle();
  }

  /**
   * Poll a self-contained predicate in the page until it holds or the
   * deadline passes. Returns whether it ever held; a failed evaluation
   * (mid-navigation, torn-down context) counts as "not yet", not an error.
   */
  private async pollPredicate(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        if (await this.page.evaluate(predicate)) return true;
      } catch {
        // Keep polling until the deadline.
      }
      if (Date.now() >= deadline) return false;
      await this.page.waitForTimeout(150);
    }
  }

  /**
   * Wait for the page to go quiet (network idle), best effort. A non-submitting
   * read-only aid used before filling and when verifying that filled values
   * survived a React re-render.
   */
  async settle(timeoutMs = 1500): Promise<void> {
    try {
      await this.page.waitForLoadState('networkidle', { timeout: timeoutMs });
    } catch {
      // networkidle may never be reached on a chatty page; proceed anyway.
    }
  }

  async fill(selector: string, value: string): Promise<void> {
    await this.page.fill(selector, value);
  }

  async selectOption(selector: string, value: string): Promise<string[]> {
    return this.page.selectOption(selector, value);
  }

  async check(selector: string): Promise<void> {
    await this.page.check(selector);
  }

  async setInputFiles(selector: string, files: string | string[]): Promise<void> {
    await this.page.setInputFiles(selector, files);
  }

  // --- Reads ----------------------------------------------------------------

  async query(selector: string): Promise<boolean> {
    return (await this.page.$(selector)) !== null;
  }

  async readText(selector: string): Promise<string> {
    return (await this.page.textContent(selector)) ?? '';
  }

  async inputValue(selector: string): Promise<string> {
    return this.page.inputValue(selector);
  }

  async isChecked(selector: string): Promise<boolean> {
    return this.page.isChecked(selector);
  }

  async fileCount(selector: string): Promise<number> {
    return this.page.$eval(selector, (el) => {
      const input = el as HTMLInputElement;
      return input.files ? input.files.length : 0;
    });
  }

  /**
   * Discover fillable fields on the page. Reads only (via `evaluate`, which
   * may tag elements with `data-jobhacker-*` attributes so they can be
   * addressed). Fields in a section whose heading matches `eeoHeadingPattern`,
   * or inside an `eeoWithin` container, are flagged `inEeoSection` so the
   * caller leaves them untouched (invariant 7). Fields inside `excludeWithin`
   * are not reported at all (Ashby's "Autofill from resume" uploader).
   *
   * Besides inputs/selects/textareas it reports button groups whose buttons
   * carry `aria-pressed` (Ashby Yes/No) as one `toggle` field, and gives each
   * radio the question its group answers (`group`).
   */
  async scanFields(
    opts: { eeoHeadingPattern?: string; eeoWithin?: string; excludeWithin?: string } = {},
  ): Promise<RawFormField[]> {
    return this.page.evaluate((o): RawFormField[] => {
      const eeoHeadingPattern = o.eeoHeadingPattern;
      const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
      const excluded = (el: Element): boolean =>
        o.excludeWithin ? el.closest(o.excludeWithin) !== null : false;

      // Mark EEO/self-identification section containers by their heading text.
      const eeoRoots: Element[] = o.eeoWithin
        ? Array.from(document.querySelectorAll(o.eeoWithin))
        : [];
      if (eeoHeadingPattern) {
        const re = new RegExp(eeoHeadingPattern, 'i');
        const headings = document.querySelectorAll(
          'h1, h2, h3, h4, h5, h6, legend, [role="heading"]',
        );
        for (const h of Array.from(headings)) {
          if (re.test((h.textContent ?? '').trim())) {
            const container =
              h.closest('fieldset, section, div[class], form > div, .field, .form-section') ??
              h.parentElement;
            if (container) eeoRoots.push(container);
          }
        }
      }
      const inEeo = (el: Element): boolean => eeoRoots.some((root) => root.contains(el));
      const tidy = (value: string | null | undefined): string =>
        (value ?? '').replace(/\s+/g, ' ').trim();

      // The per-question wrapper and its title, across Lever/Greenhouse/Ashby.
      const BOX =
        '.file-upload, .application-question, .field-wrapper, .ashby-application-form-field-entry';
      const TITLE = '.upload-label, .application-label, .ashby-application-form-question-title';
      const ENTRY =
        '.ashby-application-form-field-entry, fieldset, .application-question, [role="radiogroup"]';
      const ENTRY_TITLE =
        '.ashby-application-form-question-title, legend, .application-label, .text';

      const boxTitle = (el: Element): string => {
        const box = el.closest(BOX);
        return tidy(box?.querySelector(TITLE)?.textContent);
      };
      const entryOf = (el: Element): Element | null => el.closest(ENTRY);
      const entryTitle = (entry: Element | null): string =>
        tidy(entry?.querySelector(ENTRY_TITLE)?.textContent);
      const hintFor = (el: Element): string => {
        const entry = el.closest(
          '.ashby-application-form-field-entry, fieldset, .application-question',
        );
        const desc = entry?.querySelector(
          '.ashby-application-form-question-description, .application-description, .description',
        );
        return tidy(desc?.textContent).slice(0, 500);
      };
      // Ashby marks required questions only with a class on the title.
      const titleRequired = (el: Element): boolean => {
        const entry = el.closest('.ashby-application-form-field-entry, fieldset');
        const title = entry?.querySelector('.ashby-application-form-question-title');
        return title ? /_required/.test(title.className) : false;
      };

      const shadowHost = (el: Element): Element | null => {
        const root = el.getRootNode();
        return root instanceof ShadowRoot ? root.host : null;
      };

      const labelFor = (el: Element): string => {
        const he = el as HTMLElement;
        // SmartRecruiters Easy Apply puts the real input in an open shadow
        // root and the human label on the host (`label="First name"`).
        const hostLabel = tidy(
          shadowHost(el)?.getAttribute('label') || shadowHost(el)?.getAttribute('aria-label'),
        );
        if (hostLabel) return hostLabel;
        // Lever/Greenhouse/Ashby put the human label on a sibling (.application-label,
        // .upload-label, question title). A wrapping <label> also contains every
        // <option>, which would dump the whole country list into the fill report.
        const kind = (he.getAttribute('type') ?? '').toLowerCase();
        if (kind !== 'checkbox' && kind !== 'radio') {
          const namedText = boxTitle(he);
          if (namedText) return namedText;
        }
        const id = he.id;
        if (id) {
          const esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id;
          const l = document.querySelector(`label[for="${esc}"]`);
          if (l?.textContent) return tidy(l.textContent);
        }
        const wrapping = he.closest('label');
        if (wrapping) {
          const clone = wrapping.cloneNode(true) as HTMLElement;
          for (const node of Array.from(
            clone.querySelectorAll('input, textarea, select, button, svg'),
          )) {
            node.remove();
          }
          const wrapped = tidy(clone.textContent);
          if (wrapped) return wrapped;
        }
        const aria = he.getAttribute('aria-label');
        if (aria) return aria;
        const labelledby = he.getAttribute('aria-labelledby');
        if (labelledby) {
          const parts = labelledby
            .split(/\s+/)
            .map((ref) => document.getElementById(ref)?.textContent ?? '')
            .join(' ');
          if (parts.trim()) return parts;
        }
        const placeholder = he.getAttribute('placeholder');
        if (placeholder) return placeholder;
        return '';
      };

      const out: RawFormField[] = [];

      // Toggle groups: a parent with two or more aria-pressed buttons answers
      // one question (Ashby Yes/No). Their hidden backing checkbox is skipped.
      const toggleGroups: Element[] = [];
      for (const btn of Array.from(document.querySelectorAll('button[aria-pressed]'))) {
        const parent = btn.parentElement;
        if (!parent || toggleGroups.includes(parent)) continue;
        const buttons = Array.from(parent.querySelectorAll(':scope > button[aria-pressed]'));
        if (buttons.length < 2) continue;
        // Only answer buttons inside a question, never an editor toolbar.
        if (
          !parent.closest(
            '.ashby-application-form-field-entry, fieldset, .field-wrapper, .field, .application-question',
          )
        )
          continue;
        if (parent.closest('[role="toolbar"]')) continue;
        if (
          buttons.some((b) => tidy(b.textContent).length === 0 || tidy(b.textContent).length > 40)
        )
          continue;
        if (excluded(parent) || parent.getClientRects().length === 0) continue;
        toggleGroups.push(parent);
      }
      toggleGroups.forEach((group, i) => {
        group.setAttribute('data-jobhacker-toggle', String(i));
        const buttons = Array.from(group.querySelectorAll(':scope > button[aria-pressed]'));
        const entry = group.closest(
          '.ashby-application-form-field-entry, fieldset, .field-wrapper, .field',
        );
        const label =
          tidy(
            entry?.querySelector('.ashby-application-form-question-title, legend, label')
              ?.textContent,
          ) || tidy(group.getAttribute('aria-label'));
        const backing = group.querySelector('input[name]');
        out.push({
          selector: `[data-jobhacker-toggle="${i}"]`,
          tag: 'toggle',
          type: 'toggle',
          name: backing?.getAttribute('name') ?? null,
          id: null,
          label,
          required: titleRequired(group),
          options: buttons.map((b) => ({
            value: b.getAttribute('data-option') ?? tidy(b.textContent),
            label: tidy(b.textContent),
          })),
          isFile: false,
          isComboBox: false,
          inEeoSection: inEeo(group),
          hint: hintFor(group),
        });
      });

      const deepFields = (root: ParentNode): Element[] => {
        const found: Element[] = [];
        const walk = (node: ParentNode): void => {
          found.push(...Array.from(node.querySelectorAll('input, textarea, select')));
          for (const child of Array.from(node.querySelectorAll('*'))) {
            if (child.shadowRoot) walk(child.shadowRoot);
          }
        };
        walk(root);
        return found;
      };
      const nodes = deepFields(document);
      let auto = 0;
      for (const el of nodes) {
        const tag = el.tagName.toLowerCase() as 'input' | 'textarea' | 'select';
        const rawType = (el.getAttribute('type') ?? tag).toLowerCase();
        const type = tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : rawType;
        if (tag === 'input' && SKIP_TYPES.has(rawType)) continue;
        if (excluded(el)) continue;
        if (toggleGroups.some((g) => g.contains(el))) continue;
        // Never a CAPTCHA response field (invariant 2).
        if (/recaptcha|captcha/i.test(`${el.getAttribute('name') ?? ''} ${el.id}`)) continue;

        const he = el as HTMLInputElement;
        // Skip disabled / read-only fields — they cannot be filled.
        if (he.disabled || he.readOnly) continue;
        // Skip fields that are not rendered (display:none template rows), but
        // keep file inputs, which sites often hide behind a styled dropzone and
        // which `setInputFiles` can still populate.
        const isFileInput = tag === 'input' && rawType === 'file';
        const host = shadowHost(el);
        // SmartRecruiters' "apply with résumé" dropzone parses the file itself.
        // The résumé field is a separate dropzone; this one is left alone.
        if (isFileInput && /apply-with|autofill/i.test(host?.getAttribute('data-test') ?? ''))
          continue;
        // react-select's required mirror is aria-hidden and not a field to fill.
        if (!isFileInput && he.getAttribute('aria-hidden') === 'true') continue;
        if (!isFileInput && el.getClientRects().length === 0) continue;
        const id = he.id || null;
        const name = he.getAttribute('name') || null;
        // A shadow input often shares its id with the host. `#id` would hit
        // the host, which is not fillable, so address the input itself.
        const inShadow = shadowHost(el) !== null;
        let selector: string;
        if (!inShadow && id) {
          selector = typeof CSS !== 'undefined' && CSS.escape ? `#${CSS.escape(id)}` : `#${id}`;
        } else if (
          !inShadow &&
          name &&
          document.querySelectorAll(`[name="${name}"]`).length === 1
        ) {
          selector = `${tag}[name="${name}"]`;
        } else {
          he.setAttribute('data-jobhacker-field', String(auto));
          selector = `[data-jobhacker-field="${auto}"]`;
        }
        auto++;

        const required =
          he.hasAttribute('required') ||
          host?.hasAttribute('required') === true ||
          he.getAttribute('aria-required') === 'true' ||
          he.closest('[aria-required="true"]') !== null ||
          titleRequired(he);
        const isComboBox =
          he.getAttribute('role') === 'combobox' || he.getAttribute('aria-autocomplete') === 'list';
        const options =
          tag === 'select'
            ? Array.from((el as HTMLSelectElement).options).map((opt) => ({
                value: opt.value,
                label: (opt.textContent ?? '').replace(/\s+/g, ' ').trim(),
              }))
            : [];
        const group = rawType === 'radio' ? entryTitle(entryOf(he)) || undefined : undefined;
        const fileHint = isFileInput
          ? tidy(
              `${host?.getAttribute('data-test') ?? ''} ${host?.parentElement?.innerText ?? ''}`,
            ).slice(0, 120)
          : '';

        // Climb through shadow hosts: some widgets (SmartRecruiters) put the
        // component that owns this input several shadow roots up.
        const parentOrHost = (node: Element): Element | null =>
          node.parentElement ??
          (node.getRootNode() instanceof ShadowRoot
            ? (node.getRootNode() as ShadowRoot).host
            : null);
        let autocomplete = false;
        let inEntryEditor = false;
        let label = labelFor(el).replace(/\s+/g, ' ').trim();
        let fallbackLabel = '';
        let anc: Element | null = el;
        // Autocomplete and date fields sit several shadow roots deep inside
        // an entry editor, so the climb needs more steps than a plain input.
        for (let depth = 0; depth < 30 && anc; depth++) {
          anc = parentOrHost(anc);
          if (!anc) break;
          if (anc.tagName === 'SPL-AUTOCOMPLETE') autocomplete = true;
          // Entry editors (SmartRecruiters experience/education) wrap their
          // fields in an `*-edit-form` panel; the section filler owns those.
          if (/edit-form/.test(String(anc.className ?? ''))) inEntryEditor = true;
          if (!label && /^SR-QUESTION/i.test(anc.tagName)) {
            label = tidy(anc.textContent)
              .replace(/\s*\d+\s*\/\s*\d+\s*$/, '')
              .trim();
          }
          if (!fallbackLabel) {
            const text = tidy(anc.textContent);
            // Skip the bare "*" required mark on the way up to real label text.
            if (text.length > 3 && text.length <= 160 && /[a-z]/i.test(text)) {
              fallbackLabel = text;
            }
          }
        }
        if (!label) label = fallbackLabel;
        if (host?.getAttribute('ariacontrols') || host?.getAttribute('aria-controls')) {
          autocomplete = true;
        }

        out.push({
          selector,
          tag,
          type,
          name,
          id,
          label,
          required,
          options,
          isFile: isFileInput,
          isComboBox,
          autocomplete,
          inEntryEditor,
          inEeoSection: inEeo(el),
          hint: tidy(`${hintFor(el)} ${fileHint}`),
          group,
        });
      }
      return out;
    }, opts);
  }

  // --- Non-submitting UI aids ----------------------------------------------

  /**
   * Outline the given selectors (red by default: unfilled required fields;
   * amber marks drafted answers Kris should review).
   */
  async highlight(selectors: string[], color = '#e11d48'): Promise<number> {
    if (selectors.length === 0) return 0;
    return this.page.evaluate(
      ({ sels, c }) => {
        const find = (sel: string): HTMLElement | null => {
          const direct = document.querySelector(sel) as HTMLElement | null;
          if (direct) return direct;
          const match = sel.match(/data-jobhacker-field="([^"]+)"/);
          if (!match) return null;
          const deep = (root: ParentNode): HTMLElement | null => {
            for (const el of Array.from(root.querySelectorAll('*'))) {
              if (el.getAttribute?.('data-jobhacker-field') === match[1]) {
                return el as HTMLElement;
              }
              if (el.shadowRoot) {
                const hit = deep(el.shadowRoot);
                if (hit) return hit;
              }
            }
            return null;
          };
          return deep(document);
        };
        let n = 0;
        for (const sel of sels) {
          const el = find(sel);
          if (el) {
            el.style.outline = `2px solid ${c}`;
            el.style.outlineOffset = '2px';
            // A combobox input is a few pixels tall. Outline the visible field too.
            const combo =
              el.getAttribute('role') === 'combobox' ||
              el.getAttribute('aria-autocomplete') === 'list';
            if (combo) {
              const box = el.closest('.field-wrapper, .field, .application-question');
              if (box instanceof HTMLElement && box !== el) {
                box.style.outline = `2px solid ${c}`;
                box.style.outlineOffset = '2px';
              }
            }
            n++;
          }
        }
        return n;
      },
      { sels: selectors, c: color },
    );
  }

  /** Scroll the first matching selector into view (does not click). */
  async scrollIntoView(selector: string): Promise<void> {
    await this.page.evaluate((sel) => {
      let el: Element | null = document.querySelector(sel);
      if (!el) {
        const match = sel.match(/data-jobhacker-field="([^"]+)"/);
        const deep = (root: ParentNode): Element | null => {
          for (const node of Array.from(root.querySelectorAll('*'))) {
            if (node.getAttribute?.('data-jobhacker-field') === match?.[1]) return node;
            if (node.shadowRoot) {
              const hit = deep(node.shadowRoot);
              if (hit) return hit;
            }
          }
          return null;
        };
        if (match) el = deep(document);
      }
      el?.scrollIntoView({ block: 'center' });
    }, selector);
  }

  // --- The only click, and it refuses to submit -----------------------------

  /**
   * Click an element ONLY if it is not a submit-like control (invariant 1).
   * Refuses: `button[type=submit]` / `input[type=submit]`; any element whose
   * accessible name or text matches `/submit|apply|send|finish|complete/i`; and
   * any element inside a form's action bar. Intended for custom dropdowns only.
   */
  async safeClick(selector: string): Promise<void> {
    const handle = await this.page.$(selector);
    if (!handle) throw new Error(`safeClick: no element matches ${selector}`);

    const info = await handle.evaluate((el) => {
      const he = el as HTMLElement;
      const tag = he.tagName.toLowerCase();
      const type = (he.getAttribute('type') ?? '').toLowerCase();
      const name =
        he.getAttribute('aria-label') ?? he.getAttribute('value') ?? he.textContent ?? '';
      const inActionBar =
        he.closest(
          'form [class*="action" i], form [class*="footer" i], form [class*="submit" i], [role="toolbar"]',
        ) !== null;
      const isNativeSubmit =
        (tag === 'button' && (type === 'submit' || type === '')) ||
        (tag === 'input' && /^(submit|image)$/.test(type));
      return { name: name.replace(/\s+/g, ' ').trim(), inActionBar, isNativeSubmit };
    });

    if (info.isNativeSubmit) {
      throw new SubmitRefusedError(`safeClick refused a submit control (${selector})`);
    }
    if (isSubmitLikeText(info.name)) {
      throw new SubmitRefusedError(
        `safeClick refused an element that reads as submit/apply/send ("${info.name}")`,
      );
    }
    if (info.inActionBar) {
      throw new SubmitRefusedError(
        `safeClick refused an element inside a form action bar (${selector})`,
      );
    }
    await handle.click();
  }

  // --- react-select (custom dropdown) support, non-submitting -----------------
  //
  // react-select renders a custom menu that native selectOption cannot drive.
  // These helpers open the menu, read its options, choose one, and read back the
  // selected value, all scoped to the field's own container and using the same
  // submit-refusal guard. They never operate a submit control (options are
  // values like "Yes"/"No"), and EEO comboboxes never reach here because the
  // field mapper returns `kind:'eeo'` before the combobox branch.

  /**
   * Close any open custom menu (best effort). react-select closes its menu on
   * blur, so blur whatever has focus, then press outside for menus that close
   * on an outside mousedown.
   */
  async dismissMenus(): Promise<void> {
    await this.page.evaluate(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body) active.blur();
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
  }

  // --- Toggle groups (Ashby Yes/No), non-submitting ---------------------------
  //
  // Ashby answers Yes/No questions with two <button aria-pressed> elements.
  // They have no `type`, so by HTML default they are submit buttons, which is
  // why `safeClick` refuses them. They are safe to press only because they
  // belong to no form: an Ashby application page has no <form> element, and
  // the "Submit Application" button is a separate script-driven button. So
  // `chooseToggle` refuses any option that has a form owner, reads as
  // submit-like, sits inside a submit control, or is not an aria-pressed
  // toggle; it also blocks any submit event during the press. It then reads
  // `aria-pressed` back to confirm.

  /**
   * Press the button labelled `optionText` in the toggle group at
   * `groupSelector`. Returns true when that button now reports
   * `aria-pressed="true"`. Throws `SubmitRefusedError` for anything that could
   * submit (invariant 1).
   */
  async chooseToggle(groupSelector: string, optionText: string): Promise<boolean> {
    const check = await this.page.evaluate(
      ({ sel, text }) => {
        const group = document.querySelector(sel);
        if (!group) return { ok: false, reason: `no toggle group matches ${sel}` };
        const want = text.trim().toLowerCase();
        const buttons = Array.from(group.querySelectorAll(':scope > button[aria-pressed]'));
        const btn = buttons.find(
          (b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase() === want,
        ) as HTMLButtonElement | undefined;
        if (!btn) return { ok: false, reason: `no "${text}" option in ${sel}` };
        const name = (btn.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (btn.form) return { ok: false, refuse: true, reason: 'toggle belongs to a form' };
        if (btn.closest('[class*="submit" i]')) {
          return { ok: false, refuse: true, reason: 'toggle is part of a submit control' };
        }
        return { ok: true, name };
      },
      { sel: groupSelector, text: optionText },
    );
    if (!check.ok) {
      if ('refuse' in check && check.refuse)
        throw new SubmitRefusedError(`chooseToggle: ${check.reason}`);
      return false;
    }
    if (isSubmitLikeText(check.name ?? '')) {
      throw new SubmitRefusedError(`chooseToggle refused a submit-like option ("${check.name}")`);
    }
    const pressed = await this.page.evaluate(
      ({ sel, text }) => {
        const group = document.querySelector(sel);
        if (!group) return false;
        const want = text.trim().toLowerCase();
        const btn = Array.from(group.querySelectorAll(':scope > button[aria-pressed]')).find(
          (b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase() === want,
        );
        if (!btn) return false;
        const block = (e: Event) => {
          e.preventDefault();
          e.stopImmediatePropagation();
        };
        document.addEventListener('submit', block, true);
        try {
          for (const t of ['mousedown', 'mouseup', 'click']) {
            btn.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }));
          }
        } finally {
          document.removeEventListener('submit', block, true);
        }
        return true;
      },
      { sel: groupSelector, text: optionText },
    );
    if (!pressed) return false;
    // React applies aria-pressed after the event returns, not during it.
    const want = (check.name ?? '').toLowerCase();
    return this.pollUntil(
      async () => (await this.toggleValue(groupSelector)).toLowerCase() === want,
    );
  }

  private async pollUntil(test: () => Promise<boolean>, timeoutMs = 2000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await test()) return true;
      if (Date.now() >= deadline) return false;
      await this.page.waitForTimeout(100);
    }
  }

  /**
   * Select one radio button. Only an `input[type=radio]` is accepted: a radio
   * cannot submit a form, and selecting it is how a single-choice question is
   * answered (custom-styled radios are often hidden, so `check` cannot reach
   * them). Callers never pass consent or EEO groups (field-map / fill filter
   * those). Returns whether the radio is now checked.
   */
  async chooseRadio(selector: string): Promise<boolean> {
    const result = await this.page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!(el instanceof HTMLInputElement) || el.type !== 'radio') return 'not-radio';
      if (!el.checked) el.click();
      return 'clicked';
    }, selector);
    if (result === 'not-radio') {
      throw new SubmitRefusedError(`chooseRadio refused a non-radio element (${selector})`);
    }
    return this.pollUntil(() =>
      this.page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return el instanceof HTMLInputElement && el.checked;
      }, selector),
    );
  }

  /** Read which toggle in a group is pressed (its text), or '' if none. */
  async toggleValue(groupSelector: string): Promise<string> {
    return this.page.evaluate((sel) => {
      const group = document.querySelector(sel);
      const pressed = group?.querySelector(':scope > button[aria-pressed="true"]');
      return (pressed?.textContent ?? '').replace(/\s+/g, ' ').trim();
    }, groupSelector);
  }

  // --- Typeahead comboboxes, non-submitting ------------------------------------

  /**
   * Type `query` into a typeahead combobox (with `fill`, never key presses) and
   * return the suggestions it shows, tagged for `chooseComboboxOption`. Options
   * are read from the listbox the input controls (`aria-controls`/`aria-owns`),
   * else the field's own react-select menu, else any visible option. Greenhouse
   * runs the search on input but keeps its menu closed until the control is
   * clicked (a bare mousedown is not enough), so a closed react-select control
   * is opened the way `openComboboxOptions` opens it. Returns `[]` if nothing
   * shows within the wait.
   */
  async typeaheadOptions(
    comboSelector: string,
    query: string,
    waitMs = 4000,
  ): Promise<{ text: string; tag: string }[]> {
    await this.page.fill(comboSelector, query);
    const deadline = Date.now() + waitMs;
    let opened = false;
    while (Date.now() < deadline) {
      const options = await this.page.evaluate((sel) => {
        const deep = (node: ParentNode, match: string): Element | null => {
          const hit = node.querySelector(match);
          if (hit) return hit;
          for (const el of Array.from(node.querySelectorAll('*'))) {
            if (!el.shadowRoot) continue;
            const found = deep(el.shadowRoot, match);
            if (found) return found;
          }
          return null;
        };
        const input = deep(document, sel);
        if (!input) return [] as { text: string; tag: string }[];
        const ids =
          `${input.getAttribute('aria-controls') ?? ''} ${input.getAttribute('aria-owns') ?? ''}`
            .split(/\s+/)
            .filter(Boolean);
        let nodes: Element[] = [];
        for (const id of ids) {
          const esc = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id;
          const box = document.getElementById(id) ?? deep(document, `#${esc}`);
          if (!box) continue;
          const options = Array.from(box.querySelectorAll('[role="option"]'));
          nodes.push(
            ...(options.length > 0
              ? options
              : Array.from(box.querySelectorAll('*')).filter((n) => {
                  const text = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
                  return text.length > 0 && text.length < 80 && n.children.length === 0;
                })),
          );
        }
        if (nodes.length === 0) {
          const container = input.closest('.select__container, .select-shell, .select');
          if (container)
            nodes = Array.from(container.querySelectorAll('[role="option"], .select__option'));
        }
        if (nodes.length === 0) {
          nodes = Array.from(document.querySelectorAll('[role="listbox"] [role="option"]')).filter(
            (n) => (n as HTMLElement).getClientRects().length > 0,
          );
        }
        const tidy = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
        return nodes
          .filter((n) => !/^(loading|no options|no results)/i.test(tidy(n.textContent)))
          .map((n, i) => {
            n.setAttribute('data-jobhacker-opt', `t${i}`);
            return { text: tidy(n.textContent), tag: `[data-jobhacker-opt="t${i}"]` };
          });
      }, comboSelector);
      if (options.length > 0) return options;
      if (!opened) {
        opened = true;
        await this.page.waitForTimeout(300);
        await this.page.evaluate((sel) => {
          const deep = (node: ParentNode, match: string): Element | null => {
            const hit = node.querySelector(match);
            if (hit) return hit;
            for (const el of Array.from(node.querySelectorAll('*'))) {
              if (!el.shadowRoot) continue;
              const found = deep(el.shadowRoot, match);
              if (found) return found;
            }
            return null;
          };
          const input = deep(document, sel);
          if (!input || input.getAttribute('aria-expanded') === 'true') return;
          const control = input
            .closest('.select__container, .select-shell, .select')
            ?.querySelector('.select__control');
          if (!control) return;
          for (const t of ['mousedown', 'mouseup', 'click']) {
            control.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }));
          }
        }, comboSelector);
      }
      await this.page.waitForTimeout(150);
    }
    return [];
  }

  /**
   * Open the react-select control at `comboSelector` and return its rendered
   * options, each tagged with a selector the caller can pass to
   * `chooseComboboxOption`. Returns `[]` if it does not open or has no options
   * (e.g. a typeahead that needs typing first).
   */
  async openComboboxOptions(comboSelector: string): Promise<{ text: string; tag: string }[]> {
    const opened = await this.page.evaluate((sel) => {
      const deep = (node: ParentNode, match: string): Element | null => {
        const hit = node.querySelector(match);
        if (hit) return hit;
        for (const el of Array.from(node.querySelectorAll('*'))) {
          if (!el.shadowRoot) continue;
          const found = deep(el.shadowRoot, match);
          if (found) return found;
        }
        return null;
      };
      const combo = deep(document, sel);
      if (!combo) return false;
      const container =
        combo.closest('.select__container, .select-shell, .select, .field, fieldset') ??
        combo.parentElement;
      const control = container?.querySelector('.select__control') ?? (combo as HTMLElement);
      (control as HTMLElement).scrollIntoView({ block: 'center' });
      for (const t of ['mousedown', 'mouseup', 'click']) {
        control.dispatchEvent(new MouseEvent(t, { bubbles: true }));
      }
      return true;
    }, comboSelector);
    if (!opened) return [];

    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      const options = await this.page.evaluate((sel) => {
        const deep = (node: ParentNode, match: string): Element | null => {
          const hit = node.querySelector(match);
          if (hit) return hit;
          for (const el of Array.from(node.querySelectorAll('*'))) {
            if (!el.shadowRoot) continue;
            const found = deep(el.shadowRoot, match);
            if (found) return found;
          }
          return null;
        };
        const combo = deep(document, sel);
        if (!combo) return [] as { text: string; tag: string }[];
        const container = combo.closest(
          '.select__container, .select-shell, .select, .field, fieldset',
        );
        let nodes = container
          ? Array.from(container.querySelectorAll('[role="option"], .select__option'))
          : [];
        if (nodes.length === 0) {
          // Menu rendered in a portal (outside the container): take visible options.
          nodes = Array.from(document.querySelectorAll('[role="option"], .select__option')).filter(
            (o) => (o as HTMLElement).getClientRects().length > 0,
          );
        }
        return nodes.map((o, i) => {
          o.setAttribute('data-jobhacker-opt', String(i));
          return {
            text: (o.textContent ?? '').replace(/\s+/g, ' ').trim(),
            tag: `[data-jobhacker-opt="${i}"]`,
          };
        });
      }, comboSelector);
      if (options.length > 0) return options;
      await this.page.waitForTimeout(100);
    }
    return [];
  }

  /** Click a react-select option by its tag, refusing any submit-like option. */
  async chooseComboboxOption(tag: string): Promise<void> {
    const name = await this.page.evaluate((sel) => {
      const deep = (node: ParentNode, match: string): Element | null => {
        const hit = node.querySelector(match);
        if (hit) return hit;
        for (const el of Array.from(node.querySelectorAll('*'))) {
          if (!el.shadowRoot) continue;
          const found = deep(el.shadowRoot, match);
          if (found) return found;
        }
        return null;
      };
      const el = deep(document, sel);
      if (!el) return null;
      return ((el as HTMLElement).getAttribute('aria-label') ?? el.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    }, tag);
    if (name === null) throw new Error(`chooseComboboxOption: no element matches ${tag}`);
    if (isSubmitLikeText(name)) {
      throw new SubmitRefusedError(`refused a submit-like option ("${name}")`);
    }
    await this.page.evaluate((sel) => {
      const deep = (node: ParentNode, match: string): Element | null => {
        const hit = node.querySelector(match);
        if (hit) return hit;
        for (const el of Array.from(node.querySelectorAll('*'))) {
          if (!el.shadowRoot) continue;
          const found = deep(el.shadowRoot, match);
          if (found) return found;
        }
        return null;
      };
      const opt = deep(document, sel);
      if (!opt) return;
      for (const t of ['mousedown', 'mouseup', 'click']) {
        opt.dispatchEvent(new MouseEvent(t, { bubbles: true }));
      }
    }, tag);
  }

  // --- SmartRecruiters-style widgets (autocomplete, phone, entries, wizard) --
  //
  // These drive the `spl-*` custom elements on Easy Apply–style pages. An
  // autocomplete input does not commit typed text until its menu option is
  // chosen (blur clears it); the phone widget carries its own country select;
  // experience/education entries are added and Saved one at a time (Save/Add
  // are not Submit, and `clickLabeledButton` refuses submit-like labels); the
  // wizard's Next is allowed only under the same refusal. Nothing here can
  // submit: there is still no method that clicks a submit/apply/send control.

  /** Blur whatever has focus (widgets often revalidate only on blur). */
  async blurActive(): Promise<void> {
    await this.page.evaluate(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body) active.blur();
    });
  }

  /** The page's visible text (read-only; used to spot saved entries/errors). */
  async readBodyText(): Promise<string> {
    return this.page.evaluate(() => document.body.innerText ?? '');
  }

  /** Aria labels of saved-entry Edit buttons, e.g. "Edit experience …". */
  async savedEntryLabels(): Promise<string[]> {
    return this.page.evaluate(() => {
      const deep = (root: ParentNode, out: Element[] = []): Element[] => {
        for (const el of Array.from(root.querySelectorAll('*'))) {
          out.push(el);
          if (el.shadowRoot) deep(el.shadowRoot, out);
        }
        return out;
      };
      return deep(document)
        .map((el) => el.getAttribute?.('aria-label') ?? '')
        .filter((label) => /^Edit (experience|education)\b/.test(label));
    });
  }

  /** Visible site validation messages ("Please provide a valid phone number", …). */
  async validationMessages(): Promise<string[]> {
    return this.page.evaluate(() => {
      const tidy = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
      const deep = (root: ParentNode, out: Element[] = []): Element[] => {
        for (const el of Array.from(root.querySelectorAll('*'))) {
          out.push(el);
          if (el.shadowRoot) deep(el.shadowRoot, out);
        }
        return out;
      };
      const messages: string[] = [];
      for (const el of deep(document)) {
        const role = el.getAttribute?.('role') ?? '';
        const slot = el.getAttribute?.('slot') ?? '';
        const cls = String(el.className ?? '');
        const isError =
          role === 'alert' ||
          slot === 'error-msg' ||
          (/error/i.test(cls) && el.children.length < 3);
        if (!isError) continue;
        const text = tidy(el.textContent);
        if (
          text.length >= 3 &&
          text.length <= 200 &&
          /please|valid|required|cannot|must|invalid/i.test(text) &&
          !messages.includes(text)
        ) {
          messages.push(text);
        }
      }
      return messages;
    });
  }

  /**
   * Click a button (native or `spl-button`) whose visible text is exactly
   * `text`, optionally disambiguated by an aria-label substring. Goes through
   * `safeClick`, so a submit-like label is refused. Returns false when no
   * such button is on the page.
   */
  async clickLabeledButton(text: string, ariaIncludes?: string): Promise<boolean> {
    if (isSubmitLikeText(text)) {
      throw new SubmitRefusedError(`clickLabeledButton refused a submit-like label ("${text}")`);
    }
    const tagged = await this.page.evaluate(
      ({ want, aria }) => {
        const tidy = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
        const deep = (root: ParentNode, out: Element[] = []): Element[] => {
          for (const el of Array.from(root.querySelectorAll('*'))) {
            out.push(el);
            if (el.shadowRoot) deep(el.shadowRoot, out);
          }
          return out;
        };
        const candidates = deep(document).filter((el) => {
          if (el.tagName !== 'BUTTON' && el.tagName !== 'SPL-BUTTON') return false;
          if ((el as HTMLElement).getClientRects().length === 0) return false;
          if (aria) return (el.getAttribute?.('aria-label') ?? '').includes(aria);
          return tidy(el.textContent) === want;
        });
        const target = candidates[0];
        if (!target) return false;
        target.setAttribute('data-jobhacker-action', 'target');
        return true;
      },
      { want: text, aria: ariaIncludes ?? null },
    );
    if (!tagged) return false;
    await this.safeClick('[data-jobhacker-action="target"]');
    await this.page
      .evaluate(() =>
        document
          .querySelector('[data-jobhacker-action="target"]')
          ?.removeAttribute('data-jobhacker-action'),
      )
      .catch(() => undefined);
    return true;
  }

  /** Check an entry editor's checkbox input (e.g. "I currently work here"). */
  async checkEntryCheckbox(selector: string): Promise<boolean> {
    const isCheckbox = await this.page.evaluate((sel) => {
      const match = sel.match(/data-jobhacker-field="([^"]+)"/);
      const deep = (root: ParentNode, out: Element[] = []): Element[] => {
        for (const el of Array.from(root.querySelectorAll('*'))) {
          out.push(el);
          if (el.shadowRoot) deep(el.shadowRoot, out);
        }
        return out;
      };
      const el = match
        ? deep(document).find((e) => e.getAttribute?.('data-jobhacker-field') === match[1])
        : document.querySelector(sel);
      return el instanceof HTMLInputElement && el.type === 'checkbox';
    }, selector);
    if (!isCheckbox) {
      throw new SubmitRefusedError(`checkEntryCheckbox refused a non-checkbox (${selector})`);
    }
    await this.page.locator(selector).check({ force: true });
    return this.isChecked(selector).catch(() => false);
  }

  /**
   * Commit an autocomplete field: type `desired`, then choose the menu option
   * that matches it (the free-text custom option, an exact option, or — with
   * `locationMatch` — the expanded location option, e.g. "Phoenix, AZ, US"
   * for "Phoenix, AZ"). Returns whether the field now holds a chosen value.
   */
  async fillAutocomplete(
    selector: string,
    desired: string,
    opts: { locationMatch?: boolean } = {},
  ): Promise<boolean> {
    // First try a plain fill; some menus only search on real keystrokes, so
    // fall back to typing when the fill path does not commit a chosen option.
    if (await this.tryAutocomplete(selector, desired, opts, false)) return true;
    if (await this.tryAutocomplete(selector, desired, opts, true)) return true;
    await this.page.keyboard.press('Escape').catch(() => undefined);
    await this.page.fill(selector, '').catch(() => undefined);
    return false;
  }

  private async tryAutocomplete(
    selector: string,
    desired: string,
    opts: { locationMatch?: boolean },
    useKeyboard: boolean,
  ): Promise<boolean> {
    const input = this.page.locator(selector);
    await input.click();
    // Clear any existing (uncommitted) text first: a fill/type into a field
    // that already holds text can append instead of replacing in these
    // widgets, which would commit a doubled value.
    await this.page.keyboard.press('Control+a');
    await this.page.keyboard.press('Backspace');
    if (useKeyboard) {
      await this.page.keyboard.type(desired, { delay: 10 });
    } else {
      await this.page.fill(selector, desired);
    }
    const menuId = await this.autocompleteMenuId(selector);
    if (!menuId) return false;
    const options = await this.pollAutocompleteOptions(menuId);
    const want = desired.replace(/\s+/g, ' ').trim().toLowerCase();
    // Preference order: the option whose text is the desired value; an option
    // whose stored value is (the menu shows "Contoso Software Publishers"
    // but commits "Contoso"); the free-text custom option; then an option
    // that starts with the desired text ("Never employed or contracted …").
    let exact: { text: string; index: number } | undefined;
    let byValue: { text: string; index: number } | undefined;
    let custom: { text: string; index: number } | undefined;
    let prefix: { text: string; index: number } | undefined;
    for (const option of options) {
      const text = option.text.replace(/\s+/g, ' ').trim();
      const lower = text.toLowerCase();
      if (lower === want) exact ??= { text, index: option.index };
      if (option.value?.toLowerCase() === want) byValue ??= { text, index: option.index };
      if (option.value === '#spl-custom-option') custom ??= { text, index: option.index };
      if (lower.startsWith(want)) prefix ??= { text, index: option.index };
    }
    let chosen = exact ?? byValue ?? custom ?? prefix;
    if (!chosen && opts.locationMatch) {
      for (const option of options) {
        const text = option.text.replace(/\s+/g, ' ').trim();
        if (text.toLowerCase().startsWith(`${want},`)) {
          chosen = { text, index: option.index };
          break;
        }
      }
    }
    if (!chosen) return false;
    const clicked = await this.page
      .locator(`#${menuId} spl-select-option`)
      .nth(chosen.index)
      .click({ timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (!clicked) return false;
    await this.settle(600);
    const shown = (await this.inputValue(selector)).replace(/\s+/g, ' ').trim();
    return (
      shown.length > 0 &&
      (shown.toLowerCase() === want ||
        shown.toLowerCase() === chosen.text.toLowerCase() ||
        chosen.text.toLowerCase().startsWith(shown.toLowerCase()))
    );
  }

  private async autocompleteMenuId(selector: string): Promise<string | null> {
    return this.page.evaluate((sel) => {
      const match = sel.match(/data-jobhacker-field="([^"]+)"/);
      const deep = (root: ParentNode, out: Element[] = []): Element[] => {
        for (const el of Array.from(root.querySelectorAll('*'))) {
          out.push(el);
          if (el.shadowRoot) deep(el.shadowRoot, out);
        }
        return out;
      };
      const el = match
        ? deep(document).find((e) => e.getAttribute?.('data-jobhacker-field') === match[1])
        : document.querySelector(sel);
      if (!el) return null;
      const host =
        el.getRootNode() instanceof ShadowRoot ? (el.getRootNode() as ShadowRoot).host : el;
      return (
        host.getAttribute('ariacontrols') ??
        host.getAttribute('aria-controls') ??
        el.getAttribute('aria-controls') ??
        (host.id ? `menu-${host.id}` : null)
      );
    }, selector);
  }

  private async pollAutocompleteOptions(
    menuId: string,
    timeoutMs = 3000,
  ): Promise<{ text: string; value: string | null; index: number }[]> {
    const locator = this.page.locator(`#${menuId} spl-select-option`);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const count = await locator.count().catch(() => 0);
      if (count > 0) {
        const options: { text: string; value: string | null; index: number }[] = [];
        for (let i = 0; i < count; i++) {
          const nth = locator.nth(i);
          options.push({
            text: (await nth.innerText().catch(() => '')).replace(/\s+/g, ' ').trim(),
            value: await nth.getAttribute('value').catch(() => null),
            index: i,
          });
        }
        return options.filter((o) => o.text.length > 0);
      }
      await this.page.waitForTimeout(150);
    }
    return [];
  }

  /**
   * Set a `spl-phone-field` widget's country (its own select, searched by
   * country name, chosen by ISO code) before the national number is typed.
   * Returns false when the page has no such widget.
   */
  async setPhoneCountry(countryName: string, iso: string): Promise<boolean> {
    const exists = await this.page.evaluate(() => {
      const deep = (root: ParentNode, out: Element[] = []): Element[] => {
        for (const el of Array.from(root.querySelectorAll('*'))) {
          out.push(el);
          if (el.shadowRoot) deep(el.shadowRoot, out);
        }
        return out;
      };
      return deep(document).some((el) => el.tagName === 'SPL-PHONE-FIELD');
    });
    if (!exists) return false;
    const current = await this.phoneCountryValue();
    if (current === iso) return true;
    await this.page.locator('spl-phone-field button').first().click();
    await this.page.locator('spl-dropdown-search input').first().fill(countryName);
    await this.page.waitForTimeout(400);
    await this.page.locator(`spl-select-option[value="${iso}"]`).first().click({ timeout: 5000 });
    return this.pollUntil(async () => (await this.phoneCountryValue()) === iso, 3000);
  }

  private async phoneCountryValue(): Promise<string | null> {
    return this.page.evaluate(() => {
      const deep = (root: ParentNode, out: Element[] = []): Element[] => {
        for (const el of Array.from(root.querySelectorAll('*'))) {
          out.push(el);
          if (el.shadowRoot) deep(el.shadowRoot, out);
        }
        return out;
      };
      const select = deep(document).find((el) => el.tagName === 'SPL-SELECT');
      return select?.getAttribute('value') ?? null;
    });
  }

  /**
   * The phone widget's own validation error for the field at `selector`, or
   * null when it is valid (or not a phone widget). Polls briefly: the widget
   * revalidates after the country/number changes.
   */
  async phoneValidationError(selector: string): Promise<string | null> {
    const read = async (): Promise<string | null> =>
      this.page.evaluate((sel) => {
        const tidy = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
        const match = sel.match(/data-jobhacker-field="([^"]+)"/);
        const deep = (root: ParentNode, out: Element[] = []): Element[] => {
          for (const el of Array.from(root.querySelectorAll('*'))) {
            out.push(el);
            if (el.shadowRoot) deep(el.shadowRoot, out);
          }
          return out;
        };
        const el = match
          ? deep(document).find((e) => e.getAttribute?.('data-jobhacker-field') === match[1])
          : document.querySelector(sel);
        if (!el) return null;
        let host: Element | null =
          el.getRootNode() instanceof ShadowRoot ? (el.getRootNode() as ShadowRoot).host : el;
        while (host && host.tagName !== 'SPL-PHONE-FIELD') {
          host =
            host.parentElement ??
            (host.getRootNode() instanceof ShadowRoot
              ? (host.getRootNode() as ShadowRoot).host
              : null);
        }
        if (!host) return null;
        const invalid =
          /ng-invalid/.test(String(host.className)) || el.getAttribute('aria-invalid') === 'true';
        if (!invalid) return null;
        const text = tidy(host.shadowRoot?.textContent);
        const message = text.match(/[^.]*?(valid phone number|phone number is required)[^.]*\.?/i);
        return message ? tidy(message[0]) : 'the phone number is not valid for its country';
      }, selector);
    let error = await read();
    const deadline = Date.now() + 4000;
    while (error && Date.now() < deadline) {
      await this.page.waitForTimeout(200);
      error = await read();
    }
    return error;
  }

  /**
   * Set a month-year date field (`spl-date-picker` / flatpickr month select):
   * open it, step the year with the calendar's own prev/next-year controls,
   * then pick the month. Returns whether the input now holds `expected`
   * ("MM/YYYY").
   */
  async fillMonthYear(
    selector: string,
    monthAbbrev: string,
    year: number,
    expected: string,
  ): Promise<boolean> {
    const input = this.page.locator(selector);
    await input.click();
    const calendar = this.page.locator('.flatpickr-calendar.open');
    const yearInput = calendar.locator('input.cur-year').first();
    await yearInput.waitFor({ state: 'visible', timeout: 4000 }).catch(() => undefined);
    let current = Number.parseInt((await yearInput.inputValue().catch(() => '')) || '', 10);
    if (!Number.isFinite(current)) return false;
    let guard = 0;
    while (current !== year && guard < 80) {
      const button = calendar
        .locator(current > year ? '.flatpickr-prev-month' : '.flatpickr-next-month')
        .first();
      await button.click();
      await this.page.waitForTimeout(60);
      const next = Number.parseInt((await yearInput.inputValue().catch(() => '')) || '', 10);
      if (!Number.isFinite(next) || next === current) break;
      current = next;
      guard++;
    }
    if (current !== year) return false;
    await calendar
      .locator('.flatpickr-monthSelect-month', { hasText: new RegExp(`^${monthAbbrev}$`) })
      .first()
      .click();
    await this.page.waitForTimeout(300);
    return (await input.inputValue().catch(() => '')) === expected;
  }

  /** Read the value currently shown in a react-select control. */
  async comboboxValue(comboSelector: string): Promise<string> {
    return this.page.evaluate((sel) => {
      const deep = (node: ParentNode, match: string): Element | null => {
        const hit = node.querySelector(match);
        if (hit) return hit;
        for (const el of Array.from(node.querySelectorAll('*'))) {
          if (!el.shadowRoot) continue;
          const found = deep(el.shadowRoot, match);
          if (found) return found;
        }
        return null;
      };
      const combo = deep(document, sel);
      if (!combo) return '';
      const container =
        combo.closest('.select__container, .select-shell, .select, .field, fieldset') ??
        combo.parentElement;
      const single = container?.querySelector('.select__single-value, .select__multi-value__label');
      if (single) return (single.textContent ?? '').replace(/\s+/g, ' ').trim();
      const valueContainer = container?.querySelector('.select__value-container');
      if (valueContainer) return (valueContainer.textContent ?? '').replace(/\s+/g, ' ').trim();
      return '';
    }, comboSelector);
  }
}
