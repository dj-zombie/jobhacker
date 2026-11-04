import { z } from 'zod';

/**
 * Zod schemas for the config files. The `*.example.*` files are the human
 * documentation for these shapes; keep them in sync (ARCHITECTURE § Config).
 * Taste lives in prose in `preferences.md` (no schema, FR-12); the v1 keyword
 * shape of `criteria.yaml` is in `migrate.ts` and is converted by `config:migrate`.
 */

// ---------------------------------------------------------------------------
// criteria.yaml — gates, weights, bands, budget, models (PHASE2 § What changes)
// ---------------------------------------------------------------------------

/** The six scored dimensions, in display order (PHASE2 § What changes, 2). */
export const DIMENSIONS = [
  'role_fit',
  'tech_fit',
  'domain_interest',
  'seniority_fit',
  'logistics_fit',
  'comp_fit',
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

const weight = z.number().int().min(0).max(10);

export const weightsSchema = z
  .object({
    role_fit: weight,
    tech_fit: weight,
    domain_interest: weight,
    seniority_fit: weight,
    logistics_fit: weight,
    comp_fit: weight,
  })
  .strict()
  .refine((weights) => DIMENSIONS.some((dimension) => weights[dimension] > 0), {
    message: 'at least one ranking weight must be greater than 0',
  });
export type Weights = z.infer<typeof weightsSchema>;

export const bandsSchema = z
  .object({
    strong: z.number().int().min(0).max(100),
    /** Must leave at least score 0 in the `no` band for critical-dimension caps. */
    maybe: z.number().int().min(1).max(100),
  })
  .strict()
  .refine((b) => b.strong >= b.maybe, {
    message: 'bands.strong must be >= bands.maybe',
    path: ['strong'],
  });
export type Bands = z.infer<typeof bandsSchema>;

/** Board ATSs from `docs/SOURCES.md`. Workday is allowed but not implemented. */
export const BOARD_ATS = [
  'greenhouse',
  'lever',
  'ashby',
  'smartrecruiters',
  'breezy',
  'polymer',
  'workable',
  'teamtailor',
  'workday',
] as const;

/** Search sources. */
export const SEARCH_ATS = ['jsearch', 'jobspipe', 'hn'] as const;

const searchSourceSchema = z
  .object({
    enabled: z.boolean(),
    monthly_call_budget: z.number().int().nonnegative(),
  })
  .strict();

/**
 * JobsPipe is also capped in credits. The default keeps a `criteria.yaml`
 * written before J16 valid. The object stays strict: an unknown key still fails.
 */
const jobspipeSourceSchema = searchSourceSchema
  .extend({
    monthly_credit_budget: z.number().int().nonnegative().default(0),
  })
  .strict();

export const sourcesSchema = z
  .object({
    boards: z
      .object({
        enabled: z.array(z.enum(BOARD_ATS)).min(1),
      })
      .strict(),
    search: z
      .object({
        jsearch: searchSourceSchema,
        jobspipe: jobspipeSourceSchema,
        hn: searchSourceSchema,
      })
      .strict(),
    workday: z
      .object({
        enabled: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type SourcesConfig = z.infer<typeof sourcesSchema>;

/** Used when `criteria.yaml` has no `sources:` block. Keeps older tests on the three original boards. */
export const LEGACY_SOURCES: SourcesConfig = {
  boards: { enabled: ['greenhouse', 'lever', 'ashby'] },
  search: {
    jsearch: { enabled: false, monthly_call_budget: 0 },
    jobspipe: { enabled: false, monthly_call_budget: 0, monthly_credit_budget: 0 },
    hn: { enabled: false, monthly_call_budget: 0 },
  },
  workday: { enabled: false },
};

/** The area id for remote roles (`pipeline/places.ts` `REMOTE`). */
export const REMOTE_AREA = 'remote';
/** The Where value that shows every job past the gates. Never an area. */
export const ANYWHERE = 'anywhere';

/**
 * One of Kris's places (PLACES § 2). Geography, not taste: the classifier
 * parses city and state and compares whole names, never substrings.
 */
export const placeSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_-]*$/, 'must be a lowercase id, like "portland"'),
    label: z.string().min(1),
    /** Shown as a hint next to the filter, e.g. "Hybrid only". */
    note: z.string().min(1).optional(),
    cities: z.array(z.string().min(1)).min(1),
    states: z.array(z.string().min(1)).min(1),
    /** "City, ST" pairs outside the main state, e.g. "Vancouver, WA" for Portland. */
    extra: z.array(z.string().regex(/^[^,]+,[^,]+$/, 'must be "City, ST"')).optional(),
    aliases: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type PlaceConfig = z.infer<typeof placeSchema>;

export const criteriaSchema = z
  .object({
    gates: z
      .object({
        /** Gate postings first published more than this many days ago; 0 turns the gate off. */
        max_age_days: z.number().int().nonnegative(),
        company_blocklist: z.array(z.string().min(1)).default([]),
      })
      .strict(),
    weights: weightsSchema,
    bands: bandsSchema,
    budget: z
      .object({
        /** Compatibility field during P2-1 correction. Prescore may order but never exclude. */
        prescore_floor: z.literal(0).default(0),
        max_new_scores_per_run: z.number().int().positive(),
      })
      .strict(),
    llm: z
      .object({
        scoring_model: z.string().min(1),
        writing_model: z.string().min(1),
      })
      .strict(),
    /** Absent on older files. Scout then uses `LEGACY_SOURCES`. */
    sources: sourcesSchema.optional(),
    /**
     * Kris's places (PLACES § 2). A view filter and a scoring order, never a
     * gate (invariant 8). Absent on older files: no job is in a place.
     */
    places: z.array(placeSchema).optional(),
    /** Remote roles open to these countries, or naming none, count as Remote. Absent: none do. */
    remote: z
      .object({
        countries: z.array(z.string().min(1)),
      })
      .strict()
      .optional(),
    /** The areas the Where filter and scoring start from. Absent or empty: anywhere. */
    where_default: z.array(z.string().min(1)).optional(),
  })
  .strict()
  .superRefine((criteria, ctx) => {
    const ids = new Set<string>();
    for (const [i, place] of (criteria.places ?? []).entries()) {
      if (place.id === REMOTE_AREA || place.id === ANYWHERE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${place.id}" is reserved and can't be a place id`,
          path: ['places', i, 'id'],
        });
      }
      if (ids.has(place.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate place id "${place.id}"`,
          path: ['places', i, 'id'],
        });
      }
      ids.add(place.id);
    }
    for (const [i, area] of (criteria.where_default ?? []).entries()) {
      if (area !== REMOTE_AREA && !ids.has(area)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${area}" is not a place id or "${REMOTE_AREA}"`,
          path: ['where_default', i],
        });
      }
    }
  });

