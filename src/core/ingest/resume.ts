import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { normalizeWhitespace } from '../util/text.js';
import {
  IngestError,
  type IngestedEducation,
  type IngestedExperience,
  type IngestedProfileData,
  type IngestedProject,
  type SourceLocator,
  type SourcedField,
  emptyIngestedProfileData,
} from './types.js';

interface ResumeBlock {
  text: string;
  source: SourceLocator;
}

interface ExtractedResume {
  file: string;
  sha256: string;
  blocks: ResumeBlock[];
  warnings: string[];
}

const SECTION_NAMES = {
  summary: /^(summary|profile|professional summary|about)$/i,
  skills: /^(skills|skills & tooling|technical skills|technologies|core competencies)$/i,
  experience: /^(experience|work experience|professional experience|employment)$/i,
  projects: /^(projects|selected projects|personal projects)$/i,
  education: /^(education|academic background)$/i,
  other: /^(beyond the keyboard|beyondthekeyboard|interests|additional information)$/i,
} as const;

type Section = keyof typeof SECTION_NAMES | 'header' | 'other';

/**
 * Extract and conservatively structure a local PDF/DOCX resume. No LLM is used:
 * claims are copied exactly apart from whitespace and bullet-marker cleanup.
 */
export async function ingestResume(file: string): Promise<IngestedProfileData> {
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch {
    throw new IngestError(`resume file not found: ${file}`);
  }

  const extension = extname(file).toLowerCase();
  let extracted: ExtractedResume;
  if (extension === '.pdf') {
    extracted = await extractPdf(file, bytes);
  } else if (extension === '.docx') {
    extracted = await extractDocx(file, bytes);
  } else {
    throw new IngestError(
      `unsupported resume type "${extension || '(none)'}"; expected .pdf or .docx`,
    );
  }
  return parseResumeBlocks(extracted);
}

