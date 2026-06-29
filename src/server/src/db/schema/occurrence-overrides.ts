// Per-(item, date) occurrence deviations, created only on interaction. Stores a status
// override, a time override, and/or a note — without mutating the recurring template.
// Supports both on-the-fly and generated occurrence models.

import { date, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { scheduledItems } from './scheduled-items.ts';

export const occurrenceOverrides = pgTable(
  'occurrence_overrides',
  {
    id: uuid().primaryKey().defaultRandom(),
    scheduledItemId: uuid()
      .notNull()
      .references(() => scheduledItems.id),
    occurrenceDate: date().notNull(),
    status: text(), // pending | completed | skipped | cancelled
    timeOverride: text(), // 'HH:MM'
    note: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('occurrence_overrides_item_date_uq').on(t.scheduledItemId, t.occurrenceDate)],
);
