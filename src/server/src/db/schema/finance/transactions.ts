// Finance transactions (EP-0032): a recurring transfer between an origin and a destination
// account. `interval` (a SQL reserved word) is stored as `interval_unit`; `frequency` is its
// multiplier. Money is numeric(14,2).

import { sql } from 'drizzle-orm';
import { boolean, check, date, integer, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { baseColumns } from '../../_shared.ts';
import { households } from '../households.ts';
import { accounts } from './accounts.ts';
import {
  RECURRENCE_INTERVALS,
  sqlList,
  TRANSACTION_CATEGORIES,
  TRANSACTION_ENDINGS,
  TRANSFER_TYPES,
} from './enums.ts';

export const transactions = pgTable(
  'finance_transactions',
  {
    ...baseColumns,
    householdId: uuid()
      .notNull()
      .references(() => households.id),
    originAccountId: uuid()
      .notNull()
      .references(() => accounts.id),
    destinationAccountId: uuid()
      .notNull()
      .references(() => accounts.id),
    description: text().notNull(),
    notes: text(),
    forecastIncluded: boolean().notNull().default(true),
    category: text().notNull(),
    transferType: text().notNull(),
    transferAmount: numeric({ precision: 14, scale: 2 }).notNull(),
    startDate: date().notNull(),
    ending: text().notNull(),
    endDate: date(),
    recurrenceCount: integer(),
    intervalUnit: text().notNull(),
    frequency: integer().notNull().default(1),
  },
  (t) => [
    check(
      'finance_tx_category_chk',
      sql`${t.category} in (${sql.raw(sqlList(TRANSACTION_CATEGORIES))})`,
    ),
    check(
      'finance_tx_transfer_chk',
      sql`${t.transferType} in (${sql.raw(sqlList(TRANSFER_TYPES))})`,
    ),
    check('finance_tx_ending_chk', sql`${t.ending} in (${sql.raw(sqlList(TRANSACTION_ENDINGS))})`),
    check(
      'finance_tx_interval_chk',
      sql`${t.intervalUnit} in (${sql.raw(sqlList(RECURRENCE_INTERVALS))})`,
    ),
  ],
);
