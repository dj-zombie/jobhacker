import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { sha256 } from '../util/hash.js';
import { normalizeWhitespace } from '../util/text.js';
import {
  type IngestedEducation,
  type IngestedExperience,
  type IngestedProfileData,
  type IngestedProject,
  type SourceLocator,
  type SourcedField,
  emptyIngestedProfileData,
} from './types.js';

/**
 * LinkedIn's official archive is local CSV input, never scraped and never sent
 * to an LLM (D31/D47). Header aliases are deliberately lenient because export
 * column names change. Unknown columns are ignored; missing files/fields warn.
 */

interface CsvCell {
  header: string;
  value: string;
}

export interface CsvRow {
  /** One-based file row, including the header as row 1. */
  row: number;
  cells: Record<string, CsvCell>;
}

export interface ParsedCsv {
  rows: CsvRow[];
  warnings: string[];
}

const optionalText = z.string().optional();
const positionSchema = z
  .object({
    company: optionalText,
    title: optionalText,
    description: optionalText,
    start: optionalText,
    end: optionalText,
    location: optionalText,
  })
  .passthrough();
const projectSchema = z
  .object({
    name: optionalText,
    description: optionalText,
    url: optionalText,
    start: optionalText,
    end: optionalText,
  })
  .passthrough();
const educationSchema = z
  .object({
    school: optionalText,
    credential: optionalText,
    start: optionalText,
    end: optionalText,
  })
  .passthrough();

const MEMBER_NAMES = [
  'Profile.csv',
  'Positions.csv',
  'Skills.csv',
  'Projects.csv',
  'Education.csv',
  'Recommendations_Received.csv',
  'Email Addresses.csv',
  'PhoneNumbers.csv',
] as const;

type MemberName = (typeof MEMBER_NAMES)[number];

interface LoadedMember {
  name: MemberName;
  file: string;
  parsed: ParsedCsv;
}

/** RFC-4180 CSV parser with row numbers and original headers retained. */
export function parseCsv(text: string): ParsedCsv {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;

  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const ch = source[i] ?? '';
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\n') {
      record.push(field.replace(/\r$/, ''));
      records.push(record);
      record = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field.replace(/\r$/, ''));
    records.push(record);
  }

  const warnings: string[] = [];
  if (quoted) warnings.push('CSV ended inside a quoted field');
  const headers = records[0]?.map((header) => normalizeWhitespace(header)) ?? [];
  if (headers.length === 0 || headers.every((header) => header.length === 0)) {
    return { rows: [], warnings: [...warnings, 'CSV has no header row'] };
  }

  const rows: CsvRow[] = [];
  for (let i = 1; i < records.length; i++) {
    const values = records[i] ?? [];
    if (values.every((value) => value.trim().length === 0)) continue;
    if (values.length !== headers.length) {
      warnings.push(`row ${i + 1} has ${values.length} column(s); header has ${headers.length}`);
    }
    const cells: Record<string, CsvCell> = {};
    for (let column = 0; column < headers.length; column++) {
      const header = headers[column] ?? '';
      if (!header) continue;
      cells[normalizeHeader(header)] = {
        header,
        value: (values[column] ?? '').trim(),
      };
    }
    rows.push({ row: i + 1, cells });
  }
  return { rows, warnings };
}

export function ingestLinkedIn(dir: string): IngestedProfileData {
  const out = emptyIngestedProfileData();
  const members = new Map<MemberName, LoadedMember>();
  const discovered = discoverCsvFiles(dir);

  for (const name of MEMBER_NAMES) {
    const matches = discovered.get(name.toLowerCase()) ?? [];
    const file = matches[0];
    if (!file) {
      out.warnings.push(`${name}: file missing`);
      continue;
    }
    const text = readFileSync(file, 'utf8');
    if (
      matches.length > 1 &&
      new Set(matches.map((candidate) => sha256(readFileSync(candidate, 'utf8')))).size > 1
    ) {
      out.warnings.push(`${name}: multiple different copies found; using the shallowest path`);
    }
    const parsed = parseCsv(text);
    out.inputs.push({ file, sha256: sha256(text) });
    for (const warning of parsed.warnings) out.warnings.push(`${name}: ${warning}`);
    members.set(name, { name, file, parsed });
  }

  readProfile(members.get('Profile.csv'), out);
  readEmailAddresses(members.get('Email Addresses.csv'), out);
  readPhoneNumbers(members.get('PhoneNumbers.csv'), out);
  readPositions(members.get('Positions.csv'), out);
  readSkills(members.get('Skills.csv'), out);
  readProjects(members.get('Projects.csv'), out);
  readEducation(members.get('Education.csv'), out);
  readRecommendations(members.get('Recommendations_Received.csv'), out);
  return out;
}

function discoverCsvFiles(dir: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  if (!existsSync(dir)) return found;
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.csv')) {
        const key = entry.name.toLowerCase();
        const files = found.get(key) ?? [];
        files.push(path);
        files.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
        found.set(key, files);
      }
    }
  };
  visit(dir);
  return found;
}

