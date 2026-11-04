import { and, eq } from 'drizzle-orm';
import type { CompanyConfig } from '../../config/schemas.js';
import type { Ats } from '../../config/schemas.js';
import type { Clock } from '../../util/clock.js';
import type { Db } from '../client.js';
import { type Company, companies } from '../schema.js';

/** Upsert `companies.yaml` entries into the `companies` table. */
export function companiesRepo(db: Db, clock: Clock) {
  return {
    upsert(input: CompanyConfig): Company {
      const existing = db
        .select()
        .from(companies)
        .where(and(eq(companies.ats, input.ats), eq(companies.token, input.token)))
        .get();

      if (!existing) {
        const row = db
          .insert(companies)
          .values({
            name: input.name,
            ats: input.ats,
            token: input.token,
            active: input.active,
            tags: input.tags,
            createdAt: clock.now(),
          })
          .returning()
          .get();
        if (!row) throw new Error('failed to insert company');
        return row;
      }

      db.update(companies)
        .set({ name: input.name, active: input.active, tags: input.tags })
        .where(eq(companies.id, existing.id))
        .run();
      return { ...existing, name: input.name, active: input.active, tags: input.tags };
    },

    get(ats: Ats, token: string): Company | undefined {
      return db
        .select()
        .from(companies)
        .where(and(eq(companies.ats, ats), eq(companies.token, token)))
        .get();
    },

    /**
     * Set `active` on one board. Returns false when that ats + token is not in
     * the table. Jobs are left as they are.
     */
    setActive(ats: Ats, token: string, active: boolean): boolean {
      const existing = db
        .select()
        .from(companies)
        .where(and(eq(companies.ats, ats), eq(companies.token, token)))
        .get();
      if (!existing) return false;
      if (existing.active === active) return true;
      db.update(companies).set({ active }).where(eq(companies.id, existing.id)).run();
      return true;
    },

    /**
     * Deactivate any currently-active company whose board is no longer present in
     * `keep` (the boards in `companies.yaml` this run). Jobs are left untouched —
     * scout only closes jobs after a successful fetch, so a removed board's
     * postings keep their last-known state (Known issue [1]). Returns how many
     * companies were deactivated.
     */
    deactivateMissing(keep: ReadonlyArray<{ ats: Ats; token: string }>): number {
      const keepKeys = new Set(keep.map((k) => `${k.ats}:${k.token}`));
      const active = db
        .select({ id: companies.id, ats: companies.ats, token: companies.token })
        .from(companies)
        .where(eq(companies.active, true))
        .all();
      let deactivated = 0;
      for (const row of active) {
        // Search-source companies are created by scout, not companies.yaml.
        if (row.ats === 'hn' || row.ats === 'jsearch' || row.ats === 'jobspipe') continue;
        if (keepKeys.has(`${row.ats}:${row.token}`)) continue;
        db.update(companies).set({ active: false }).where(eq(companies.id, row.id)).run();
        deactivated += 1;
      }
      return deactivated;
    },
  };
}
