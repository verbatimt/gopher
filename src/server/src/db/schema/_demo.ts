// Foundation fixture tables used to prove the column conventions, repo primitives,
// tenancy scoping, soft-deletion, referential cleanup, and junction hard-delete before
// real domain tables exist. All carry `household_id` so tenancy helpers can be exercised.

import { pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { baseColumns } from '../_shared.ts';

export const demoWidgets = pgTable('demo_widgets', {
  ...baseColumns,
  householdId: uuid().notNull(),
  name: text().notNull(),
});

/** Parent in a parent→child relationship (for referential-cleanup tests). */
export const demoCategories = pgTable('demo_categories', {
  ...baseColumns,
  householdId: uuid().notNull(),
  name: text().notNull(),
});

/** Child with a nullable FK to a category; on category delete children relink to null. */
export const demoItems = pgTable('demo_items', {
  ...baseColumns,
  householdId: uuid().notNull(),
  name: text().notNull(),
  categoryId: uuid().references(() => demoCategories.id),
});

/** Junction/link row (no standalone meaning) — hard-deleted, never soft-deleted. */
export const demoLinks = pgTable(
  'demo_links',
  {
    householdId: uuid().notNull(),
    leftId: uuid().notNull(),
    rightId: uuid().notNull(),
  },
  (t) => [primaryKey({ columns: [t.leftId, t.rightId] })],
);
