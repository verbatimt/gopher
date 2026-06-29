// Finance accounts (EP-0032). Money is numeric(14,2) — Gopher's single documented money type
// for the forecasting engine (distinct from the EP-0036 extensions' numeric(12,2)). Soft-delete
// cascades to transactions at the service layer (EP-0033).

import { sql } from 'drizzle-orm';
import { check, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { baseColumns } from '../../_shared.ts';
import { households } from '../households.ts';
import { ACCOUNT_TYPES, sqlList } from './enums.ts';

export const accounts = pgTable(
  'finance_accounts',
  {
    ...baseColumns,
    householdId: uuid()
      .notNull()
      .references(() => households.id),
    name: text().notNull(),
    notes: text(),
    currentBalance: numeric({ precision: 14, scale: 2 }).notNull().default('0'),
    type: text().notNull(),
  },
  (t) => [
    check('finance_accounts_type_chk', sql`${t.type} in (${sql.raw(sqlList(ACCOUNT_TYPES))})`),
  ],
);