function readProfile(member: LoadedMember | undefined, out: IngestedProfileData): void {
  const row = member?.parsed.rows[0];
  if (!member || !row) return;

  const fullName = pick(row, ['name', 'full name']);
  const first = pick(row, ['first name', 'firstname']);
  const last = pick(row, ['last name', 'lastname']);
  if (fullName?.value) {
    out.contact.name = sourcedField(fullName.value, member, row, fullName.header);
  } else if (first?.value || last?.value) {
    out.contact.name = sourcedField(
      normalizeWhitespace(`${first?.value ?? ''} ${last?.value ?? ''}`),
      member,
      row,
      [first?.header, last?.header].filter(Boolean).join('+'),
    );
  }
  addContact(out, 'email', pick(row, ['email address', 'email']), member, row);
  addContact(out, 'location', pick(row, ['geo location', 'location']), member, row);

  const summary = pick(row, ['summary', 'about', 'headline']);
  if (summary?.value) out.summary = sourcedField(summary.value, member, row, summary.header);

  const linkedIn = pick(row, ['public profile url', 'profile url', 'linkedin']);
  if (linkedIn?.value) {
    out.links.linkedin = sourcedField(linkedIn.value, member, row, linkedIn.header);
  }
  const websites = pick(row, ['websites', 'website']);
  for (const url of extractUrls(websites?.value ?? '')) {
    const locator = websites?.header ?? 'Websites';
    if (/github\.com/i.test(url) && !out.links.github) {
      out.links.github = sourcedField(url, member, row, locator);
    } else if (!out.links.portfolio) {
      out.links.portfolio = sourcedField(url, member, row, locator);
    }
  }
}

function readEmailAddresses(member: LoadedMember | undefined, out: IngestedProfileData): void {
  if (!member || out.contact.email) return;
  const row = member.parsed.rows[0];
  if (!row) return;
  const email = pick(row, ['email address', 'email']);
  if (email?.value) out.contact.email = sourcedField(email.value, member, row, email.header);
}

function readPhoneNumbers(member: LoadedMember | undefined, out: IngestedProfileData): void {
  if (!member || out.contact.phone) return;
  const row = member.parsed.rows[0];
  if (!row) return;
  const phone = pick(row, ['phone number', 'phone', 'number']);
  if (phone?.value) out.contact.phone = sourcedField(phone.value, member, row, phone.header);
}

function addContact(
  out: IngestedProfileData,
  key: 'email' | 'location',
  cell: CsvCell | undefined,
  member: LoadedMember,
  row: CsvRow,
): void {
  if (cell?.value) out.contact[key] = sourcedField(cell.value, member, row, cell.header);
}

function readPositions(member: LoadedMember | undefined, out: IngestedProfileData): void {
  if (!member) return;
  for (const row of member.parsed.rows) {
    const raw = {
      company: pickValue(row, ['company name', 'company', 'employer', 'organization']),
      title: pickValue(row, ['title', 'position title', 'job title', 'position']),
      description: pickValue(row, ['description', 'position description', 'job description']),
      start: pickValue(row, ['started on', 'start date', 'date started', 'from']),
      end: pickValue(row, ['finished on', 'end date', 'date finished', 'to']),
      location: pickValue(row, ['location', 'geo location']),
    };
    const parsed = positionSchema.parse(raw);
    const experience: IngestedExperience = {
      company: fieldFromAliases(row, member, parsed.company, [
        'company name',
        'company',
        'employer',
        'organization',
      ]),
      title: fieldFromAliases(row, member, parsed.title, [
        'title',
        'position title',
        'job title',
        'position',
      ]),
      start: fieldFromAliases(row, member, parsed.start, [
        'started on',
        'start date',
        'date started',
        'from',
      ]),
      end: fieldFromAliases(row, member, parsed.end, [
        'finished on',
        'end date',
        'date finished',
        'to',
      ]),
      location: fieldFromAliases(row, member, parsed.location, ['location', 'geo location']),
      bullets: [],
    };
    const description = pick(row, ['description', 'position description', 'job description']);
    for (const text of splitClaims(parsed.description ?? '')) {
      experience.bullets.push({
        text,
        source: locator(member, row, description?.header ?? 'Description'),
      });
    }
    if (!experience.company) {
      out.warnings.push(`${member.name}: row ${row.row} is missing company`);
    }
    if (!experience.title) out.warnings.push(`${member.name}: row ${row.row} is missing title`);
    out.experience.push(experience);
  }
}

function readSkills(member: LoadedMember | undefined, out: IngestedProfileData): void {
  if (!member) return;
  for (const row of member.parsed.rows) {
    const cell = pick(row, ['name', 'skill', 'skill name']);
    if (!cell?.value) {
      out.warnings.push(`${member.name}: row ${row.row} is missing skill name`);
      continue;
    }
    out.skills.push({
      text: normalizeWhitespace(cell.value),
      source: locator(member, row, cell.header),
    });
  }
}

