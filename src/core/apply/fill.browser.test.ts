import { mkdtempSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, type Page, chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Profile } from '../config/schemas.js';
import { ashbyAdapter } from './adapters/ashby.js';
import { genericAdapter } from './adapters/generic.js';
import { greenhouseAdapter } from './adapters/greenhouse.js';
import { leverAdapter } from './adapters/lever.js';
import { resolveChrome } from './browser.js';
import { fillForm } from './fill.js';
import { SafePage, SubmitRefusedError } from './safe-page.js';
import type { FormAdapter, OpenQuestion } from './types.js';

/**
 * Acceptance #1 (ARCHITECTURE § Testing strategy): run the fill logic against
 * saved application-form HTML in a real headless Chrome, and assert what gets
 * filled, that EEO fields are untouched, and that NOTHING is submitted — a
 * page-level submit counter (plus an override of `HTMLFormElement.submit`) must
 * stay 0. These fixtures are hand-written representatives of Greenhouse/Lever
 * markup (we have no live form to scrape); the live run on real postings is
 * acceptance #3, in Kris's Chrome.
 *
 * The suite needs a system Chrome (D18). Without one it is skipped so `pnpm
 * check` stays green on a Chrome-less machine; on Kris's Mac it runs for real.
 */

const chromePath = resolveChrome();
const d = chromePath ? describe : describe.skip;

const FIXTURES = join(process.cwd(), 'tests/fixtures/forms');

const PROFILE: Profile = {
  contact: {
    name: 'Kris Tester',
    email: 'kris@example.com',
    phone: '+1 555 555 5555',
    location: 'Scottsdale, AZ',
  },
  links: {
    linkedin: 'https://linkedin.com/in/kris',
    github: 'https://github.com/kris',
    portfolio: 'https://kris.example',
  },
  summary: 'Senior engineer.',
  skills: { frontend: ['React'] },
  experience: [],
  projects: [],
  education: [],
  standard_answers: {},
};

const ANSWERS: Record<string, string> = {
  work_authorization_us: 'Yes',
  require_sponsorship: 'No',
  willing_to_relocate: 'No',
  salary_expectation: '[NEEDS INPUT]',
  how_did_you_hear: 'Company careers page',
};

