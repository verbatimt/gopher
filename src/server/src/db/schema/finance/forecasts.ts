// Finance forecasts (EP-0032): a projection over [start_date, end_date]. `start`/`end` are
// stored as `start_date`/`end_date` (`end` is a SQL reserved word). Child snapshot tables
// resolve their household via forecast_id.

import { date, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { baseColumns } from '../../_shared.ts';
import { households } from '../households.ts';

export const forecasts = pgTable('finance_forecasts', {
  ...baseColumns,
  householdId: uuid()
    .notNull()
    .references(() => households.id),
  startDate: date().notNull(),
  endDate: date().notNull(),
  description: text().notNull(),
  generatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
