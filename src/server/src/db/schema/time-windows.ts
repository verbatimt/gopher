// Household-defined time-of-day windows (custom buckets). Minutes are 0–1439 with
// start < end (check-enforced). Defaults (Morning/Afternoon/Evening) are seeded per
// household. Unique per (household, name) so seeding is idempotent.

import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { baseColumns } from '../_shared.ts';
import { households } from './households.ts';

export const timeWindows = pgTable(
  'time_windows',
  {
    ...baseColumns,
    householdId: uuid()
      .notNull()
      .references(() => households.id),
    name: text().notNull(),
    startMinute: integer().notNull(),
    endMinute: integer().notNull(),
  },
  (t) => [
    unique('time_windows_household_name_uq').on(t.householdId, t.name),
    check(
      'time_windows_range_chk',
      sql`${t.startMinute} >= 0 and ${t.endMinute} <= 1439 and ${t.startMinute} < ${t.endMinute}`,
    ),
  ],
);
