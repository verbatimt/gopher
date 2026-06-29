// Generic repository primitives shared by every aggregate: create / retrieve-by-id /
// list-active / update / soft-delete. Soft-delete flips is_active=false (+ deleted_at) and
// never hard-deletes, so active reads hide the row while the data is retained.

import { and, eq, type InferInsertModel, type InferSelectModel } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { type Database, db as defaultDb } from './index.ts';

/** A table that carries the soft-delete base columns. */
export interface SoftDeletableTable extends PgTable {
  id: PgColumn;
  isActive: PgColumn;
  updatedAt: PgColumn;
  deletedAt: PgColumn;
}

export function createRepository<T extends SoftDeletableTable>(
  table: T,
  database: Database = defaultDb,
) {
  type Row = InferSelectModel<T>;
  type Insert = InferInsertModel<T>;

  // Drizzle's query-builder generics don't narrow over an abstract `T extends PgTable`,
  // so the table is erased only at the builder boundary; column refs and the public
  // Row/Insert types stay precise.
  // biome-ignore lint/suspicious/noExplicitAny: generic table erased for the query builder.
  const t = table as any;

  return {
    /** Insert a row and return it. */
    async create(values: Insert): Promise<Row> {
      const [row] = await database.insert(t).values(values).returning();
      return row as Row;
    },

    /** Fetch an active (non-soft-deleted) row by id, or null. */
    async retrieve(id: string): Promise<Row | null> {
      const [row] = await database
        .select()
        .from(t)
        .where(and(eq(table.id, id), eq(table.isActive, true)))
        .limit(1);
      return (row as Row | undefined) ?? null;
    },

    /** Fetch a row by id regardless of soft-delete state (data is retained). */
    async retrieveIncludingDeleted(id: string): Promise<Row | null> {
      const [row] = await database.select().from(t).where(eq(table.id, id)).limit(1);
      return (row as Row | undefined) ?? null;
    },

    /** List all active rows. */
    async listActive(): Promise<Row[]> {
      const rows = await database.select().from(t).where(eq(table.isActive, true));
      return rows as Row[];
    },

    /** Patch a row by id; bumps updated_at. Returns the updated row or null. */
    async update(id: string, values: Partial<Insert>): Promise<Row | null> {
      const [row] = await database
        .update(t)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(table.id, id))
        .returning();
      return (row as Row | undefined) ?? null;
    },

    /** Soft-delete (hide, not erase). Returns true if a row was affected. */
    async softDelete(id: string): Promise<boolean> {
      const rows = await database
        .update(t)
        .set({ isActive: false, deletedAt: new Date() })
        .where(eq(table.id, id))
        .returning();
      return rows.length > 0;
    },

    /** Restore a soft-deleted row (un-hide). Returns true if a row was affected. */
    async restore(id: string): Promise<boolean> {
      const rows = await database
        .update(t)
        .set({ isActive: true, deletedAt: null })
        .where(eq(table.id, id))
        .returning();
      return rows.length > 0;
    },
  };
}

export type Repository<T extends SoftDeletableTable> = ReturnType<typeof createRepository<T>>;
