/**
 * Record the public demo's fill (J21). Runs the real filler (`fillForm` through `SafePage`,
 * the Greenhouse adapter, the self-identification mapper and grounded drafting) on the sample
 * form in headless Chrome, as the fictional candidate in site/demo-profile.yaml. Writes what it
 * did to site/src/fill-recording.json, which /form/ replays.
 *
 * The drafting model is `FakeLlm` with one canned essay. The essay still has to pass the real
 * grounding checks, and the run fails if it doesn't. Nothing is submitted: the page counts
 * submit attempts and the run fails unless the count is 0.
 *
 *   pnpm demo:record
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { parse as parseYaml } from 'yaml';
import { recordingSchema } from '../site/src/recording.js';
import { greenhouseAdapter } from '../src/core/apply/adapters/greenhouse.js';
import { resolveChrome } from '../src/core/apply/browser.js';
import { fillView } from '../src/core/apply/fill-view.js';
import { fillForm } from '../src/core/apply/fill.js';
import { SafePage } from '../src/core/apply/safe-page.js';
import { selfIdCategory } from '../src/core/apply/self-id.js';
import type { OpenQuestion } from '../src/core/apply/types.js';
import { type Profile, profileSchema } from '../src/core/config/schemas.js';
import { FakeLlm } from '../src/core/llm/fake.js';
import { draftFormAnswers, storedAnswer } from '../src/core/prep/form-answers.js';
import { attachmentName } from '../src/core/prep/render.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FORM = join(ROOT, 'site/form/sample-form.html');
const PROFILE = join(ROOT, 'site/demo-profile.yaml');
const OUT = join(ROOT, 'site/src/fill-recording.json');
const FORM_URL = 'https://jobhacker.space/form/';

/** The filler's outlines (fill.ts REVIEW_COLOR, SafePage.highlight's default). */
const COLORS = { review: '#f59e0b', blank: '#e11d48' } as const;

/** The candidate's preferences, as in the prototype's Settings. Only grounding reads them. */
const PREFERENCES =
  "Senior or staff full-stack roles where I own features end to end, at product companies with a real design culture. I like developer tools, maps and logistics, and games. I'd rather not work on ad tech or crypto. Remote in the US, or hybrid in Portland or Phoenix.";

const JOB_TEXT = [
  'Company: Example Co.',
  'Title: Senior Product Engineer',
  'Location: Remote (US)',
  'A sample posting for the JobHacker demo: a product engineering role on a small team that ships carefully designed web software.',
].join('\n');

/** The fake model's drafts, by question. Anything else gets no answer. */
function cannedDraft(label: string): {
  answer: string | null;
  needs_input: string | null;
  source_ids: string[];
} {
  if (/why do you want/i.test(label)) {
    return {
      answer:
        'I want to own features from schema to pixels at a product company with a real design culture. At Fabrikam I lead frontend for the fleet-tracking platform, a React and Go app used by 400 logistics teams, and I rebuilt its live map and vehicle list for speed. This role asks for that same mix of craft and performance work.',
      needs_input: null,
      source_ids: ['fabrikam-1', 'fabrikam-2'],
    };
  }
  if (/referr/i.test(label)) {
    return { answer: null, needs_input: 'who referred you, if anyone', source_ids: [] };
  }
  return { answer: null, needs_input: null, source_ids: [] };
}

interface PageStep {
  id: string;
  label: string;
  kind: 'text' | 'select' | 'check' | 'file' | 'none';
  value: string;
  outline: string;
}

