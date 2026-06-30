// Meal planning (EP-0030, context §5): a weekly plan per household (one per week) with one
// entry per (day, meal type) slot. EP-0046 (Tier 8) adds an optional recipe link + per-entry
// servings; meal_name remains the display fallback when no recipe is linked.

import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { baseColumns } from '../_shared.ts';
import { householdMembers, households } from './households.ts';
import { recipes } from './recipes.ts';

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
    // EP-0046: optional recipe link. ON DELETE SET NULL so deleting a recipe never orphans a
    // plan; the entry keeps its meal_name snapshot. `servings` scales ingredient derivation.
    recipeId: uuid().references(() => recipes.id, { onDelete: 'set null' }),
    servings: integer(),
    // Family vs personal scope. 'family' (default) preserves the household-wide behavior;
    // 'personal' ties the meal to a single member (memberId), who alone sees it among
    // non-supervisors. Family entries have a null memberId.
    scope: text().notNull().default('family'),
    memberId: uuid().references(() => householdMembers.id),
  },
  (t) => [
    check('meal_plan_entries_day_chk', sql`${t.dayOfWeek} between 0 and 6`),
    check(
      'meal_plan_entries_type_chk',
      sql`${t.mealType} in ('breakfast','lunch','dinner','snack')`,
    ),
    check('meal_plan_entries_scope_chk', sql`${t.scope} in ('family','personal')`),
    // One meal per (plan, day, meal type) slot — assigning replaces.
    unique('meal_plan_entries_slot_uq').on(t.mealPlanId, t.dayOfWeek, t.mealType),
  ],
);
