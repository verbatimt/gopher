// Shared-expense attribution (EP-0036): who owes what on an expense. The payer is the
// expense's logged_by; each share row records a member's portion. numeric(12,2).

import { numeric, pgTable, uuid } from 'drizzle-orm/pg-core';
import { baseColumns } from '../../_shared.ts';
import { householdMembers } from '../households.ts';
import { expenses } from './expenses.ts';

export const expenseShares = pgTable('expense_shares', {
  ...baseColumns,
  expenseId: uuid()
    .notNull()
    .references(() => expenses.id),
  memberId: uuid()
    .notNull()
    .references(() => householdMembers.id),
  share: numeric({ precision: 12, scale: 2 }).notNull(),
});
