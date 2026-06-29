// Forecast ledger entries (EP-0032): paired origin (debit, negative) + destination (credit,
// positive) entries the engine writes per occurrence, capturing starting/ending balances.
// `sequence` is the engine's monotonic write order (date-then-within-day) so analytics
// (EP-0034) can compute opening/closing deterministically.

import { boolean, date, integer, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { baseColumns } from '../../_shared.ts';
import { forecastAccounts } from './forecast-accounts.ts';
import { forecastTransactions } from './forecast-transactions.ts';
import { forecasts } from './forecasts.ts';

export const forecastLedgerEntries = pgTable('finance_forecast_ledger_entries', {
  ...baseColumns,
  forecastId: uuid()
    .notNull()
    .references(() => forecasts.id),
  sequence: integer().notNull().default(0),
  forecastTransactionId: uuid()
    .notNull()
    .references(() => forecastTransactions.id),
  forecastAccountId: uuid()
    .notNull()
    .references(() => forecastAccounts.id),
  accountId: uuid().notNull(),
  name: text().notNull(),
  startingBalance: numeric({ precision: 14, scale: 2 }).notNull(),
  endingBalance: numeric({ precision: 14, scale: 2 }).notNull(),
  type: text().notNull(),
  origin: boolean().notNull(),
  transactionId: uuid().notNull(),
  amount: numeric({ precision: 14, scale: 2 }).notNull(),
  date: date().notNull(),
  description: text().notNull(),
  category: text().notNull(),
});