async function main(): Promise<void> {
  const html = readFileSync(FORM, 'utf8');
  const formSha256 = createHash('sha256').update(html).digest('hex');
  const profile: Profile = profileSchema.parse(parseYaml(readFileSync(PROFILE, 'utf8')));

  const executablePath = resolveChrome();
  if (!executablePath) throw new Error('No Chrome found (set JOBHACKER_CHROME_PATH).');

  const dir = mkdtempSync(join(tmpdir(), 'jobhacker-demo-'));
  const resumePdfPath = join(dir, attachmentName(profile, 'Resume'));
  writeFileSync(resumePdfPath, '%PDF-1.4\n% JobHacker demo: a stand-in resume\n');

  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.setContent(`<!doctype html><html><body>${html}</body></html>`, {
      waitUntil: 'load',
    });
    // tsx's keepNames helper, which SafePage.goto installs on a real navigation (D22).
    await page.evaluate(
      'globalThis.__name = globalThis.__name || ((target, value) => Object.defineProperty(target, "name", { value, configurable: true }));',
    );
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

    let drafted: Record<string, string> = {};
    let draft = { questions: [] as string[], answered: 0, needsInput: 0, rejected: 0 };
    const draftAnswers = async (questions: OpenQuestion[]) => {
      const llm = new FakeLlm({
        responder: () => ({
          answers: questions.map((q, id) => ({ id, ...cannedDraft(q.label) })),
        }),
      });
      const result = await draftFormAnswers(
        { llm, model: 'fake', profile, preferences: PREFERENCES, jobText: JOB_TEXT, coverNote: '' },
        questions,
      );
      draft = {
        questions: questions.map((q) => q.label),
        answered: result.answers.filter((a) => a.answer !== null).length,
        needsInput: result.answers.filter((a) => a.answer === null && a.needsInput).length,
        rejected: result.rejected,
      };
      drafted = Object.fromEntries(result.answers.map((a) => [a.label, storedAnswer(a)]));
      return drafted;
    };

    const started = Date.now();
    const report = await fillForm(
      new SafePage(page),
      greenhouseAdapter,
      { profile, answers: profile.standard_answers, resumePdfPath, draftAnswers },
      FORM_URL,
    );
    const fillMs = Date.now() - started;
    const submits = await page.evaluate(
      () => (window as unknown as { __submits?: number }).__submits ?? 0,
    );
    if (submits !== 0) throw new Error(`the fill attempted ${submits} submits`);
    if (draft.rejected !== 0) throw new Error(`grounding rejected ${draft.rejected} drafts`);

    const pageSteps = await page.evaluate((): PageStep[] => {
      const form = document.getElementById('application_form');
      if (!form) return [];
      const out: PageStep[] = [];
      for (const el of Array.from(form.querySelectorAll('input, select, textarea'))) {
        const control = el as HTMLInputElement;
        const label = (document.querySelector(`label[for="${control.id}"]`)?.textContent ?? '')
          .replace(/\s+/g, ' ')
          .trim();
        const outline = control.style.outlineColor;
        let kind: PageStep['kind'] = 'none';
        let value = '';
        if (el.tagName === 'SELECT') {
          if (control.value !== '') [kind, value] = ['select', control.value];
        } else if (control.type === 'checkbox') {
          if (control.checked) [kind, value] = ['check', 'true'];
        } else if (control.type === 'file') {
          const names = Array.from(control.files ?? []).map((f) => f.name);
          if (names.length > 0) [kind, value] = ['file', names.join(', ')];
        } else if (control.value !== '') {
          [kind, value] = ['text', control.value];
        }
        if (kind === 'none' && !outline) continue;
        out.push({ id: control.id, label, kind, value, outline });
      }
      return out;
    });

    const rgb = (hex: string) => {
      const n = Number.parseInt(hex.slice(1), 16);
      return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
    };
    const steps = pageSteps.map(({ outline, ...step }) => {
      if (outline && outline !== rgb(COLORS.review) && outline !== rgb(COLORS.blank)) {
        throw new Error(`"${step.label}" has an outline the recorder doesn't know: ${outline}`);
      }
      const mark = !outline ? null : outline === rgb(COLORS.review) ? 'review' : 'blank';
      return { ...step, mark } as const;
    });

    const view = fillView({
      ats: greenhouseAdapter.ats,
      report,
      answers: { ...profile.standard_answers, ...drafted },
      coverNote: null,
      profile,
      approvals: new Map(),
    });
    const recording = recordingSchema.parse({
      about:
        'Written by `pnpm demo:record` (scripts/record-demo-fill.ts). The real filler on site/form/sample-form.html, as the fictional candidate in site/demo-profile.yaml. Re-record after changing either.',
      formSha256,
      ats: report.ats,
      url: report.url,
      fillMs,
      colors: COLORS,
      steps,
      report: {
        fields: view.rows.map(({ id, label, value, state, source, required, note }) => ({
          id,
          label,
          state,
          ...(value !== undefined ? { value } : {}),
          ...(source !== undefined ? { source } : {}),
          ...(required !== undefined ? { required } : {}),
          ...(note !== undefined ? { note } : {}),
        })),
        filled: view.filled,
        review: view.review,
        blank: view.blank,
        requiredBlank: view.requiredBlank,
        resumeAttached: view.resumeAttached,
        selfIdNote: view.selfIdNote,
      },
      draft,
      submits,
    });
    writeFileSync(OUT, `${JSON.stringify(recording, null, 2)}\n`);

    const marks = (m: 'review' | 'blank') => steps.filter((s) => s.mark === m).length;
    console.log(`form      ${relative(ROOT, FORM)} (sha256 ${formSha256.slice(0, 12)})`);
    console.log(`fill      ${fillMs} ms in headless Chrome · submits ${submits}`);
    console.log(
      `draft     ${draft.questions.length} open questions · ${draft.answered} answered · ${draft.needsInput} needs input · ${draft.rejected} rejected by grounding`,
    );
    console.log(
      `report    filled ${view.filled} · review ${view.review} · blank ${view.blank} (${view.requiredBlank} required) · resume ${view.resumeAttached ? 'attached' : 'missing'}`,
    );
    console.log(`outlines  amber ${marks('review')} · red ${marks('blank')}`);
    for (const s of report.self_identification) {
      const category = selfIdCategory(s.field);
      const answer = category ? profile.self_identification?.[category] : undefined;
      console.log(
        `self-id   ${s.field} → ${s.value}  (demo-profile.yaml ${category ?? '?'}: ${answer ?? 'not set'})`,
      );
    }
    if (report.skipped_eeo.length > 0) {
      console.log(`self-id   left blank: ${report.skipped_eeo.join(', ')}`);
    }
    console.log(`wrote     ${relative(ROOT, OUT)} (${steps.length} steps)`);
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
