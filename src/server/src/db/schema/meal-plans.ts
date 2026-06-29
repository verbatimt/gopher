// Meal planning (EP-0030, context §5): a weekly plan per household (one per week) with one
// entry per (day, meal type) slot. No recipes/nutrition (explicitly out of scope) — entries
// are just a meal name + optional notes.

import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { baseColumns } from '../_shared.ts';
import { households } from './households.ts';

export const mealPlans = pgTable(
  'meal_plans',
  {
    ...baseColumns,
    householdId: uuid()
      .notNull()
      .references(() => households.id),
    weekStartDate: text().notNull(), // 'YYYY-MM-DD' (week start; Sunday=day 0)
    createdBy: uuid(),
  },
  (t) => [unique('meal_plans_household_week_uq').on(t.householdId, t.weekStartDate)],
);

export const mealPlanEntries = pgTable(
  'meal_plan_entries',
  {
    ...baseColumns,
    mealPlanId: uuid()
      .notNull()
      .references(() => mealPlans.id),
    dayOfWeek: integer().notNull(),
    mealType: text().notNull(), // breakfast | lunch | dinner | snack
    mealName: text().notNull(),
    notes: text(),
  },
  (t) => [
    check('meal_plan_entries_day_chk', sql`${t.dayOfWeek} between 0 and 6`),
    check(
      'meal_plan_entries_type_chk',
      sql`${t.mealType} in ('breakfast','lunch','dinner','snack')`,
    ),
    // One meal per (plan, day, meal type) slot — assigning replaces.
    unique('meal_plan_entries_slot_uq').on(t.mealPlanId, t.dayOfWeek, t.mealType),
  ],
);
