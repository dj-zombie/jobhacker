import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import { type Profile, profileSchema } from '../config/schemas.js';
import { sha256 } from '../util/hash.js';
import { normalizeWhitespace } from '../util/text.js';
import { ingestLinkedIn } from './linkedin.js';
import { ingestResume } from './resume.js';
import {
  IngestError,
  type IngestedEducation,
  type IngestedExperience,
  type IngestedProfileData,
  type IngestedProject,
  type SourceInput,
  type SourceLocator,
  type SourcedField,
  type SourcedText,
  sourceLocatorSchema,
} from './types.js';

export const SOURCE_REPORT_VERSION = 1;

export const profileSourceReportSchema = z
  .object({
    version: z.literal(SOURCE_REPORT_VERSION),
    profile_file: z.string().min(1),
    inputs: z
      .array(
        z
          .object({
            file: z.string().min(1),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .min(1),
    bullets: z.array(
      z
        .object({
          id: z.string().min(1),
          text: z.string().min(1),
          sources: z.array(sourceLocatorSchema).min(1),
        })
        .strict(),
    ),
    warnings: z.array(z.string()),
  })
  .strict();

export type ProfileSourceReport = z.infer<typeof profileSourceReportSchema>;

export interface BuildProfileOptions {
  inputDir?: string;
  configDir?: string;
  resumeFile?: string;
  linkedinDir?: string;
  force?: boolean;
}

export interface BuildProfileResult {
  profileFile: string;
  sourceReportFile: string;
  profile: Profile;
  report: ProfileSourceReport;
}

export interface ProfileCheckResult {
  bulletCount: number;
  unsourcedBulletIds: string[];
  paraphrasedBulletIds: string[];
  inputErrors: string[];
  archiveWarnings: string[];
  skillAllowlistSize: number;
  needsInput: string[];
  unresolvedConflicts: string[];
  ready: boolean;
}

interface MergeResult {
  profile: Profile;
  report: ProfileSourceReport;
}

/**
 * Build a deterministic draft from local inputs. This never reads profile.yaml,
 * never calls an LLM, and never overwrites profile.yaml.
 */
export async function buildProfileDraft(
  options: BuildProfileOptions = {},
): Promise<BuildProfileResult> {
  const inputDir = options.inputDir ?? 'input';
  const configDir = options.configDir ?? 'config';
  const resumeFile = options.resumeFile ?? discoverResume(inputDir);
  const linkedinDir = options.linkedinDir ?? join(inputDir, 'linkedin');
  if (!existsSync(linkedinDir)) {
    throw new IngestError(`LinkedIn archive directory not found: ${linkedinDir}`);
  }

  const profileFile = join(configDir, 'profile.draft.yaml');
  const sourceReportFile = join(configDir, 'profile.draft.sources.yaml');
  if (!options.force && (existsSync(profileFile) || existsSync(sourceReportFile))) {
    throw new IngestError(
      `draft already exists. Refusing to overwrite ${profileFile}; re-run profile:build with --force`,
    );
  }

  const [resume, linkedin] = await Promise.all([
    ingestResume(resumeFile),
    Promise.resolve(ingestLinkedIn(linkedinDir)),
  ]);
  const merged = mergeProfileData(resume, linkedin, profileFile);

  mkdirSync(configDir, { recursive: true });
  writeFileSync(profileFile, stringifyYaml(merged.profile, { lineWidth: 0 }), 'utf8');
  writeFileSync(sourceReportFile, stringifyYaml(merged.report, { lineWidth: 0 }), 'utf8');
  return { profileFile, sourceReportFile, ...merged };
}

export function mergeProfileData(
  resume: IngestedProfileData,
  linkedin: IngestedProfileData,
  profileFile = 'config/profile.draft.yaml',
): MergeResult {
  const warnings = [...resume.warnings, ...linkedin.warnings];
  const profile: Profile = {
    contact: {
      name: mergeField('contact.name', resume.contact.name, linkedin.contact.name, warnings),
      email: mergeField('contact.email', resume.contact.email, linkedin.contact.email, warnings),
      phone: mergePhoneField(resume.contact.phone, linkedin.contact.phone, warnings),
      location: mergeField(
        'contact.location',
        resume.contact.location,
        linkedin.contact.location,
        warnings,
      ),
    },
    links: {},
    summary: mergeField('summary', resume.summary, linkedin.summary, warnings),
    skills: {
      imported: uniqueText([...resume.skills, ...linkedin.skills].map((skill) => skill.text)),
    },
    experience: [],
    projects: [],
    education: [],
    standard_answers: {
      work_authorization_us: '[NEEDS INPUT: confirm US work authorization]',
      require_sponsorship: '[NEEDS INPUT: confirm sponsorship requirement]',
      willing_to_relocate: '[NEEDS INPUT: relocation preference]',
      earliest_start_date: '[NEEDS INPUT: earliest start date]',
      salary_expectation: '[NEEDS INPUT: salary expectation]',
      how_did_you_hear: '[NEEDS INPUT: application source answer]',
    },
  };

  addLink(profile.links, 'linkedin', resume.links.linkedin, linkedin.links.linkedin, warnings);
  addLink(profile.links, 'github', resume.links.github, linkedin.links.github, warnings);
  addLink(profile.links, 'portfolio', resume.links.portfolio, linkedin.links.portfolio, warnings);

  const experiences = mergeExperiences(resume.experience, linkedin.experience, warnings);
  profile.experience = experiences.map((experience) => {
    const company = mergeCompanyField(
      experience.resume?.company,
      experience.linkedin?.company,
      warnings,
    );
    const title = requiredField(
      'experience.title',
      experience.resume?.title,
      experience.linkedin?.title,
      warnings,
    );
    const start = mergeDateField(
      'experience.start',
      experience.resume?.start,
      experience.linkedin?.start,
      warnings,
    );
    const end = mergeDateField(
      'experience.end',
      experience.resume?.end,
      experience.linkedin?.end,
      warnings,
    );
    const id = stableId(
      'exp',
      entityIdentity(
        [
          experience.resume?.company,
          experience.resume?.title,
          experience.resume?.start,
          experience.linkedin?.company,
          experience.linkedin?.title,
          experience.linkedin?.start,
        ],
        `${company}\n${title}\n${start}`,
      ),
    );
    return {
      id,
      company,
      title,
      start,
      end,
      location: optionalField(
        'experience.location',
        experience.resume?.location,
        experience.linkedin?.location,
        warnings,
      ),
      bullets: profileBullets([
        ...(experience.resume?.bullets ?? []),
        ...(experience.resumeClaims ?? []),
        ...(experience.linkedin?.bullets ?? []),
      ]),
    };
  });

  const projects = mergeProjects(resume.projects, linkedin.projects);
  profile.projects = projects.map((project) => {
    const name = requiredField(
      'project.name',
      project.resume?.name,
      project.linkedin?.name,
      warnings,
    );
    const id = stableId(
      'project',
      entityIdentity([project.resume?.name, project.linkedin?.name], name),
    );
    const url = optionalField('project.url', project.resume?.url, project.linkedin?.url, warnings);
    return {
      id,
      name,
      ...(url && /^https?:\/\//i.test(url) ? { url } : {}),
      bullets: profileBullets([
        ...(project.resume?.bullets ?? []),
        ...(project.linkedin?.bullets ?? []),
      ]),
    };
  });

  profile.education = mergeEducation(resume.education, linkedin.education).map((education) => {
    const school = requiredField(
      'education.school',
      education.resume?.school,
      education.linkedin?.school,
      warnings,
    );
    return {
      id: stableId(
        'education',
        entityIdentity([education.resume?.school, education.linkedin?.school], school),
      ),
      school,
      credential: optionalField(
        'education.credential',
        education.resume?.credential,
        education.linkedin?.credential,
        warnings,
      ),
      start: optionalField(
        'education.start',
        education.resume?.start,
        education.linkedin?.start,
        warnings,
      ),
      end: optionalField('education.end', education.resume?.end, education.linkedin?.end, warnings),
    };
  });

  const parsedProfile = profileSchema.parse(profile);
  const bullets = allProfileBullets(parsedProfile).map((bullet) => ({
    id: bullet.id,
    text: bullet.text,
    sources: bullet.sources ?? [],
  }));
  const report = profileSourceReportSchema.parse({
    version: SOURCE_REPORT_VERSION,
    profile_file: profileFile,
    inputs: dedupeInputs([...resume.inputs, ...linkedin.inputs]),
    bullets,
    warnings: uniqueText(warnings),
  });
  return { profile: parsedProfile, report };
}

export function checkProfileSources(
  profile: Profile,
  report: ProfileSourceReport,
  options: { verifyInputFiles?: boolean } = {},
): ProfileCheckResult {
  const reportById = new Map(report.bullets.map((bullet) => [bullet.id, bullet]));
  const inputFiles = new Set(report.inputs.map((input) => input.file));
  const unsourcedBulletIds: string[] = [];
  const paraphrasedBulletIds: string[] = [];
  const bullets = allProfileBullets(profile);

  for (const bullet of bullets) {
    const source = reportById.get(bullet.id);
    if (
      !bullet.sources ||
      bullet.sources.length === 0 ||
      !source ||
      !bullet.sources.every(
        (locator) => inputFiles.has(locator.file) && hasValidLocatorShape(locator),
      )
    ) {
      unsourcedBulletIds.push(bullet.id);
      continue;
    }
    if (
      normalizeWhitespace(bullet.text) !== normalizeWhitespace(source.text) ||
      locatorKey(bullet.sources) !== locatorKey(source.sources)
    ) {
      paraphrasedBulletIds.push(bullet.id);
    }
  }

  const inputErrors: string[] = [];
  if (options.verifyInputFiles !== false) {
    for (const input of report.inputs) {
      if (!existsSync(input.file)) {
        inputErrors.push(`${input.file}: source file missing`);
        continue;
      }
      const actual = hashFile(input.file);
      if (actual !== input.sha256) inputErrors.push(`${input.file}: source file changed`);
    }
  }

  const serialized = stringifyYaml(profile, { lineWidth: 0 });
  const needsInput = uniqueText(serialized.match(/\[NEEDS INPUT[^\]]*\]/gi) ?? []);
  const unresolvedConflicts = needsInput.filter((marker) => /resolve conflict/i.test(marker));
  const archiveWarnings = report.warnings.filter((warning) =>
    [
      'Profile.csv',
      'Positions.csv',
      'Skills.csv',
      'Projects.csv',
      'Education.csv',
      'Recommendations_Received.csv',
    ].some((file) => warning === `${file}: file missing`),
  );
  const skills = new Set(
    Object.values(profile.skills)
      .flat()
      .map((skill) => normalizeWhitespace(skill).toLowerCase()),
  );
  const ready =
    bullets.length > 0 &&
    unsourcedBulletIds.length === 0 &&
    paraphrasedBulletIds.length === 0 &&
    inputErrors.length === 0 &&
    unresolvedConflicts.length === 0;

  return {
    bulletCount: bullets.length,
    unsourcedBulletIds,
    paraphrasedBulletIds,
    inputErrors,
    archiveWarnings,
    skillAllowlistSize: skills.size,
    needsInput,
    unresolvedConflicts,
    ready,
  };
}

export function checkProfileFiles(
  profileFile = 'config/profile.draft.yaml',
  sourceReportFile = 'config/profile.draft.sources.yaml',
): ProfileCheckResult {
  const profile = readYaml(profileFile, profileSchema);
  const report = readYaml(sourceReportFile, profileSourceReportSchema);
  return checkProfileSources(profile, report);
}

function readYaml<S extends z.ZodTypeAny>(file: string, schema: S): z.output<S> {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new IngestError(`file not found: ${file}`);
  }
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new IngestError(
      `YAML parse error in ${file}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new IngestError(
      `invalid ${file}:\n${parsed.error.issues
        .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('\n')}`,
    );
  }
  return parsed.data;
}

function discoverResume(inputDir: string): string {
  if (!existsSync(inputDir)) throw new IngestError(`input directory not found: ${inputDir}`);
  const matches = readdirSync(inputDir)
    .filter((name) => /^resume\.(?:pdf|docx)$/i.test(name))
    .map((name) => join(inputDir, name));
  if (matches.length === 0) {
    throw new IngestError(`no resume found in ${inputDir}; expected resume.pdf or resume.docx`);
  }
  if (matches.length > 1) {
    throw new IngestError(
      `multiple resumes found in ${inputDir}: ${matches.map((file) => basename(file)).join(', ')}`,
    );
  }
  return matches[0]!;
}

function mergeField(
  label: string,
  left: SourcedField | undefined,
  right: SourcedField | undefined,
  warnings: string[],
): string {
  if (!left && !right) return `[NEEDS INPUT: ${label}]`;
  if (!left) return right!.value;
  if (!right) return left.value;
  if (sameText(left.value, right.value)) return left.value;
  warnings.push(`${label}: resume/LinkedIn conflict`);
  return `[NEEDS INPUT: resolve conflict for ${label} — resume says "${left.value}"; LinkedIn says "${right.value}"]`;
}

function requiredField(
  label: string,
  left: SourcedField | undefined,
  right: SourcedField | undefined,
  warnings: string[],
): string {
  return mergeField(label, left, right, warnings);
}

function mergePhoneField(
  left: SourcedField | undefined,
  right: SourcedField | undefined,
  warnings: string[],
): string {
  if (left && right && normalizedUsPhone(left.value) === normalizedUsPhone(right.value)) {
    return left.value;
  }
  return mergeField('contact.phone', left, right, warnings);
}

function mergeCompanyField(
  left: SourcedField | undefined,
  right: SourcedField | undefined,
  warnings: string[],
): string {
  if (left && right && entityKey(left.value) === entityKey(right.value)) return left.value;
  return mergeField('experience.company', left, right, warnings);
}

function mergeDateField(
  label: string,
  left: SourcedField | undefined,
  right: SourcedField | undefined,
  warnings: string[],
): string {
  if (left && right) {
    const leftYear = yearOnly(left.value);
    const rightYear = yearOnly(right.value);
    if (leftYear && dateYear(right.value) === leftYear) return right.value;
    if (rightYear && dateYear(left.value) === rightYear) return left.value;
  }
  return mergeField(label, left, right, warnings);
}

function optionalField(
  label: string,
  left: SourcedField | undefined,
  right: SourcedField | undefined,
  warnings: string[],
): string | undefined {
  if (!left && !right) return undefined;
  return mergeField(label, left, right, warnings);
}

function addLink(
  target: Profile['links'],
  key: keyof Profile['links'],
  left: SourcedField | undefined,
  right: SourcedField | undefined,
  warnings: string[],
): void {
  const value = optionalField(`links.${key}`, left, right, warnings);
  if (value && /^https?:\/\//i.test(value)) target[key] = value;
}

interface ExperiencePair {
  resume?: IngestedExperience;
  linkedin?: IngestedExperience;
  /** Resume claims assigned by an exact text match to one LinkedIn position. */
  resumeClaims?: SourcedText[];
}

function mergeExperiences(
  resume: IngestedExperience[],
  linkedin: IngestedExperience[],
  warnings: string[],
): ExperiencePair[] {
  const pairs: ExperiencePair[] = linkedin.map((entry) => ({ linkedin: entry }));
  const ambiguous = resume.filter(isAssignmentPlaceholder);
  const regular = resume.filter((entry) => !isAssignmentPlaceholder(entry));

  for (const entry of ambiguous) {
    const unmatched: SourcedText[] = [];
    for (const claim of entry.bullets) {
      const matches = pairs.filter((pair) =>
        pair.linkedin?.bullets.some((bullet) => sameText(bullet.text, claim.text)),
      );
      if (matches.length === 1) {
        const match = matches[0]!;
        const assigned = match.resumeClaims ?? [];
        assigned.push(claim);
        match.resumeClaims = assigned;
      } else {
        unmatched.push(claim);
      }
    }
    if (unmatched.length > 0) {
      pairs.push({ resume: { ...entry, bullets: unmatched } });
    }
  }

  for (const entry of regular) {
    const sameCompany = pairs.filter(
      (pair) =>
        !pair.resume &&
        pair.linkedin &&
        sameEntity(entry.company?.value, pair.linkedin.company?.value),
    );
    const sameTitle = sameCompany.filter(
      (pair) =>
        pair.linkedin &&
        (!entry.title?.value ||
          !pair.linkedin.title?.value ||
          sameEntity(entry.title.value, pair.linkedin.title.value)),
    );
    const sameDates = sameCompany.filter(
      (pair) =>
        pair.linkedin &&
        (sameEntity(entry.start?.value, pair.linkedin.start?.value) ||
          sameEntity(entry.end?.value, pair.linkedin.end?.value)),
    );
    const exact = sameTitle.find((pair) => sameDates.includes(pair));
    // If each source has only one unmatched role at a company, pair them even
    // when title/dates disagree so the conflict stays visible instead of
    // becoming two apparently independent jobs.
    const match =
      exact ??
      (sameTitle.length === 1 ? sameTitle[0] : undefined) ??
      (sameDates.length === 1 ? sameDates[0] : undefined) ??
      (sameCompany.length === 1 ? sameCompany[0] : undefined);
    if (match) match.resume = entry;
    else pairs.push({ resume: entry });
  }
  if (
    resume.length > 0 &&
    linkedin.length > 0 &&
    pairs.length === resume.length + linkedin.length
  ) {
    warnings.push('experience: no resume entries matched LinkedIn positions');
  }
  return pairs;
}

function isAssignmentPlaceholder(experience: IngestedExperience): boolean {
  return Boolean(
    experience.company?.value.includes('[NEEDS INPUT: resolve conflict — assign resume claims'),
  );
}

interface ProjectPair {
  resume?: IngestedProject;
  linkedin?: IngestedProject;
}

function mergeProjects(resume: IngestedProject[], linkedin: IngestedProject[]): ProjectPair[] {
  const pairs: ProjectPair[] = linkedin.map((entry) => ({ linkedin: entry }));
  for (const entry of resume) {
    const match = pairs.find(
      (pair) =>
        !pair.resume && pair.linkedin && sameEntity(entry.name?.value, pair.linkedin.name?.value),
    );
    if (match) match.resume = entry;
    else pairs.push({ resume: entry });
  }
  return pairs;
}

interface EducationPair {
  resume?: IngestedEducation;
  linkedin?: IngestedEducation;
}

function mergeEducation(
  resume: IngestedEducation[],
  linkedin: IngestedEducation[],
): EducationPair[] {
  const pairs: EducationPair[] = linkedin.map((entry) => ({ linkedin: entry }));
  for (const entry of resume) {
    const match = pairs.find(
      (pair) =>
        !pair.resume &&
        pair.linkedin &&
        sameEntity(entry.school?.value, pair.linkedin.school?.value),
    );
    if (match) match.resume = entry;
    else pairs.push({ resume: entry });
  }
  return pairs;
}

function profileBullets(
  claims: Array<{ text: string; source: SourceLocator }>,
): Profile['experience'][number]['bullets'] {
  const grouped = new Map<string, { text: string; sources: SourceLocator[] }>();
  for (const claim of claims) {
    const text = normalizeWhitespace(claim.text);
    if (!text) continue;
    const key = text.toLowerCase();
    const existing = grouped.get(key);
    if (existing) {
      if (!existing.sources.some((source) => locatorKey([source]) === locatorKey([claim.source]))) {
        existing.sources.push(claim.source);
      }
    } else {
      grouped.set(key, { text, sources: [claim.source] });
    }
  }
  return [...grouped.values()].map((claim) => ({
    id: stableId('bullet', `${locatorKey(claim.sources)}\n${claim.text}`),
    text: claim.text,
    sources: claim.sources,
  }));
}

function allProfileBullets(
  profile: Profile,
): Array<Profile['experience'][number]['bullets'][number]> {
  return [
    ...profile.experience.flatMap((experience) => experience.bullets),
    ...profile.projects.flatMap((project) => project.bullets),
  ];
}

function stableId(prefix: string, basis: string): string {
  return `${prefix}-${sha256(normalizeWhitespace(basis).toLowerCase()).slice(0, 14)}`;
}

function entityIdentity(fields: Array<SourcedField | undefined>, fallback: string): string {
  const sources = fields.flatMap((field) => (field ? [field.source] : []));
  return sources.length > 0 ? locatorKey(sources) : fallback;
}

function sameEntity(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && entityKey(left) === entityKey(right));
}

function sameText(left: string, right: string): boolean {
  return normalizeWhitespace(left).toLowerCase() === normalizeWhitespace(right).toLowerCase();
}

function entityKey(value: string): string {
  return normalizeWhitespace(value)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\b(?:incorporated|inc|llc|ltd|limited|corporation|corp|company|co)\b/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function normalizedUsPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function yearOnly(value: string): string | undefined {
  return /^\d{4}$/.test(value.trim()) ? value.trim() : undefined;
}

function dateYear(value: string): string | undefined {
  return value.match(/\b\d{4}\b/)?.[0];
}

function uniqueText(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = normalizeWhitespace(value);
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

function dedupeInputs(inputs: SourceInput[]): SourceInput[] {
  const byFile = new Map<string, SourceInput>();
  for (const input of inputs) byFile.set(input.file, input);
  return [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file));
}

function locatorKey(locators: readonly SourceLocator[]): string {
  return [...locators]
    .map((source) => `${source.source}|${source.file}|${source.locator}`)
    .sort()
    .join('\n');
}

function hasValidLocatorShape(source: SourceLocator): boolean {
  if (source.source === 'resume') {
    return /^(?:page:\d+:line:\d+|paragraph:\d+|line:\d+)$/.test(source.locator);
  }
  return /^[^:]+\.csv:row:\d+:.+$/i.test(source.locator);
}

function hashFile(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
