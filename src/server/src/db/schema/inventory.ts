// Household inventory & consumables (EP-0048, Tier 8 net-new domain). Items carry a maintained
// running `quantity`; every change flows through the append-only `inventory_adjustments` log
// (restock / consume / correction / expired), each row recording the resulting quantity — the
// medication stock pattern (EP-0024) generalized to household consumables. numeric(12,2)
// throughout (never float). Items are soft-deleted; adjustments are immutable history.

import { sql } from 'drizzle-orm';
import { boolean, check, date, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { baseColumns, idColumn } from '../_shared.ts';
import { householdMembers, households } from './households.ts';

export const inventoryItems = pgTable('inventory_items', {
  ...baseColumns,
  householdId: uuid()
    .notNull()
    .references(() => households.id),
  name: text().notNull(),
  category: text(),
  unit: text(),
  quantity: numeric({ precision: 12, scale: 2 }).notNull().default('0'),
  location: text(),
  lowThreshold: numeric({ precision: 12, scale: 2 }),
  expiresAt: date(),
  barcode: text(),
  autoAddToGrocery: boolean().notNull().default(true),
  notes: text(),
  // Optional item photo as a stored URL (ADR-0006; reuses the recipes approach, no upload).
  imagePath: text(),
  createdBy: uuid().references(() => householdMembers.id),
});

export const inventoryAdjustments = pgTable(
  'inventory_adjustments',
  {
    ...idColumn,
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    itemId: uuid()
      .notNull()
      .references(() => inventoryItems.id),
    delta: numeric({ precision: 12, scale: 2 }).notNull(),
    reason: text().notNull(),
    resultingQuantity: numeric({ precision: 12, scale: 2 }).notNull(),
    adjustedBy: uuid().references(() => householdMembers.id),
    note: text(),
  },
  (t) => [
    check(
      'inventory_adjustments_reason_chk',
      sql`${t.reason} in ('restock','consume','correction','expired')`,
    ),
  ],
);

export type InventoryItemRow = typeof inventoryItems.$inferSelect;
export type InventoryAdjustmentRow = typeof inventoryAdjustments.$inferSelect;