export type Criteria = z.infer<typeof criteriaSchema>;

// ---------------------------------------------------------------------------
// profile.yaml
// ---------------------------------------------------------------------------

const profileSourceSchema = z
  .object({
    source: z.enum(['resume', 'linkedin']),
    file: z.string().min(1),
    locator: z.string().min(1),
  })
  .strict();

const bulletSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    /** Optional for hand-written legacy profiles; required by profile:check for ingested drafts. */
    sources: z.array(profileSourceSchema).min(1).optional(),
  })
  .strict();

const experienceSchema = z
  .object({
    id: z.string().min(1),
    company: z.string().min(1),
    title: z.string().min(1),
    start: z.string().min(1),
    end: z.string().min(1),
    location: z.string().optional(),
    bullets: z.array(bulletSchema).default([]),
  })
  .strict();

const projectSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    url: z.string().url().optional(),
    bullets: z.array(bulletSchema).default([]),
  })
  .strict();

const educationSchema = z
  .object({
    id: z.string().min(1),
    school: z.string().min(1),
    credential: z.string().optional(),
    start: z.string().optional(),
    end: z.string().optional(),
  })
  .strict();

export const profileSchema = z
  .object({
    contact: z
      .object({
        name: z.string().min(1),
        email: z
          .string()
          .refine(
            (value) =>
              z.string().email().safeParse(value).success || /\[NEEDS INPUT[^\]]*\]/i.test(value),
            'must be an email address or a visible [NEEDS INPUT: …] marker',
          ),
        phone: z.string().min(1),
        location: z.string().min(1),
      })
      .strict(),
    links: z
      .object({
        linkedin: z.string().url().optional(),
        github: z.string().url().optional(),
        portfolio: z.string().url().optional(),
      })
      .strict()
      .default({}),
    summary: z.string().min(1),
    skills: z.record(z.string(), z.array(z.string().min(1))),
    experience: z.array(experienceSchema).default([]),
    projects: z.array(projectSchema).default([]),
    education: z.array(educationSchema).default([]),
    standard_answers: z.record(z.string(), z.string()).default({}),
    /**
     * Voluntary self-identification answers (invariant 7, D66). Filled
     * verbatim by `apply/self-id.ts`; never inferred, never sent to an LLM.
     * Absent block = decline everything.
     */
    self_identification: z
      .object({
        gender: z.string().min(1).default('decline'),
        race_ethnicity: z.string().min(1).default('decline'),
        veteran_status: z.string().min(1).default('decline'),
        disability_status: z.string().min(1).default('decline'),
        overrides: z.record(z.string(), z.string()).default({}),
      })
      .strict()
      .optional(),
    cover_note: z
      .object({
        tone: z.string().min(1),
        always_mention: z.array(z.string()).default([]),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((profile, ctx) => {
    const seen = new Set<string>();
    const allBullets = [
      ...profile.experience.flatMap((e) => e.bullets),
      ...profile.projects.flatMap((p) => p.bullets),
    ];
    for (const bullet of allBullets) {
      if (seen.has(bullet.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate bullet id "${bullet.id}" (bullet ids must be unique)`,
          path: ['experience'],
        });
      }
      seen.add(bullet.id);
    }
  });

export type Profile = z.infer<typeof profileSchema>;

// ---------------------------------------------------------------------------
// companies.yaml
// ---------------------------------------------------------------------------

/** Shared with the `companies.ats` and `jobs.ats` columns so the two cannot drift. */
export const atsSchema = z.enum([...BOARD_ATS, ...SEARCH_ATS]);
export type Ats = z.infer<typeof atsSchema>;
export type BoardAts = (typeof BOARD_ATS)[number];
export type SearchAts = (typeof SEARCH_ATS)[number];
export const ATS_VALUES = atsSchema.options;

export const companySchema = z
  .object({
    name: z.string().min(1),
    ats: atsSchema,
    token: z.string().min(1),
    active: z.boolean().default(true),
    tags: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const companiesSchema = z
  .object({
    companies: z.array(companySchema).default([]),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    const seen = new Set<string>();
    for (let i = 0; i < cfg.companies.length; i++) {
      const c = cfg.companies[i];
      if (!c) continue;
      const key = `${c.ats}:${c.token}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate board ${key} (ats + token must be unique)`,
          path: ['companies', i, 'token'],
        });
      }
      seen.add(key);
    }
  });

/** A `companies.yaml` entry. The DB row type is `Company` in `db/schema.ts`. */
export type CompanyConfig = z.infer<typeof companySchema>;
export type Companies = z.infer<typeof companiesSchema>;

/** The prose taste document (FR-12). Loaded as text; it has no schema. */
export const PREFERENCES_FILE = 'preferences.md';

/** Registry of the three YAML config files: filename ↔ schema ↔ loaded type. */
export const configFiles = {
  criteria: { file: 'criteria.yaml', schema: criteriaSchema },
  profile: { file: 'profile.yaml', schema: profileSchema },
  companies: { file: 'companies.yaml', schema: companiesSchema },
} as const;

export type ConfigName = keyof typeof configFiles;
