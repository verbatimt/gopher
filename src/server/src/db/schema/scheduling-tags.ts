// Scheduling tags + the item↔tag junction. Tag-set updates replace the whole set; the
// junction rows are hard-deleted (no standalone meaning).

import { pgTable, primaryKey, text, unique, uuid } from 'drizzle-orm/pg-core';
import { baseColumns } from '../_shared.ts';
import { households } from './households.ts';
import { scheduledItems } from './scheduled-items.ts';

export const schedulingTags = pgTable(
  'scheduling_tags',
  {
    ...baseColumns,
    householdId: uuid()
      .notNull()
      .references(() => households.id),
    name: text().notNull(),
  },
  (t) => [unique('scheduling_tags_household_name_uq').on(t.householdId, t.name)],
);

export const scheduledItemTags = pgTable(
  'scheduled_item_tags',
  {
    scheduledItemId: uuid()
      .notNull()
      .references(() => scheduledItems.id),
    tagId: uuid()
      .notNull()
      .references(() => schedulingTags.id),
  },
  (t) => [primaryKey({ columns: [t.scheduledItemId, t.tagId] })],
);
