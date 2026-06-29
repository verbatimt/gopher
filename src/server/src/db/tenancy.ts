// Tenancy contract (data-layer enforcement, defense-in-depth with the EP-0012 middleware).
// `forHousehold(table, householdId)` returns a repository whose every read/write is bound
// to that household, making it hard to write an unscoped query: the household id is
// injected on create and applied as a filter on every read/update/delete. Cross-tenant
// access is therefore impossible through this surface.

import { and, eq, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { type Database, db as defaultDb } from './index.ts';
import type { SoftDeletableTable } from './repo.ts';

/** A household-owned, soft-deletable table. */
export interface HouseholdScopedTable extends SoftDeletableTable {
  householdId: PgColumn;
}

export function forHousehold<T extends HouseholdScopedTable>(
  table: T,
  householdId: string,
  database: Database = defaultDb,
) {
  type Row = InferSelectModel<T>;
  type Insert = InferInsertModel<T>;
  // Key-remapped omit (instead of `Omit<Insert, 'householdId'>`): under a generic T the
  // built-in Omit defers in a way that breaks excess-property checks at call sites.
  type CreateValues = { [K in keyof Insert as Exclude<K, 'householdId'>]: Insert[K] };

  // biome-ignore lint/suspicious/noExplicitAny: generic table erased for the query builder.
  const t = table as any;
  const scope = () => eq(table.householdId, householdId);

  return {
    householdId,

    /** Insert a row into THIS household (household id is injected, not accepted). */
    async create(values: CreateValues): Promise<Row> {
      const [row] = await database
        .insert(t)
        .values({ ...values, householdId })
        .returning();
      return row as Row;
    },

    /** Fetch an active row by id, scoped to this household (null if it belongs to another). */
    async retrieve(id: string): Promise<Row | null> {
      const [row] = await database
        .select()
        .from(t)
        .where(and(eq(table.id, id), scope(), eq(table.isActive, true)))
        .limit(1);
      return (row as Row | undefined) ?? null;
    },

    /** List active rows for this household only. */
    async listActive(): Promise<Row[]> {
      const rows = await database
        .select()
        .from(t)
        .where(and(scope(), eq(table.isActive, true)));
      return rows as Row[];
    },

    /** Patch a row by id within this household; bumps updated_at. */
    async update(id: string, values: Partial<CreateValues>): Promise<Row | null> {
      const [row] = await database
        .update(t)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(table.id, id), scope()))
        .returning();
      return (row as Row | undefined) ?? null;
    },

    /** Soft-delete a row by id within this household. */
    async softDelete(id: string): Promise<boolean> {
      const rows = await database
        .update(t)
        .set({ isActive: false, deletedAt: new Date() })
        .where(and(eq(table.id, id), scope()))
        .returning();
      return rows.length > 0;
    },

    /** Restore a soft-deleted row within this household. */
    async restore(id: string): Promise<boolean> {
      const rows = await database
        .update(t)
        .set({ isActive: true, deletedAt: null })
        .where(and(eq(table.id, id), scope()))
        .returning();
      return rows.length > 0;
    },
  };
}

export type ScopedRepository<T extends HouseholdScopedTable> = ReturnType<typeof forHousehold<T>>;
