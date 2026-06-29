// Medication tracking (EP-0024, context §5/§7 Medications + Medication Logs). A schedule
// carries an RRULE dosing pattern, stock + refill threshold, and a dose window; doses are
// the per-occurrence compliance log (pending until taken/skipped/missed); refills add stock.
// numeric (not float) is used throughout for dosages/stock so quantities are exact.

import { sql } from 'drizzle-orm';
import {
  check,
  date,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { baseColumns } from '../_shared.ts';
import { householdMembers, households } from './households.ts';

export const medicationSchedules = pgTable('medication_schedules', {
  ...baseColumns,
  householdId: uuid()
    .notNull()
    .references(() => households.id),
  memberId: uuid()
    .notNull()
    .references(() => householdMembers.id),
  medicationName: text().notNull(),
  dosageAmount: numeric().notNull(),
  dosageUnit: text().notNull(),
  rrule: text().notNull(), // dosing schedule (RRULE incl. DTSTART), expanded by EP-0018
  startDate: date().notNull(),
  endDate: date(),
  stockQuantity: numeric().notNull().default('0'),
  refillThreshold: numeric().notNull().default('0'),
  doseWindowMinutes: integer().notNull().default(120),
  notes: text(),
});

export const medicationDoses = pgTable(
  'medication_doses',
  {
    ...baseColumns,
    scheduleId: uuid()
      .notNull()
      .references(() => medicationSchedules.id),
    scheduledAt: timestamp({ withTimezone: true }).notNull(),
    status: text().notNull().default('pending'),
    loggedAt: timestamp({ withTimezone: true }),
    loggedBy: uuid().references(() => householdMembers.id),
    notes: text(),
  },
  (t) => [
    check(
      'medication_doses_status_chk',
      sql`${t.status} in ('pending','taken','skipped','missed')`,
    ),
    // One dose row per (schedule, scheduled occurrence): the dedupe/upsert key shared by the
    // log endpoint (EP-0024) and the reminder/missed scan (EP-0025).
    unique('medication_doses_schedule_scheduled_uq').on(t.scheduleId, t.scheduledAt),
  ],
);

export const medicationRefills = pgTable('medication_refills', {
  ...baseColumns,
  scheduleId: uuid()
    .notNull()
    .references(() => medicationSchedules.id),
  refillDate: date().notNull().default(sql`CURRENT_DATE`),
  quantityAdded: numeric().notNull(),
  loggedBy: uuid()
    .notNull()
    .references(() => householdMembers.id),
  notes: text(),
});