d('fillForm against saved forms (headless Chrome)', { timeout: 60_000 }, () => {
  let browser: Browser;
  let resumePath: string;

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: chromePath, headless: true });
    const dir = mkdtempSync(join(tmpdir(), 'jobhacker-apply-'));
    resumePath = join(dir, 'resume.pdf');
    writeFileSync(resumePath, '%PDF-1.4\n% test resume\n');
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  async function openFixture(file: string): Promise<Page> {
    const html = readFileSync(join(FIXTURES, file), 'utf8');
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    // Count any submission attempt and block it, so "submit counter === 0" is real.
    await page.evaluate(() => {
      const w = window as unknown as { __submits?: number };
      w.__submits = 0;
      document.addEventListener(
        'submit',
        (e) => {
          e.preventDefault();
          w.__submits = (w.__submits ?? 0) + 1;
        },
        true,
      );
      HTMLFormElement.prototype.submit = () => {
        w.__submits = (w.__submits ?? 0) + 1;
      };
    });
    return page;
  }

  const submits = (page: Page) =>
    page.evaluate(() => (window as unknown as { __submits?: number }).__submits ?? 0);
  const selectValue = (page: Page, sel: string) =>
    page.$eval(sel, (el) => (el as HTMLSelectElement).value);
  const outline = (page: Page, sel: string) =>
    page.$eval(sel, (el) => (el as HTMLElement).style.outline);

  async function fill(file: string, adapter: FormAdapter, url: string) {
    const page = await openFixture(file);
    const report = await fillForm(
      new SafePage(page),
      adapter,
      { profile: PROFILE, answers: ANSWERS, resumePdfPath: resumePath },
      url,
    );
    return { page, report };
  }

  it('greenhouse — basic contact fields, resume, self-id decline selected', async () => {
    const { page, report } = await fill(
      'greenhouse-basic.html',
      greenhouseAdapter,
      'https://boards.greenhouse.io/acme/jobs/1',
    );

    expect(await page.inputValue('#first_name')).toBe('Kris');
    expect(await page.inputValue('#last_name')).toBe('Tester');
    expect(await page.inputValue('#email')).toBe('kris@example.com');
    expect(await page.inputValue('#phone')).toBe('+1 555 555 5555');

    expect(report.resumeAttached).toBe(true);
    expect(await page.$eval('#resume', (el) => (el as HTMLInputElement).files?.length ?? 0)).toBe(
      1,
    );

    // The free-text "why" question has no prepared answer: unfilled + outlined.
    expect(report.unfilled.some((u) => /Why do you want to work/.test(u.field) && u.required)).toBe(
      true,
    );
    expect(await outline(page, '#why')).not.toBe('');

    // Self-id (invariant 7, D66): no configured answer → the form's decline
    // option is selected. Veteran Status has no decline option, so it stays
    // blank and is listed as needing Kris.
    expect(await selectValue(page, '#gender')).toBe('decline');
    expect(await selectValue(page, '#race')).toBe('decline');
    expect(await selectValue(page, '#veteran')).toBe('');
    expect(report.self_identification).toEqual(
      expect.arrayContaining([
        { field: 'Gender', value: 'Decline to self identify' },
        { field: 'Race / Ethnicity', value: 'Decline to self identify' },
      ]),
    );
    expect(report.skipped_eeo).toEqual(['Veteran Status']);

    expect(await submits(page)).toBe(0);
    await page.close();
  });

  it('self-identification — a configured answer in profile.yaml is selected verbatim', async () => {
    const page = await openFixture('greenhouse-basic.html');
    const report = await fillForm(
      new SafePage(page),
      greenhouseAdapter,
      {
        profile: {
          ...PROFILE,
          self_identification: {
            gender: 'Female',
            race_ethnicity: 'decline',
            veteran_status: 'decline',
            disability_status: 'decline',
            overrides: {},
          },
        },
        answers: ANSWERS,
        resumePdfPath: resumePath,
      },
      'https://boards.greenhouse.io/acme/jobs/1',
    );
    expect(await selectValue(page, '#gender')).toBe('female');
    expect(report.self_identification).toContainEqual({ field: 'Gender', value: 'Female' });
    expect(await submits(page)).toBe(0);
    await page.close();
  });

  it('greenhouse — custom questions matched to prepared answers', async () => {
    const { page, report } = await fill(
      'greenhouse-custom.html',
      greenhouseAdapter,
      'https://boards.greenhouse.io/acme/jobs/2',
    );

    expect(await page.inputValue('#first_name')).toBe('Kris');
    expect(await page.inputValue('#linkedin')).toBe('https://linkedin.com/in/kris');
    expect(report.resumeAttached).toBe(true);

    // Custom questions filled from answers.
    expect(await selectValue(page, '#work_auth')).toBe('Yes');
    expect(await selectValue(page, '#sponsorship')).toBe('No');
    expect(await page.inputValue('#hear')).toBe('Company careers page');

    // Required unmatched question is unfilled and outlined.
    expect(report.unfilled.some((u) => /Describe a project/.test(u.field) && u.required)).toBe(
      true,
    );
    expect(await outline(page, '#project')).not.toBe('');

    // Self-id: none of these selects offers a decline option, and "No, I do
    // not have a disability" is a disclosure Kris has not configured — all
    // stay blank and are listed as needing him.
    for (const sel of ['#gender', '#hispanic', '#disability']) {
      expect(await selectValue(page, sel)).toBe('');
    }
    expect(report.self_identification).toEqual([]);
    expect(report.skipped_eeo).toEqual(
      expect.arrayContaining(['Gender', 'Are you Hispanic or Latino?', 'Disability Status']),
    );

    expect(await submits(page)).toBe(0);
    await page.close();
  });

  it('lever — single full-name field, resume, self-id blank (no decline option)', async () => {
    const { page, report } = await fill(
      'lever-basic.html',
      leverAdapter,
      'https://jobs.lever.co/globex/1',
    );

    expect(await page.inputValue('#name')).toBe('Kris Tester');
    expect(await page.inputValue('#email')).toBe('kris@example.com');
    expect(await page.inputValue('#phone')).toBe('+1 555 555 5555');
    expect(await page.inputValue('#linkedin')).toBe('https://linkedin.com/in/kris');
    expect(report.resumeAttached).toBe(true);

    // "Current company" is not mapped.
    expect(report.unfilled.some((u) => /Current company/.test(u.field))).toBe(true);

    for (const sel of ['#gender', '#race']) {
      expect(await selectValue(page, sel)).toBe('');
    }
    expect(report.skipped_eeo).toEqual(expect.arrayContaining(['Gender', 'Race']));

    expect(await submits(page)).toBe(0);
    await page.close();
  });

  it('lever — custom cards; NEEDS INPUT answer left unfilled', async () => {
    const { page, report } = await fill(
      'lever-custom.html',
      leverAdapter,
      'https://jobs.lever.co/globex/2',
    );

    expect(await page.inputValue('#name')).toBe('Kris Tester');
    expect(report.resumeAttached).toBe(true);

    // Relocation matched; salary left empty because the answer is NEEDS INPUT.
    expect(await selectValue(page, '#relocate')).toBe('No');
    expect(await page.inputValue('#salary')).toBe('');
    expect(report.unfilled.some((u) => /salary expectations/.test(u.field) && u.required)).toBe(
      true,
    );
    expect(await outline(page, '#salary')).not.toBe('');

    for (const sel of ['#gender', '#veteran']) {
      expect(await selectValue(page, sel)).toBe('');
    }
    expect(report.skipped_eeo).toEqual(expect.arrayContaining(['Gender', 'Veteran status']));

    expect(await submits(page)).toBe(0);
    await page.close();
  });

  it('greenhouse — react-select shape: resume id, comboboxes, hidden mirror', async () => {
    const { page, report } = await fill(
      'greenhouse-react.html',
      greenhouseAdapter,
      'https://job-boards.greenhouse.io/acme/jobs/3',
    );

    expect(await page.inputValue('#first_name')).toBe('Kris');
    expect(report.resumeAttached).toBe(true);
    expect(await page.$eval('#resume', (el) => (el as HTMLInputElement).files?.length ?? 0)).toBe(
      1,
    );
    // The cover-letter control is also labeled "Attach" and must not get the resume.
    expect(
      await page.$eval('#cover_letter', (el) => (el as HTMLInputElement).files?.length ?? 0),
    ).toBe(0);

    // Comboboxes are not typed into (react-select would drop the text).
    expect(await page.inputValue('#candidate-location')).toBe('');
    expect(await page.inputValue('#auth')).toBe('');
    expect(await outline(page, '#candidate-location')).not.toBe('');
    expect(await outline(page, '#auth')).not.toBe('');

    // A plain text question still fills. A "based in" question must not get the city.
    expect(await page.inputValue('#hear')).toBe('Company careers page');
    expect(await page.inputValue('#relocate')).not.toBe('Scottsdale, AZ');

    // Hidden required mirror stays out of the fill. The self-id select's only
    // option is Decline, which is selected from the (default) config.
    expect(await page.inputValue('#mirror')).toBe('');
    expect(report.unfilled.some((u) => u.field === '(unnamed field)')).toBe(false);
    expect(await selectValue(page, '#gender')).toBe('decline');
    expect(report.self_identification).toEqual([{ field: 'Gender', value: 'Decline' }]);

    // A required file that is not the resume is outlined via the ancestor aria-required.
    expect(report.unfilled.some((u) => u.field === 'Attach' && u.required)).toBe(true);
    expect(await outline(page, '#transcript')).not.toBe('');

    expect(await submits(page)).toBe(0);
    await page.close();
  });

  it('greenhouse — refills a value wiped by a re-render just after fill', async () => {
    // #first_name clears itself once during the fill's input event (a controlled
    // component rejecting the first change). The filler must detect the empty
    // value and refill it, and report it as filled — not falsely filled, nor
    // dropped. See STATUS Round 5 verify.
    const { page, report } = await fill(
      'greenhouse-rerender.html',
      greenhouseAdapter,
      'https://boards.greenhouse.io/acme/jobs/9',
    );

    expect(await page.inputValue('#first_name')).toBe('Kris');
    expect(await page.inputValue('#last_name')).toBe('Tester');
    expect(report.filled.some((f) => /First Name/.test(f.field))).toBe(true);
    expect(report.unfilled.some((u) => /First Name/.test(u.field))).toBe(false);

    expect(await submits(page)).toBe(0);
    await page.close();
  });

  it('greenhouse — drives a react-select screener, self-id react-select gets decline', async () => {
    // Round 5b: the work-authorization react-select is opened and set to the
    // mapped answer ("Yes"); the Gender react-select under the Voluntary
    // Self-Identification heading is driven only by self-id.ts to the
    // configured value (default decline, invariant 7/D66), never by the LLM.
    const { page, report } = await fill(
      'greenhouse-combobox.html',
      greenhouseAdapter,
      'https://boards.greenhouse.io/acme/jobs/10',
    );

    const single = (name: string) =>
      page.$eval(`.select__container[data-name="${name}"]`, (el) => {
        const sv = el.querySelector('.select__single-value');
        return sv ? (sv.textContent ?? '').trim() : '';
      });
    const hidden = (name: string) =>
      page.$eval(`input[name="${name}"]`, (el) => (el as HTMLInputElement).value);

    // Work authorization driven to the mapped answer.
    expect(await single('auth')).toBe('Yes');
    expect(await hidden('auth')).toBe('Yes');
    expect(report.filled.some((f) => /legally authorized to work/i.test(f.field))).toBe(true);

    // Self-id react-select set to the form's decline option, from config.
    expect(await single('gender')).toBe('Decline to self identify');
    expect(report.self_identification).toEqual([
      { field: 'Gender *', value: 'Decline to self identify' },
    ]);
    expect(report.skipped_eeo.some((s) => /gender/i.test(s))).toBe(false);

    expect(await submits(page)).toBe(0);
    await page.close();
  });

  const ASHBY_DRAFTS: Record<string, string> = {
    'Tell us more': 'I led the rebuild of our design system end to end, from audit to rollout.',
    'Are you based in a US or equivalent timezone?': 'Yes',
    'Are you comfortable completing a take-home assignment?':
      '[NEEDS INPUT: whether you will do a take-home]',
    'Which work arrangement do you prefer?': 'Remote',
  };

  it('ashby — fills profile fields, typeahead, toggles and drafted answers; never submits', async () => {
    const page = await openFixture('ashby-application.html');
    const asked: OpenQuestion[][] = [];
    const report = await fillForm(
      new SafePage(page),
      ashbyAdapter,
      {
        profile: PROFILE,
        answers: ANSWERS,
        resumePdfPath: resumePath,
        coverNote: 'Dear Acme team, I build interfaces people enjoy.',
        draftAnswers: async (questions) => {
          asked.push(questions);
          return ASHBY_DRAFTS;
        },
      },
      'https://jobs.ashbyhq.com/acme/1/application',
    );
    const pressed = (name: string) =>
      page.$eval(
        `input[name="${name}"]`,
        (el) =>
          el.parentElement?.querySelector('button[aria-pressed="true"]')?.textContent?.trim() ?? '',
      );
    const files = (sel: string) =>
      page.$eval(sel, (el) => (el as HTMLInputElement).files?.length ?? 0);
    const checked = (sel: string) => page.$eval(sel, (el) => (el as HTMLInputElement).checked);
    const locationInput = '.ashby-application-form-input-autocomplete';

    // Exactly the open questions go to the drafting step, once: not profile
    // fields, not EEO (Pronouns, survey), not the SMS-consent radios.
    expect(asked).toHaveLength(1);
    expect(asked[0]?.map((q) => [q.label, q.kind])).toEqual([
      ['Are you based in a US or equivalent timezone?', 'choice'],
      ['Are you comfortable completing a take-home assignment?', 'choice'],
      ['Tell us more', 'textarea'],
      ['Which work arrangement do you prefer?', 'choice'],
    ]);
    expect(asked[0]?.find((q) => q.label === 'Tell us more')?.hint).toMatch(/complex project/);
    expect(asked[0]?.find((q) => q.label.startsWith('Which work'))?.options).toEqual([
      'Remote',
      'Hybrid',
      'Onsite',
    ]);

    // Profile fields, including the id-less Location typeahead and derived values.
    expect(await page.inputValue('#_systemfield_name')).toBe('Kris Tester');
    expect(await page.inputValue('#_systemfield_email')).toBe('kris@example.com');
    expect(await page.inputValue(locationInput)).toBe('Scottsdale, Arizona, United States');
    expect(await page.inputValue('#github')).toBe('kris');
    expect(await page.inputValue('#country')).toBe('United States');
    expect(await page.inputValue('#cover')).toMatch(/^Dear Acme team/);

    // Resume goes to the resume field, never the autofill uploader.
    expect(report.resumeAttached).toBe(true);
    expect(await files('#_systemfield_resume')).toBe(1);
    expect(await files('#autofill')).toBe(0);

    // Drafted answers are filled and outlined in amber for review.
    expect(await page.inputValue('#essay')).toMatch(/design system/);
    expect(await pressed('question_1')).toBe('Yes');
    expect(await checked('#arr-0')).toBe(true);
    expect(report.filled.filter((f) => f.via === 'draft').map((f) => f.field)).toEqual(
      expect.arrayContaining([
        'Tell us more',
        'Are you based in a US or equivalent timezone?',
        'Which work arrangement do you prefer?',
      ]),
    );
    expect(await outline(page, '#essay')).toContain('245, 158, 11');

    // A NEEDS INPUT draft is not filled: required, outlined red, reason given.
    expect(await pressed('question_2')).toBe('');
    const takeHome = report.unfilled.find((u) => /take-home/.test(u.field));
    expect(takeHome).toMatchObject({ required: true });
    expect(takeHome?.reason).toMatch(/NEEDS INPUT/);

    // Self-id (invariant 7, D66): the decline radio is selected from config;
    // Pronouns is free text with no configured answer, and the Gender radios
    // offer no decline option, so both stay blank. Consent is Kris's.
    expect(await page.inputValue('#pronouns')).toBe('');
    for (const sel of ['#g-0', '#g-1', '#sms-0', '#sms-1']) {
      expect(await checked(sel)).toBe(false);
    }
    expect(await checked('#s-0')).toBe(true);
    expect(report.self_identification).toEqual([
      { field: 'Status', value: 'Decline to self-identify' },
    ]);
    expect(report.skipped_eeo).toEqual(expect.arrayContaining(['Pronouns', 'Gender']));

    // Nothing submitted: no native submit, and the Submit Application button untouched.
    expect(await submits(page)).toBe(0);
    expect(
      await page.evaluate(() => (window as unknown as { __ashbySubmits: number }).__ashbySubmits),
    ).toBe(0);
    await page.close();
  });

  it('ashby — saved answers are reused on a re-fill, with no second draft call', async () => {
    const page = await openFixture('ashby-application.html');
    let calls = 0;
    const report = await fillForm(
      new SafePage(page),
      ashbyAdapter,
      {
        profile: PROFILE,
        answers: { ...ANSWERS, ...ASHBY_DRAFTS, 'Tell us more': 'Edited by Kris.' },
        resumePdfPath: resumePath,
        coverNote: 'Dear Acme team.',
        draftAnswers: async () => {
          calls++;
          return {};
        },
      },
      'https://jobs.ashbyhq.com/acme/1/application',
    );
    expect(calls).toBe(0);
    expect(await page.inputValue('#essay')).toBe('Edited by Kris.');
    expect(report.filled.some((f) => f.field === 'Tell us more' && f.via === 'draft')).toBe(true);
    expect(await submits(page)).toBe(0);
    await page.close();
  });

  it('greenhouse — location typeahead whose menu opens only when the control is pressed', async () => {
    const { page, report } = await fill(
      'greenhouse-location.html',
      greenhouseAdapter,
      'https://job-boards.greenhouse.io/acme/jobs/4',
    );
    expect(await page.textContent('.select__single-value')).toBe(
      'Scottsdale, Arizona, United States',
    );
    expect(report.filled.some((f) => f.source === 'contact.location')).toBe(true);
    expect(report.unfilled.some((u) => u.field.startsWith('Location'))).toBe(false);
    expect(await submits(page)).toBe(0);
    await page.close();
  });

  it('self-identification — typeahead dropdown with no decline wording gets the configured answer', async () => {
    // SmartRecruiters shape (live Canva, 2026-10-24): options exist only
    // after typing, and the decline wording is "Prefer not to say". A search
    // with no matching option must never commit a highlighted suggestion.
    const page = await browser.newPage();
    await page.setContent(
      `<body>
         <label for="gender">Gender identity</label>
         <input id="gender" role="combobox" aria-controls="gender-list" aria-autocomplete="list" />
         <div id="gender-list" role="listbox" hidden>
           <div role="option">Woman</div><div role="option">Man</div>
           <div role="option">Non-binary</div><div role="option">Prefer not to say</div>
         </div>
         <label for="race">Race/ethnicity</label>
         <input id="race" role="combobox" aria-controls="race-list" aria-autocomplete="list" />
         <div id="race-list" role="listbox" hidden>
           <div role="option">Category A</div><div role="option">Category B</div>
           <div role="option">Prefer not to say</div>
         </div>
         <script>
           for (const id of ['gender', 'race']) {
             const input = document.getElementById(id);
             const list = document.getElementById(id + '-list');
             input.addEventListener('input', () => { list.hidden = false; });
             for (const opt of list.querySelectorAll('[role="option"]')) {
               opt.addEventListener('click', () => { input.value = opt.textContent; list.hidden = true; });
             }
           }
         </script>
       </body>`,
      { waitUntil: 'load' },
    );
    const report = await fillForm(
      new SafePage(page),
      genericAdapter,
      {
        profile: {
          ...PROFILE,
          self_identification: {
            gender: 'Man',
            race_ethnicity: 'White',
            veteran_status: 'decline',
            disability_status: 'decline',
            overrides: {},
          },
        },
        answers: ANSWERS,
        resumePdfPath: resumePath,
      },
      'https://example.com/apply',
    );
    expect(await page.inputValue('#gender')).toBe('Man');
    expect(report.self_identification).toContainEqual({ field: 'Gender identity', value: 'Man' });
    // "White" is not offered and maps to no listed category: the field is
    // flagged, and no suggested category was committed in its place.
    expect(report.skipped_eeo).toContain('Race/ethnicity');
    expect(await page.inputValue('#race')).not.toBe('Category A');
    expect(await page.inputValue('#race')).not.toBe('Category B');
    await page.close();
  });

  it('goto waits for a shadow field that appears after a hidden input', async () => {
    const page = await browser.newPage();
    const shell = `<body>
      <input type="hidden" name="csrf" value="1">
      <script>
        setTimeout(() => {
          const host = document.createElement('spl-input');
          host.id = 'first-name-input';
          host.setAttribute('label', 'First name');
          host.setAttribute('required', '');
          const root = host.attachShadow({ mode: 'open' });
          root.innerHTML = '<input id="first-name-input" type="text">';
          document.body.appendChild(host);
        }, 1200);
      </script>
    </body>`;
    const safe = new SafePage(page);
    await safe.goto(`data:text/html,${encodeURIComponent(shell)}`);
    const fields = await safe.scanFields();
    const name = fields.find((field) => field.label === 'First name');
    expect(name?.selector).toMatch(/^\[data-jobhacker-field="/);
    if (!name) throw new Error('shadow field was not scanned');
    await safe.fill(name.selector, 'Kris');
    expect(await safe.inputValue(name.selector)).toBe('Kris');
    await page.close();
  });

  it('goto waits for a client-rendered form (Ashby is an empty shell at load)', async () => {
    const page = await browser.newPage();
    const shell = `<main id="app"></main><script>
      setTimeout(() => {
        document.getElementById('app').innerHTML =
          '<div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title" for="n">Name</label><input id="n" name="n" type="text"></div>';
      }, 1500);
    </script>`;
    const safe = new SafePage(page);
    await safe.goto(`data:text/html,${encodeURIComponent(shell)}`);
    const fields = await ashbyAdapter.detectFields(safe);
    expect(fields.map((f) => f.label)).toEqual(['Name']);
    await page.close();
  });

  it('chooseToggle and chooseRadio refuse anything that could submit', async () => {
    const page = await openFixture('greenhouse-basic.html');
    await page.setContent(
      `<form id="f">
         <div class="field"><div id="inform"><button aria-pressed="false">Yes</button><button aria-pressed="false">No</button></div></div>
       </form>
       <div class="field"><div id="submitty"><button aria-pressed="false">Submit</button><button aria-pressed="false">Cancel</button></div></div>
       <div class="field submit-bar"><div id="inbar"><button aria-pressed="false">Yes</button><button aria-pressed="false">No</button></div></div>
       <div class="field"><div id="ok"><button aria-pressed="false">Yes</button><button aria-pressed="false">No</button></div></div>
       <button id="notradio" type="button">Pick</button>
       <script>
         for (const b of document.querySelectorAll('button[aria-pressed]')) {
           b.addEventListener('click', () => {
             for (const s of b.parentElement.children) s.setAttribute('aria-pressed', String(s === b));
           });
         }
       </script>`,
      { waitUntil: 'load' },
    );
    const safe = new SafePage(page);
    await expect(safe.chooseToggle('#inform', 'Yes')).rejects.toThrow(SubmitRefusedError);
    await expect(safe.chooseToggle('#submitty', 'Submit')).rejects.toThrow(SubmitRefusedError);
    await expect(safe.chooseToggle('#inbar', 'Yes')).rejects.toThrow(SubmitRefusedError);
    await expect(safe.chooseRadio('#notradio')).rejects.toThrow(SubmitRefusedError);
    // A form-less Yes/No toggle (Ashby's shape) is pressed, and nothing else.
    expect(await safe.chooseToggle('#ok', 'No')).toBe(true);
    expect(await safe.toggleValue('#ok')).toBe('No');
    expect(await page.$eval('#inform button', (b) => b.getAttribute('aria-pressed'))).toBe('false');
    await page.close();
  });

  it('safeClick refuses submit buttons, submit-like text, and action bars', async () => {
    const page = await openFixture('greenhouse-basic.html');
    await page.setContent(
      `<form id="f">
         <button id="plain" type="button">Open menu</button>
         <button id="applyish" type="button">Apply now</button>
         <div class="actions"><button id="inbar" type="button">Continue</button></div>
         <button id="native" type="submit">Go</button>
       </form>`,
      { waitUntil: 'load' },
    );
    await page.evaluate(() => {
      const w = window as unknown as { __submits?: number };
      w.__submits = 0;
      document.addEventListener('submit', (e) => {
        e.preventDefault();
        w.__submits = (w.__submits ?? 0) + 1;
      });
    });
    const safe = new SafePage(page);

    await expect(safe.safeClick('#native')).rejects.toThrow(SubmitRefusedError);
    await expect(safe.safeClick('#applyish')).rejects.toThrow(SubmitRefusedError);
    await expect(safe.safeClick('#inbar')).rejects.toThrow(SubmitRefusedError);
    // A benign control (custom dropdown toggle) is allowed.
    await safe.safeClick('#plain');

    expect(await submits(page)).toBe(0);
    await page.close();
  });

  it('skips an apply-with-resume dropzone and keeps the résumé field', async () => {
    const page = await browser.newPage();
    await page.setContent(
      `<body>
         <spl-dropzone id="auto" data-test="apply-with-resume-container"></spl-dropzone>
         <spl-dropzone id="resume" data-test="resume-upload"></spl-dropzone>
         <script>
           for (const id of ['auto', 'resume']) {
             const host = document.getElementById(id);
             const root = host.attachShadow({ mode: 'open' });
             root.innerHTML = '<input type="file">';
           }
         </script>
       </body>`,
      { waitUntil: 'load' },
    );
    const fields = await new SafePage(page).scanFields();
    const files = fields.filter((field) => field.isFile);
    expect(files).toHaveLength(1);
    expect(files[0]?.hint).toContain('resume-upload');
    await page.close();
  });

  it('smartrecruiters-style widgets: autocomplete commits, phone country, month-year', async () => {
    const page = await browser.newPage();
    await page.setContent(
      `<body>
         <spl-autocomplete><input id="ac" type="text" ariacontrols="menu-ac"></spl-autocomplete>
         <div id="menu-ac" hidden><spl-select-option value="#spl-custom-option">Founder &amp; Lead Developer</spl-select-option></div>
         <spl-phone-field id="pf" class="ng-invalid">
           <button id="cc" type="button">Country code</button>
           <spl-dropdown-search><input id="search" type="text"></spl-dropdown-search>
           <spl-select id="csel" value="AU"></spl-select>
           <spl-select-option value="US">United States</spl-select-option>
           <input id="tel" type="tel">
         </spl-phone-field>
         <input id="date" type="text">
         <div class="flatpickr-calendar open">
           <input class="cur-year" type="number" value="2026">
           <span class="flatpickr-prev-month">prev</span><span class="flatpickr-next-month">next</span>
           <span class="flatpickr-monthSelect-month">Nov</span>
         </div>
         <script>
           const ac = document.getElementById('ac');
           ac.addEventListener('input', () => { document.getElementById('menu-ac').hidden = false; });
           document.querySelector('#menu-ac spl-select-option').addEventListener('click', (e) => {
             ac.value = e.currentTarget.textContent.trim();
             document.getElementById('menu-ac').hidden = true;
           });
           document.querySelector('spl-select-option[value="US"]').addEventListener('click', () => {
             document.getElementById('csel').setAttribute('value', 'US');
             document.getElementById('pf').className = 'ng-valid';
           });
           const year = document.querySelector('.cur-year');
           const date = document.getElementById('date');
           document.querySelector('.flatpickr-prev-month').addEventListener('click', () => { year.value = String(Number(year.value) - 1); });
           document.querySelector('.flatpickr-next-month').addEventListener('click', () => { year.value = String(Number(year.value) + 1); });
           document.querySelector('.flatpickr-monthSelect-month').addEventListener('click', () => { date.value = '11/' + year.value; });
         </script>
       </body>`,
      { waitUntil: 'load' },
    );
    const safe = new SafePage(page);

    // Autocomplete: typed text only counts once its menu option is chosen.
    expect(await safe.fillAutocomplete('#ac', 'Founder & Lead Developer')).toBe(true);
    expect(await page.inputValue('#ac')).toBe('Founder & Lead Developer');

    // Phone: the widget's country is set before the national number is judged.
    expect(await safe.phoneValidationError('#tel')).not.toBeNull();
    expect(await safe.setPhoneCountry('United States', 'US')).toBe(true);
    expect(await safe.phoneValidationError('#tel')).toBeNull();

    // Month-year: step the calendar year back, then pick the month.
    expect(await safe.fillMonthYear('#date', 'Nov', 2025, '11/2025')).toBe(true);
    await page.close();
  });

  it('reads and fills an input inside an open shadow root', async () => {
    const page = await browser.newPage();
    await page.setContent(
      `<body>
         <spl-input id="first-name-input" label="First name" required></spl-input>
         <script>
           const host = document.querySelector('spl-input');
           const root = host.attachShadow({ mode: 'open' });
           root.innerHTML = '<input id="first-name-input" type="text">';
         </script>
       </body>`,
      { waitUntil: 'load' },
    );
    const safe = new SafePage(page);
    const fields = await safe.scanFields();
    const name = fields.find((field) => field.label === 'First name');
    expect(name?.required).toBe(true);
    expect(name?.selector).toMatch(/^\[data-jobhacker-field="/);
    if (!name) throw new Error('shadow field was not scanned');
    await safe.fill(name.selector, 'Kris');
    expect(await safe.inputValue(name.selector)).toBe('Kris');
    await page.close();
  });
});
