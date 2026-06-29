// Daily per-account balance snapshots (EP-0032) for charting net worth over time.

import { date, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { baseColumns } from '../../_shared.ts';
import { forecastAccounts } from './forecast-accounts.ts';
import { forecasts } from './forecasts.ts';

export const forecastAccountBalances = pgTable('finance_forecast_account_balances', {
  ...baseColumns,
  forecastId: uuid()
    .notNull()
    .references(() => forecasts.id),
  forecastAccountId: uuid()
    .notNull()
    .references(() => forecastAccounts.id),
  accountId: uuid().notNull(),
  type: text().notNull(),
  runningBalance: numeric({ precision: 14, scale: 2 }).notNull(),
  total: numeric({ precision: 14, scale: 2 }).notNull(),
  date: date().notNull(),
});
