// Per-forecast transaction snapshot (EP-0032): the transaction terms frozen at generation.

import { date, integer, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { baseColumns } from '../../_shared.ts';
import { forecasts } from './forecasts.ts';
import { transactions } from './transactions.ts';

export const forecastTransactions = pgTable('finance_forecast_transactions', {
  ...baseColumns,
  forecastId: uuid()
    .notNull()
    .references(() => forecasts.id),
  transactionId: uuid()
    .notNull()
    .references(() => transactions.id),
  originAccountId: uuid().notNull(),
  destinationAccountId: uuid().notNull(),
  description: text().notNull(),
  category: text().notNull(),
  transferType: text().notNull(),
  transferAmount: numeric({ precision: 14, scale: 2 }).notNull(),
  startDate: date().notNull(),
  ending: text().notNull(),
  endDate: date(),
  recurrenceCount: integer(),
  intervalUnit: text().notNull(),
  frequency: integer().notNull().default(1),
});
