// Append-only from/to history (audit tier 2). One row per changed sensitive/critical
// field, capturing old and new values as text. Immutable. Secrets are never stored as
// values — record presence-of-change instead (see src/audit/value-change.ts).

import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const valueChangeHistory = pgTable(
  'value_change_history',
  {
    id: uuid().primaryKey().defaultRandom(),
    householdId: uuid(), // for scoping; null for system-level changes
    entityType: text().notNull(),
    entityId: uuid().notNull(),
    fieldName: text().notNull(),
    oldValue: text(),
    newValue: text(),
    changedBy: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('value_change_entity_idx').on(t.entityType, t.entityId)],
);