function readProjects(member: LoadedMember | undefined, out: IngestedProfileData): void {
  if (!member) return;
  for (const row of member.parsed.rows) {
    const raw = {
      name: pickValue(row, ['title', 'project name', 'name']),
      description: pickValue(row, ['description', 'project description']),
      url: pickValue(row, ['url', 'project url', 'website']),
      start: pickValue(row, ['started on', 'start date', 'date started']),
      end: pickValue(row, ['finished on', 'end date', 'date finished']),
    };
    const parsed = projectSchema.parse(raw);
    const project: IngestedProject = {
      name: fieldFromAliases(row, member, parsed.name, ['title', 'project name', 'name']),
      url: fieldFromAliases(row, member, parsed.url, ['url', 'project url', 'website']),
      start: fieldFromAliases(row, member, parsed.start, [
        'started on',
        'start date',
        'date started',
      ]),
      end: fieldFromAliases(row, member, parsed.end, ['finished on', 'end date', 'date finished']),
      bullets: [],
    };
    const description = pick(row, ['description', 'project description']);
    for (const text of splitClaims(parsed.description ?? '')) {
      project.bullets.push({
        text,
        source: locator(member, row, description?.header ?? 'Description'),
      });
    }
    if (!project.name) out.warnings.push(`${member.name}: row ${row.row} is missing project name`);
    out.projects.push(project);
  }
}

function readEducation(member: LoadedMember | undefined, out: IngestedProfileData): void {
  if (!member) return;
  for (const row of member.parsed.rows) {
    const degree = pick(row, ['degree name', 'degree', 'credential']);
    const fieldOfStudy = pick(row, ['field of study', 'field']);
    const credentialText = [degree?.value, fieldOfStudy?.value].filter(Boolean).join(' — ');
    const raw = {
      school: pickValue(row, ['school name', 'school', 'institution']),
      credential: credentialText || undefined,
      start: pickValue(row, ['start date', 'started on', 'date started']),
      end: pickValue(row, ['end date', 'finished on', 'date finished']),
    };
    const parsed = educationSchema.parse(raw);
    const education: IngestedEducation = {
      school: fieldFromAliases(row, member, parsed.school, [
        'school name',
        'school',
        'institution',
      ]),
      credential: parsed.credential
        ? {
            value: parsed.credential,
            source: locator(
              member,
              row,
              [degree?.header, fieldOfStudy?.header].filter(Boolean).join('+'),
            ),
          }
        : undefined,
      start: fieldFromAliases(row, member, parsed.start, [
        'start date',
        'started on',
        'date started',
      ]),
      end: fieldFromAliases(row, member, parsed.end, ['end date', 'finished on', 'date finished']),
    };
    if (!education.school) {
      out.warnings.push(`${member.name}: row ${row.row} is missing school`);
    }
    out.education.push(education);
  }
}

function readRecommendations(member: LoadedMember | undefined, out: IngestedProfileData): void {
  if (!member || member.parsed.rows.length === 0) return;
  // Third-party recommendations are useful review evidence, but copying their
  // prose into first-person profile bullets would change the speaker/claim.
  out.warnings.push(
    `${member.name}: ${member.parsed.rows.length} recommendation row(s) retained in the source archive but not mapped to first-person profile claims`,
  );
}

function pick(row: CsvRow, aliases: readonly string[]): CsvCell | undefined {
  for (const alias of aliases) {
    const cell = row.cells[normalizeHeader(alias)];
    if (cell?.value) return cell;
  }
  return undefined;
}

function pickValue(row: CsvRow, aliases: readonly string[]): string | undefined {
  return pick(row, aliases)?.value || undefined;
}

function fieldFromAliases(
  row: CsvRow,
  member: LoadedMember,
  value: string | undefined,
  aliases: readonly string[],
): SourcedField | undefined {
  if (!value) return undefined;
  const cell = pick(row, aliases);
  return sourcedField(value, member, row, cell?.header ?? aliases[0] ?? 'unknown');
}

function sourcedField(
  value: string,
  member: LoadedMember,
  row: CsvRow,
  field: string,
): SourcedField {
  return {
    value: normalizeWhitespace(value),
    source: locator(member, row, field),
  };
}

function locator(member: LoadedMember, row: CsvRow, field: string): SourceLocator {
  return {
    source: 'linkedin',
    file: member.file,
    locator: `${basename(member.file)}:row:${row.row}:${field}`,
  };
}

function splitClaims(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line.replace(/^[\s•*▪◦●·-]+/, '')))
    .filter(Boolean);
}

function extractUrls(text: string): string[] {
  return text.match(/https?:\/\/[^\s,;")\]}]+/g) ?? [];
}

function normalizeHeader(header: string): string {
  return header
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}
