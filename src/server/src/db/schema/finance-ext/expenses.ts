// Expenses (EP-0036): a logged expense, optionally categorized (deleting a category unlinks
// expenses rather than deleting them — category_id becomes null). numeric(12,2).

import { date, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { baseColumns } from '../../_shared.ts';
import { householdMembers, households } from '../households.ts';
import { budgetCategories } from './budget-categories.ts';

export const expenses = pgTable('expenses', {
  ...baseColumns,
  householdId: uuid()
    .notNull()
    .references(() => households.id),
  categoryId: uuid().references(() => budgetCategories.id), // null ⇒ uncategorized
  amount: numeric({ precision: 12, scale: 2 }).notNull(),
  currencyCode: text().notNull().default('USD'),
  expenseDate: date().notNull(),
  description: text(),
  loggedBy: uuid()
    .notNull()
    .references(() => householdMembers.id),
  receiptPath: text(),
});
