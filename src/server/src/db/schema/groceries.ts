// Grocery lists (EP-0030): a lightweight household list (one default per household) with
// check-off items. Intentionally simple — name + optional quantity + checked, no ingredient
// parsing. Items may optionally be seeded from a meal plan's entry names.

import { boolean, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { baseColumns } from '../_shared.ts';
import { households } from './households.ts';

export const groceryLists = pgTable('grocery_lists', {
  ...baseColumns,
  householdId: uuid()
    .notNull()
    .references(() => households.id),
  name: text().notNull().default('Groceries'),
});

export const groceryItems = pgTable('grocery_items', {
  ...baseColumns,
  groceryListId: uuid()
    .notNull()
    .references(() => groceryLists.id),
  name: text().notNull(),
  quantity: text(),
  isChecked: boolean().notNull().default(false),
});
