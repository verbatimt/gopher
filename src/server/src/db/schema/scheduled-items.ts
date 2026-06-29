// Polymorphic scheduling base (context §7 Scheduled Items / Events / Appointments). One
// `scheduled_items` row per schedulable thing (type ∈ appointment|event|recurring_task|task),
// with a 1:1 `events` detail for events/appointments. Recurrence is an RRULE string;
// `rrule_until` denormalizes the series upper bound for range queries.

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { baseColumns } from '../_shared.ts';
import { householdMembers, households } from './households.ts';

export const scheduledItems = pgTable(
  'scheduled_items',
  {
    ...baseColumns,
    householdId: uuid()
      .notNull()
      .references(() => households.id),
    type: text().notNull(), // appointment | event | recurring_task | task
    title: text().notNull(),
    description: text(),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }),
    allDay: boolean().notNull().default(false),
    rrule: text(),
    rruleUntil: timestamp({ withTimezone: true }),
    visibility: text().notNull().default('family'), // personal | family
    assigneeMemberId: uuid().references(() => householdMembers.id),
    timeOfDay: text().notNull().default('anytime'), // anytime|morning|afternoon|evening|custom
    customWindowId: uuid(),
    pinnedTime: text(), // 'HH:MM' optional fixed clock time
    durationMinutes: integer(),
    location: text(),
    unskippable: boolean().notNull().default(false),
    createdBy: uuid(),
  },
  (t) => [
    index('scheduled_items_household_starts_idx').on(t.householdId, t.startsAt, t.rruleUntil),
    check(
      'scheduled_items_type_chk',
      sql`${t.type} in ('appointment','event','recurring_task','task')`,
    ),
    check('scheduled_items_visibility_chk', sql`${t.visibility} in ('personal','family')`),
    check(
      'scheduled_items_tod_chk',
      sql`${t.timeOfDay} in ('anytime','morning','afternoon','evening','custom')`,
    ),
  ],
);

export const events = pgTable('events', {
  id: uuid().primaryKey().defaultRandom(),
  scheduledItemId: uuid()
    .notNull()
    .unique()
    .references(() => scheduledItems.id),
  location: text(),
  url: text(),
  visibility: text().notNull().default('family'),
  participants: uuid().array().notNull().default(sql`'{}'::uuid[]`),
  reminderMinutesBefore: integer(),
});
