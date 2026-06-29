// Per-forecast account snapshot (EP-0032): captures a frozen account at generation time and
// carries the running ending_balance the engine projects.

import { numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { baseColumns } from '../../_shared.ts';
import { accounts } from './accounts.ts';
import { forecasts } from './forecasts.ts';

export const forecastAccounts = pgTable('finance_forecast_accounts', {
  ...baseColumns,
  forecastId: uuid()
    .notNull()
    .references(() => forecasts.id),
  accountId: uuid()
    .notNull()
    .references(() => accounts.id),
  name: text().notNull(),
  type: text().notNull(),
  startingBalance: numeric({ precision: 14, scale: 2 }).notNull(),
  endingBalance: numeric({ precision: 14, scale: 2 }).notNull(),
});
