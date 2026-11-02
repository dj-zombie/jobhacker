import { z } from 'zod';

export class IngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestError';
  }
}

/** A local, machine-checkable pointer to the exact imported claim. */
export const sourceLocatorSchema = z
  .object({
    source: z.enum(['resume', 'linkedin']),
    file: z.string().min(1),
    locator: z.string().min(1),
  })
  .strict();

export type SourceLocator = z.infer<typeof sourceLocatorSchema>;

export interface SourceInput {
  file: string;
  sha256: string;
}

export interface SourcedField {
  value: string;
  source: SourceLocator;
}

export interface SourcedText {
  text: string;
  source: SourceLocator;
}

export interface IngestedExperience {
  company?: SourcedField;
  title?: SourcedField;
  start?: SourcedField;
  end?: SourcedField;
  location?: SourcedField;
  bullets: SourcedText[];
}

export interface IngestedProject {
  name?: SourcedField;
  url?: SourcedField;
  start?: SourcedField;
  end?: SourcedField;
  bullets: SourcedText[];
}

export interface IngestedEducation {
  school?: SourcedField;
  credential?: SourcedField;
  start?: SourcedField;
  end?: SourcedField;
}

export interface IngestedProfileData {
  inputs: SourceInput[];
  contact: {
    name?: SourcedField;
    email?: SourcedField;
    phone?: SourcedField;
    location?: SourcedField;
  };
  links: {
    linkedin?: SourcedField;
    github?: SourcedField;
    portfolio?: SourcedField;
  };
  summary?: SourcedField;
  skills: SourcedText[];
  experience: IngestedExperience[];
  projects: IngestedProject[];
  education: IngestedEducation[];
  warnings: string[];
}

export function emptyIngestedProfileData(): IngestedProfileData {
  return {
    inputs: [],
    contact: {},
    links: {},
    skills: [],
    experience: [],
    projects: [],
    education: [],
    warnings: [],
  };
}
