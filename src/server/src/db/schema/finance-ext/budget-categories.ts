// Budget categories (EP-0036): a named spending target within a budget. numeric(12,2).

import { numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { baseColumns } from '../../_shared.ts';
import { budgets } from './budgets.ts';

export const budgetCategories = pgTable('budget_categories', {
  ...baseColumns,
  budgetId: uuid()
    .notNull()
    .references(() => budgets.id),
  name: text().notNull(),
  targetAmount: numeric({ precision: 12, scale: 2 }).notNull().default('0'),
  colorTag: text(),
});
