import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolveChrome } from '../apply/browser.js';
import type { Profile } from '../config/schemas.js';
import type { TailoredResultBullet } from './tailor.js';
import { resumeDocument } from './templates/resume.js';

/**
 * Resume rendering (FR-7, ARCHITECTURE § Flows "Prep" step 4). `renderResumeHtml`
 * is pure and fully unit-tested; `renderResumePdf` drives a headless Chrome via
 * `playwright-core` to turn that HTML into a PDF (`page.pdf()`), which only runs
 * in the live acceptance pass. The two are split so the HTML can be tested with
 * no browser.
 */

export interface ResumeData {
  profile: Profile;
  /** The tailored bullets, in the order they should appear. */
  bullets: TailoredResultBullet[];
}

export function renderResumeHtml(data: ResumeData): string {
  const { profile } = data;
  const bySource = groupBySource(data.bullets);

  const sections: string[] = [header(profile), summary(profile), skills(profile)];

  const experienceHtml = profile.experience
    .map((exp) =>
      entry(
        exp.title,
        exp.company,
        metaLine(exp.start, exp.end, exp.location),
        bulletIdsFor(exp.bullets, bySource),
      ),
    )
    .filter((html) => html !== '')
    .join('\n');
  if (experienceHtml) sections.push(`<h2>Experience</h2>\n${experienceHtml}`);

  const projectsHtml = profile.projects
    .map((proj) => entry(proj.name, '', '', bulletIdsFor(proj.bullets, bySource)))
    .filter((html) => html !== '')
    .join('\n');
  if (projectsHtml) sections.push(`<h2>Projects</h2>\n${projectsHtml}`);

  if (profile.education.length > 0) sections.push(education(profile));

  const title = `${escapeHtml(profile.contact.name)} — Resume`;
  return resumeDocument(sections.join('\n'), title);
}

/**
 * The cover note as a one-page letter, for forms that want a cover-letter
 * upload rather than a text box. Same header as the resume; the body is the
 * note verbatim, paragraph by paragraph (pure).
 */
export function renderCoverLetterHtml(profile: Profile, coverNote: string): string {
  const paragraphs = coverNote
    .trim()
    .split(/\n\s*\n/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  const title = `${escapeHtml(profile.contact.name)} — Cover letter`;
  return resumeDocument(`${header(profile)}\n<div class="letter">\n${paragraphs}\n</div>`, title);
}

/** File names a recruiter sees, e.g. "Kris_Tester_Resume.pdf". */
export function attachmentName(profile: Profile, kind: 'Resume' | 'Cover_Letter'): string {
  const name = profile.contact.name
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return `${name || 'Candidate'}_${kind}.pdf`;
}

/**
 * Render `html` to a PDF at `outPath` using Kris's installed Chrome (no bundled
 * Chromium; DECISIONS D18). Throws a clear error if Chrome cannot be found.
 */
export async function renderResumePdf(
  html: string,
  outPath: string,
  options: { chromePath?: string } = {},
): Promise<void> {
  const executablePath = resolveChrome(options.chromePath);
  if (!executablePath) {
    throw new Error(
      'Could not find Google Chrome for PDF rendering. Set JOBHACKER_CHROME_PATH to the Chrome binary.',
    );
  }
  // Imported lazily so the pure HTML path never loads the browser driver.
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await mkdir(dirname(outPath), { recursive: true });
    await page.pdf({
      path: outPath,
      format: 'Letter',
      printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });
  } finally {
    await browser.close();
  }
}

/** Write the resume HTML next to its PDF, creating the folder if needed. */
export async function writeResumeHtml(html: string, outPath: string): Promise<void> {
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, html, 'utf8');
}

// ---------------------------------------------------------------------------
// Section builders (pure)
// ---------------------------------------------------------------------------

function groupBySource(bullets: TailoredResultBullet[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const b of bullets) {
    const list = map.get(b.sourceId) ?? [];
    list.push(b.text);
    map.set(b.sourceId, list);
  }
  return map;
}

function bulletIdsFor(
  sourceBullets: ReadonlyArray<{ id: string }>,
  bySource: Map<string, string[]>,
): string[] {
  const out: string[] = [];
  for (const sb of sourceBullets) {
    const texts = bySource.get(sb.id);
    if (texts) out.push(...texts);
  }
  return out;
}

function header(profile: Profile): string {
  const c = profile.contact;
  const contact = [c.location, c.email, c.phone].filter(Boolean).map(escapeHtml).join(' · ');
  const links = Object.values(profile.links)
    .filter((u): u is string => typeof u === 'string' && u.length > 0)
    .map((u) => `<a href="${escapeAttr(u)}">${escapeHtml(stripScheme(u))}</a>`)
    .join(' · ');
  return [
    `<h1>${escapeHtml(c.name)}</h1>`,
    `<div class="contact">${contact}</div>`,
    links ? `<div class="links">${links}</div>` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function summary(profile: Profile): string {
  return `<h2>Summary</h2>\n<p class="summary">${escapeHtml(profile.summary.trim())}</p>`;
}

function skills(profile: Profile): string {
  const groups = Object.entries(profile.skills)
    .map(
      ([group, items]) =>
        `<p><span class="group">${escapeHtml(titleCase(group))}:</span> ${items.map(escapeHtml).join(', ')}</p>`,
    )
    .join('\n');
  return `<h2>Skills</h2>\n<div class="skills">\n${groups}\n</div>`;
}

function entry(title: string, org: string, meta: string, bullets: string[]): string {
  if (bullets.length === 0) return '';
  const heading = org ? `${escapeHtml(title)} — ${escapeHtml(org)}` : escapeHtml(title);
  const metaHtml = meta ? `<span class="entry-meta">${escapeHtml(meta)}</span>` : '';
  const items = bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('\n');
  return [
    '<div class="entry">',
    `<div class="entry-head"><span class="entry-title">${heading}</span>${metaHtml}</div>`,
    `<ul>\n${items}\n</ul>`,
    '</div>',
  ].join('\n');
}

function education(profile: Profile): string {
  const items = profile.education
    .map((e) => {
      const parts = [e.school, e.credential].filter(Boolean).map((s) => escapeHtml(s as string));
      const when = [e.start, e.end].filter(Boolean).join('–');
      const meta = when ? ` <span class="entry-meta">${escapeHtml(when)}</span>` : '';
      return `<li>${parts.join(', ')}${meta}</li>`;
    })
    .join('\n');
  return `<h2>Education</h2>\n<ul>\n${items}\n</ul>`;
}

function metaLine(start: string, end: string, location?: string): string {
  const when = `${start}–${end}`;
  return location ? `${when} · ${location}` : when;
}

function titleCase(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(input: string): string {
  return escapeHtml(input);
}
