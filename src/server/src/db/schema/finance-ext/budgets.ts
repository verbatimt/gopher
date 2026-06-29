// Household budgets (EP-0036): a named budget over a period with target categories. Separate
// subsystem from the forecasting engine (EP-0032) — money is numeric(12,2). See
// docs/finance-domain.md for the boundary.

import { sql } from 'drizzle-orm';
import { check, date, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { baseColumns } from '../../_shared.ts';
import { households } from '../households.ts';

export const budgets = pgTable(
  'budgets',
  {
    ...baseColumns,
    householdId: uuid()
      .notNull()
      .references(() => households.id),
    name: text().notNull(),
    period: text().notNull(), // weekly | monthly | annual | custom
    startDate: date().notNull(),
    endDate: date(),
  },
  (t) => [check('budgets_period_chk', sql`${t.period} in ('weekly','monthly','annual','custom')`)],
);
