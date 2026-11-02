import { and, eq } from 'drizzle-orm';
import type { Clock } from '../../util/clock.js';
import type { Db } from '../client.js';
import { type DomainState, companyDomains } from '../schema.js';

export interface DomainRecord {
  companyKey: string;
  name: string;
  domain: string | null;
  state: DomainState;
  source: string;
  brandId: string | null;
  markUrl: string | null;
  updatedAt: string;
}

/** `company_domains` (J9). Writes from the finder are `found` only. */
export function domainsRepo(db: Db, clock: Clock) {
  return {
    all(): DomainRecord[] {
      return db.select().from(companyDomains).all();
    },

    count(): number {
      return db.select().from(companyDomains).all().length;
    },

    /**
     * Insert or update a `found` row. A `confirmed` or `none` row is left
     * as it is: nothing automatic overwrites Kris's answer.
     */
    get(companyKey: string): DomainRecord | undefined {
      return db
        .select()
        .from(companyDomains)
        .where(eq(companyDomains.companyKey, companyKey))
        .get();
    },

    upsertFound(input: {
      companyKey: string;
      name: string;
      domain: string;
      source: string;
      brandId?: string | null;
    }): 'inserted' | 'updated' | 'kept' {
      const existing = db
        .select()
        .from(companyDomains)
        .where(eq(companyDomains.companyKey, input.companyKey))
        .get();
      if (existing && existing.state !== 'found') return 'kept';
      const row = {
        name: input.name,
        domain: input.domain,
        state: 'found' as const,
        source: input.source,
        brandId: input.brandId ?? null,
        markUrl: null,
        updatedAt: clock.now(),
      };
      if (!existing) {
        db.insert(companyDomains)
          .values({ ...row, companyKey: input.companyKey })
          .run();
        return 'inserted';
      }
      db.update(companyDomains)
        .set(row)
        .where(eq(companyDomains.companyKey, input.companyKey))
        .run();
      return 'updated';
    },

    /**
     * Remove a job-data `found` row. `confirmed`, `none`, and a domain Kris's
     * browser resolved (`brand_search`) stay. Job data still overwrites
     * `brand_search` when it has a domain of its own, via `upsertFound`.
     */
    /**
     * Kris's answer from the logo picker (J10): `confirmed` or `none`.
     * This is the one write that may replace a `found` row.
     */
    upsertChoice(input: {
      companyKey: string;
      name: string;
      domain: string | null;
      state: 'confirmed' | 'none';
      source: string;
      brandId: string | null;
      markUrl: string | null;
    }): void {
      const row = {
        name: input.name,
        domain: input.domain,
        state: input.state,
        source: input.source,
        brandId: input.brandId,
        markUrl: input.markUrl,
        updatedAt: clock.now(),
      };
      const existing = db
        .select({ companyKey: companyDomains.companyKey })
        .from(companyDomains)
        .where(eq(companyDomains.companyKey, input.companyKey))
        .get();
      if (!existing) {
        db.insert(companyDomains)
          .values({ ...row, companyKey: input.companyKey })
          .run();
        return;
      }
      db.update(companyDomains)
        .set(row)
        .where(eq(companyDomains.companyKey, input.companyKey))
        .run();
    },

    deleteFound(companyKey: string): boolean {
      const existing = db
        .select()
        .from(companyDomains)
        .where(eq(companyDomains.companyKey, companyKey))
        .get();
      if (!existing || existing.state !== 'found' || existing.source === 'brand_search') {
        return false;
      }
      const result = db
        .delete(companyDomains)
        .where(and(eq(companyDomains.companyKey, companyKey), eq(companyDomains.state, 'found')))
        .run();
      return result.changes > 0;
    },
  };
}