async function extractPdf(file: string, bytes: Buffer): Promise<ExtractedResume> {
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    const blocks = result.pages.flatMap((page) =>
      lines(page.text).map((text, index) => ({
        text,
        source: resumeLocator(file, `page:${page.num}:line:${index + 1}`),
      })),
    );
    return { file, sha256: hashBytes(bytes), blocks, warnings: [] };
  } catch (err) {
    throw new IngestError(
      `could not extract PDF resume ${file}: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(file: string, bytes: Buffer): Promise<ExtractedResume> {
  try {
    const result = await mammoth.extractRawText({ buffer: bytes });
    const blocks = lines(result.value).map((text, index) => ({
      text,
      source: resumeLocator(file, `paragraph:${index + 1}`),
    }));
    return {
      file,
      sha256: hashBytes(bytes),
      blocks,
      warnings: result.messages.map((message) => `DOCX ${message.type}: ${message.message}`),
    };
  } catch (err) {
    throw new IngestError(
      `could not extract DOCX resume ${file}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Exported for deterministic fixture tests without manufacturing a binary document. */
export function parseResumeText(file: string, text: string): IngestedProfileData {
  const locatorKind = extname(file).toLowerCase() === '.docx' ? 'paragraph' : 'line';
  const blocks = lines(text).map((line, index) => ({
    text: line,
    source: resumeLocator(file, `${locatorKind}:${index + 1}`),
  }));
  return parseResumeBlocks({
    file,
    sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
    blocks,
    warnings: [],
  });
}

function parseResumeBlocks(resume: ExtractedResume): IngestedProfileData {
  const out = emptyIngestedProfileData();
  out.inputs.push({ file: resume.file, sha256: resume.sha256 });
  out.warnings.push(...resume.warnings);

  const sectioned = splitSections(resume.blocks);
  readHeader(sectioned.header ?? [], out);
  readSummary(sectioned.summary ?? [], out);
  readSkills(sectioned.skills ?? [], out);
  readExperience(sectioned.experience ?? [], out);
  readProjects(sectioned.projects ?? [], out);
  readEducation(sectioned.education ?? [], out);
  const other = sectioned.other ?? [];
  if (other.length > 0) {
    out.warnings.push(
      `resume other section: ${other.length} line(s) were not mapped to profile fields`,
    );
  }
  return out;
}

function splitSections(blocks: ResumeBlock[]): Partial<Record<Section, ResumeBlock[]>> {
  const sections: Partial<Record<Section, ResumeBlock[]>> = { header: [] };
  let current: Section = 'header';
  for (const block of blocks) {
    const section = sectionFor(block.text);
    if (section) {
      current = section;
      sections[current] ??= [];
      continue;
    }
    const sectionBlocks = sections[current] ?? [];
    sectionBlocks.push(block);
    sections[current] = sectionBlocks;
  }
  return sections;
}

function sectionFor(text: string): Exclude<Section, 'header'> | undefined {
  const clean = normalizeHeading(text);
  for (const [section, pattern] of Object.entries(SECTION_NAMES) as Array<
    [Exclude<Section, 'header'>, RegExp]
  >) {
    if (pattern.test(clean)) return section;
  }
  return undefined;
}

function readHeader(blocks: ResumeBlock[], out: IngestedProfileData): void {
  const emailBlock = blocks.find((block) => emailFrom(block.text));
  const phoneBlock = blocks.find((block) => phoneFrom(block.text));
  const linkedInBlock = blocks.find((block) => /linkedin\.com\//i.test(block.text));
  const githubBlock = blocks.find((block) => /github\.com\//i.test(block.text));
  const urls = blocks.flatMap((block) =>
    (block.text.match(/https?:\/\/[^\s,;")]+/g) ?? []).map((url) => ({ url, block })),
  );

  const nameBlock = blocks.find(
    (block) =>
      !emailFrom(block.text) &&
      !phoneFrom(block.text) &&
      !/https?:\/\//i.test(block.text) &&
      block.text.length <= 100,
  );
  if (nameBlock) out.contact.name = field(nameFromHeader(nameBlock.text), nameBlock);
  if (emailBlock) out.contact.email = field(emailFrom(emailBlock.text) ?? '', emailBlock);
  if (phoneBlock) out.contact.phone = field(phoneFrom(phoneBlock.text) ?? '', phoneBlock);

  const locationBlock = blocks
    .slice(0, 8)
    .find(
      (block) =>
        /^[A-Za-z .'-]+,\s*(?:[A-Z]{2}|[A-Za-z .'-]+)(?:\s+\d{5})?$/.test(block.text) &&
        block !== nameBlock,
    );
  if (locationBlock) out.contact.location = field(locationBlock.text, locationBlock);

  if (linkedInBlock) {
    const url = profileLink(linkedInBlock.text, 'linkedin.com');
    if (url) out.links.linkedin = field(url, linkedInBlock);
  }
  if (githubBlock) {
    const url = profileLink(githubBlock.text, 'github.com');
    if (url) out.links.github = field(url, githubBlock);
  }
  const portfolio = urls.find(({ url }) => !/linkedin\.com|github\.com/i.test(url));
  if (portfolio) out.links.portfolio = field(portfolio.url, portfolio.block);
}

function readSummary(blocks: ResumeBlock[], out: IngestedProfileData): void {
  if (blocks.length === 0) return;
  out.summary = {
    value: blocks.map((block) => block.text).join(' '),
    source: {
      ...blocks[0]!.source,
      locator: rangeLocator(blocks),
    },
  };
}

function readSkills(blocks: ResumeBlock[], out: IngestedProfileData): void {
  for (const block of blocks) {
    for (const skill of block.text
      .replace(/^[^:]{1,30}:\s*/, '')
      .split(/[,;|•·]/)
      .map((value) =>
        value.replace(
          /^(?:LANGUAGES|FRONTEND|BACKEND\s*\/\s*APIS|CLOUD\s*\/\s*DEVOPS|DATA|QUALITY\s*&\s*UX|AI INTEGRATION|LEADERSHIP)\s+/i,
          '',
        ),
      )
      .map(normalizeWhitespace)
      .filter(Boolean)) {
      out.skills.push({ text: skill, source: block.source });
    }
  }
}

function readExperience(blocks: ResumeBlock[], out: IngestedProfileData): void {
  if (
    blocks.some((block) => block.source.locator.startsWith('paragraph:')) &&
    readSequentialDocxExperience(blocks, out)
  ) {
    return;
  }
  if (blocks.some((block) => parseCompanyDateHeader(block))) {
    readCompanyDateExperience(blocks, out);
    return;
  }

  let current: IngestedExperience | undefined;
  let pending: ResumeBlock[] = [];
  for (const block of blocks) {
    const bullet = bulletText(block.text);
    if (bullet !== null) {
      if (pending.length > 0) {
        const next = experienceFromPending(pending);
        for (const unused of next ? pending.slice(0, -2) : pending) {
          out.warnings.push(`resume ${unused.source.locator}: unparsed experience line`);
        }
        pending = [];
        if (next) {
          current = next;
          out.experience.push(current);
        }
      }
      if (!current) {
        current = { bullets: [] };
        out.experience.push(current);
        out.warnings.push(
          `resume ${block.source.locator}: bullet appeared before a parseable experience header`,
        );
      }
      if (bullet) current.bullets.push({ text: bullet, source: block.source });
      continue;
    }
    const header = parseExperienceHeader(block, pending);
    if (header) {
      for (const unused of pending.slice(0, -header.consumedPending)) {
        out.warnings.push(`resume ${unused.source.locator}: unparsed experience line`);
      }
      pending = [];
      current = header.experience;
      out.experience.push(current);
      continue;
    }
    pending.push(block);
  }
  for (const unused of pending) {
    out.warnings.push(`resume ${unused.source.locator}: unparsed experience line`);
  }
}

function readSequentialDocxExperience(blocks: ResumeBlock[], out: IngestedProfileData): boolean {
  const headers: Array<{ index: number; experience: IngestedExperience }> = [];
  for (let i = 0; i + 2 < blocks.length; i++) {
    const companyBlock = blocks[i];
    const dateBlock = blocks[i + 1];
    const titleBlock = blocks[i + 2];
    if (!companyBlock || !dateBlock || !titleBlock) continue;
    const dates = parseDateRange(dateBlock.text, dateBlock);
    if (!dates || isDecorativeExperienceHeading(companyBlock.text)) continue;
    const [company, ...location] = companyBlock.text
      .split('·')
      .map(normalizeWhitespace)
      .filter(Boolean);
    if (!company || isBulletSeparator(titleBlock.text) || bulletText(titleBlock.text) !== null) {
      continue;
    }
    headers.push({
      index: i,
      experience: {
        company: field(company, companyBlock),
        location: location.length > 0 ? field(location.join(' · '), companyBlock) : undefined,
        title: field(titleBlock.text, titleBlock),
        ...dates,
        bullets: [],
      },
    });
    i += 2;
  }
  if (headers.length === 0) return false;

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i]!;
    const next = headers[i + 1];
    const claimBlocks = blocks.slice(header.index + 3, next?.index ?? blocks.length);
    for (const block of claimBlocks) {
      if (isDecorativeExperienceHeading(block.text) || isBulletSeparator(block.text)) continue;
      const text = bulletText(block.text) ?? normalizeWhitespace(block.text);
      if (text) header.experience.bullets.push({ text, source: block.source });
    }
    out.experience.push(header.experience);
  }
  return true;
}

function readCompanyDateExperience(blocks: ResumeBlock[], out: IngestedProfileData): void {
  const pages = new Map<string, ResumeBlock[]>();
  for (const block of blocks) {
    const page = block.source.locator.match(/^page:(\d+):/)?.[1] ?? 'document';
    const pageBlocks = pages.get(page) ?? [];
    pageBlocks.push(block);
    pages.set(page, pageBlocks);
  }

  for (const [page, pageBlocks] of pages) {
    const consumed = new Set<number>();
    const positions: IngestedExperience[] = [];
    for (let i = 0; i < pageBlocks.length; i++) {
      const headerBlock = pageBlocks[i];
      if (!headerBlock) continue;
      const header = parseCompanyDateHeader(headerBlock);
      if (!header) continue;
      const titleBlock = pageBlocks[i + 1];
      if (!titleBlock || parseCompanyDateHeader(titleBlock) || isBulletSeparator(titleBlock.text)) {
        out.warnings.push(
          `resume ${headerBlock.source.locator}: company/date header has no title line`,
        );
        continue;
      }
      consumed.add(i);
      consumed.add(i + 1);
      positions.push({
        company: header.company,
        title: field(titleBlock.text, titleBlock),
        start: header.start,
        end: header.end,
        location: header.location,
        bullets: [],
      });
      i += 1;
    }

    const claims = claimsSeparatedByBullets(pageBlocks.filter((_, index) => !consumed.has(index)));
    if (positions.length === 1) {
      positions[0]!.bullets.push(...claims);
    } else if (positions.length > 1 && claims.length > 0) {
      const marker = `[NEEDS INPUT: resolve conflict — assign resume claims from page ${page} to the correct experience]`;
      positions.push({
        company: {
          value: marker,
          source: claims[0]!.source,
        },
        title: {
          value: marker,
          source: claims[0]!.source,
        },
        start: {
          value: marker,
          source: claims[0]!.source,
        },
        end: {
          value: marker,
          source: claims[0]!.source,
        },
        bullets: claims,
      });
      out.warnings.push(
        `resume page ${page}: ${claims.length} claim(s) could not be assigned among ${positions.length - 1} positions`,
      );
    }
    out.experience.push(...positions);
  }
}

function parseCompanyDateHeader(block: ResumeBlock):
  | {
      company: SourcedField;
      location?: SourcedField;
      start: SourcedField;
      end: SourcedField;
    }
  | undefined {
  const match = block.text.match(
    /^(.*?)\s+((?:[A-Z]{3}\s+)?\d{4})\s+(?:-|–|—)\s+((?:[A-Z]{3}\s+)?\d{4}|PRESENT)$/i,
  );
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  if (match[1].includes('|')) return undefined;
  if (/^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)$/i.test(match[1])) {
    return undefined;
  }
  const [company, ...location] = match[1].split('·').map(normalizeWhitespace).filter(Boolean);
  if (!company) return undefined;
  return {
    company: field(company, block),
    location: location.length > 0 ? field(location.join(' · '), block) : undefined,
    start: field(match[2], block),
    end: field(match[3], block),
  };
}

function claimsSeparatedByBullets(blocks: ResumeBlock[]): Array<{
  text: string;
  source: SourceLocator;
}> {
  const claims: Array<{ text: string; source: SourceLocator }> = [];
  let pending: ResumeBlock[] = [];
  const flush = (): void => {
    const text = normalizeWhitespace(pending.map((block) => block.text).join(' '));
    const source = pending[0]?.source;
    if (text && source) claims.push({ text, source });
    pending = [];
  };

  for (const block of blocks) {
    if (isDecorativeExperienceHeading(block.text)) {
      flush();
      continue;
    }
    const leadingBullet = bulletText(block.text);
    if (leadingBullet !== null && leadingBullet.length > 0) {
      flush();
      claims.push({ text: leadingBullet, source: block.source });
      continue;
    }
    if (isBulletSeparator(block.text)) {
      flush();
      continue;
    }
    if (/•\s*$/.test(block.text)) {
      pending.push({ ...block, text: block.text.replace(/•\s*$/, '') });
      flush();
      continue;
    }
    pending.push(block);
  }
  flush();
  return claims;
}

function isBulletSeparator(text: string): boolean {
  return /^[•*▪◦●·-]$/.test(text.trim());
}

function isDecorativeExperienceHeading(text: string): boolean {
  const compact = normalizeHeading(text);
  return /^(early career|early career — game industry|earlycareer — gameindustry)$/i.test(compact);
}

function readProjects(blocks: ResumeBlock[], out: IngestedProfileData): void {
  let current: IngestedProject | undefined;
  for (const block of blocks) {
    const bullet = bulletText(block.text);
    if (bullet !== null) {
      if (!current) {
        current = { bullets: [] };
        out.projects.push(current);
        out.warnings.push(
          `resume ${block.source.locator}: bullet appeared before a parseable project header`,
        );
      }
      if (bullet) current.bullets.push({ text: bullet, source: block.source });
      continue;
    }
    const parts = block.text.split('|').map(normalizeWhitespace).filter(Boolean);
    if (parts.length > 0) {
      current = {
        name: field(parts[0] ?? '', block),
        url: parts[1]?.startsWith('http') ? field(parts[1], block) : undefined,
        bullets: [],
      };
      out.projects.push(current);
    }
  }
}

function readEducation(blocks: ResumeBlock[], out: IngestedProfileData): void {
  for (const block of blocks) {
    const previous = out.education.at(-1);
    if (
      previous &&
      !previous.credential &&
      /^(?:Computer Science Coursework|.+(?:Degree|Certificate))$/i.test(block.text)
    ) {
      previous.credential = field(block.text, block);
      continue;
    }
    const parts = educationParts(block.text);
    const education: IngestedEducation = {
      school: parts[0] ? field(parts[0], block) : undefined,
      credential: parts[1] ? field(parts[1], block) : undefined,
      start: parts[2] ? field(parts[2], block) : undefined,
      end: parts[3] ? field(parts[3], block) : undefined,
    };
    if (education.school) out.education.push(education);
  }
}

function parseExperienceHeader(
  block: ResumeBlock,
  pending: ResumeBlock[],
): { experience: IngestedExperience; consumedPending: number } | undefined {
  const parts = block.text.split('|').map(normalizeWhitespace).filter(Boolean);
  const [first, second, third, fourth, fifth] = parts;
  if (first && second && third && fourth) {
    return {
      experience: {
        company: field(first, block),
        title: field(second, block),
        start: field(third, block),
        end: field(fourth, block),
        location: fifth ? field(fifth, block) : undefined,
        bullets: [],
      },
      consumedPending: 0,
    };
  }

  // Common two-line layout:
  //   Acme
  //   Senior Engineer | Jan 2020 – Present
  if (first && second && pending.length > 0) {
    const dates = parseDateRange(second, block);
    const company = pending.at(-1);
    if (dates && company) {
      return {
        experience: {
          company: field(company.text, company),
          title: field(first, block),
          ...dates,
          bullets: [],
        },
        consumedPending: 1,
      };
    }
  }

  // Common three-line layout:
  //   Acme
  //   Senior Engineer
  //   Jan 2020 – Present
  const dates = parseDateRange(block.text, block);
  const company = pending.at(-2);
  const title = pending.at(-1);
  if (dates && company && title) {
    return {
      experience: {
        company: field(company.text, company),
        title: field(title.text, title),
        ...dates,
        bullets: [],
      },
      consumedPending: 2,
    };
  }
  return undefined;
}

function experienceFromPending(pending: ResumeBlock[]): IngestedExperience | undefined {
  const company = pending.at(-2);
  const title = pending.at(-1);
  if (!company || !title) return undefined;
  return {
    company: field(company.text, company),
    title: field(title.text, title),
    bullets: [],
  };
}

function parseDateRange(
  text: string,
  block: ResumeBlock,
): Pick<IngestedExperience, 'start' | 'end'> | undefined {
  const date = String.raw`(?:[A-Za-z]{3,9}\s+\d{4}|\d{4}(?:-\d{2})?|PRESENT|CURRENT)`;
  const match = text.match(new RegExp(`^(${date})\\s+(?:-|–|—|to)\\s+(${date})$`, 'i'));
  if (!match?.[1] || !match[2]) return undefined;
  return {
    start: field(match[1], block),
    end: field(match[2], block),
  };
}

function bulletText(text: string): string | null {
  if (!/^\s*[•*▪◦●·-]\s+/.test(text)) return null;
  return normalizeWhitespace(text.replace(/^\s*[•*▪◦●·-]\s+/, ''));
}

function field(value: string, block: ResumeBlock): SourcedField {
  return { value: normalizeWhitespace(value), source: block.source };
}

function emailFrom(text: string): string | undefined {
  return text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0];
}

function phoneFrom(text: string): string | undefined {
  return text.match(/(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}/)?.[0];
}

function nameFromHeader(text: string): string {
  const beforeLetterSpacedTitle = text.match(/^(.*?[a-z])(?=[A-Z](?:\s+[A-Z]){2,}(?:\s|$))/);
  return normalizeWhitespace(beforeLetterSpacedTitle?.[1] ?? text);
}

function profileLink(text: string, host: 'linkedin.com' | 'github.com'): string | undefined {
  const escaped = host.replace('.', '\\.');
  const match = text.match(new RegExp(`(?:https?://)?(?:www\\.)?${escaped}/[^\\s,;")]+`, 'i'))?.[0];
  if (!match) return undefined;
  return /^https?:\/\//i.test(match) ? match : `https://${match}`;
}

function educationParts(text: string): string[] {
  const piped = text.split('|').map(normalizeWhitespace).filter(Boolean);
  if (piped.length > 1) return piped;
  const exactCoursework = text.match(/^(.*?)\s+(Computer Science Coursework)$/i);
  if (exactCoursework?.[1] && exactCoursework[2]) {
    return [normalizeWhitespace(exactCoursework[1]), normalizeWhitespace(exactCoursework[2])];
  }
  const credential = text.match(
    /^(.*?)\s+([A-Za-z][A-Za-z. ]+(?:Degree|Coursework|Certificate))$/i,
  );
  if (credential?.[1] && credential[2]) {
    return [normalizeWhitespace(credential[1]), normalizeWhitespace(credential[2])];
  }
  return [normalizeWhitespace(text)];
}

function normalizeHeading(text: string): string {
  return normalizeWhitespace(text.replace(/:$/, '').replace(/^[—–-]+\s*/, '')).replace(
    /\b(?:[A-Z]\s+){2,}[A-Z]\b/g,
    (letters) => letters.replace(/\s+/g, ''),
  );
}

function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .flatMap((line) => line.split(/\t+/))
    .map(normalizeWhitespace)
    .filter(Boolean);
}

function rangeLocator(blocks: ResumeBlock[]): string {
  const first = blocks[0]?.source.locator ?? 'unknown';
  const last = blocks.at(-1)?.source.locator ?? first;
  return first === last ? first : `${first}..${last}`;
}

function resumeLocator(file: string, locator: string): SourceLocator {
  return { source: 'resume', file, locator };
}

function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
