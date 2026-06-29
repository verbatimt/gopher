// Soft-deletion contract helpers and referential-safety utilities.
//
// Deletion philosophy: "hidden, not erased". Almost everything is soft-deleted
// (is_active=false). Only junction/link rows (no standalone meaning) are hard-deleted.
// Module-specific exceptions (e.g. the finance account→transaction soft-delete cascade,
// EP-0032/0033; the finance-extensions expense rule, EP-0036) are declared by their
// owning EPs — see docs/tenancy-and-deletion.md. Owner/protected rows cannot be deleted
// ([assertDeletable]); EP-0014 wires this to the household owner.

import type { InferInsertModel, SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { type Database, db as defaultDb } from './index.ts';

/** Thrown when a protected row (e.g. the household owner) is targeted for deletion. */
export class ProtectedRowError extends Error {
  constructor(reason = 'This record cannot be deleted.') {
    super(reason);
    this.name = 'ProtectedRowError';
  }
}

/** Guard for protected rows. Throws [ProtectedRowError] when [isProtected]. */
export function assertDeletable(isProtected: boolean, reason?: string): void {
  if (isProtected) throw new ProtectedRowError(reason);
}

/**
 * Hard-delete junction/link rows that have no standalone meaning. Returns the count
 * removed. Use ONLY for link tables; entity rows are soft-deleted.
 */
export async function hardDeleteLinks<T extends PgTable>(
  table: T,
  where: SQL,
  database: Database = defaultDb,
): Promise<number> {
  // biome-ignore lint/suspicious/noExplicitAny: generic table erased for the query builder.
  const rows = await (database as any).delete(table).where(where).returning();
  return rows.length;
}

/**
 * Referential cleanup: relink children of a deleted parent so they are not orphaned.
 * Typically sets a nullable FK to null ("uncategorized"). [match] selects the children
 * (e.g. `eq(items.categoryId, parentId)`); [nulls] is the FK reset (e.g. `{ categoryId: null }`).
 * Returns the count relinked.
 */
export async function relinkChildren<T extends PgTable>(
  childTable: T,
  match: SQL,
  nulls: Partial<InferInsertModel<T>>,
  database: Database = defaultDb,
): Promise<number> {
  // biome-ignore lint/suspicious/noExplicitAny: generic table erased for the query builder.
  const rows = await (database as any).update(childTable).set(nulls).where(match).returning();
  return rows.length;
}
