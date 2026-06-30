// Recipe book (EP-0045, Tier 8). A household recipe index: recipes with structured
// free-text ingredients and ordered preparation steps. Foundation for recipe-driven meal
// planning + grocery derivation (EP-0046). Clean-slate; no nutrition catalog, no external
// import (LAN-only). numeric (never float) for ingredient quantities (EP-0007).
//
// Recipes are soft-deleted (still resolvable by id so historical meal-plan references survive).
// Ingredients and steps are child detail rows with no standalone meaning, so they are
// hard-deleted; their order is dense 1..n, rewritten transactionally on reorder.

import { sql } from 'drizzle-orm';
import { check, integer, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { baseColumns, idColumn, timestamps } from '../_shared.ts';
import { households } from './households.ts';

export const recipes = pgTable('recipes', {
  ...baseColumns,
  householdId: uuid()
    .notNull()
    .references(() => households.id),
  name: text().notNull(),
  description: text(),
  servings: integer().notNull().default(1),
  prepMinutes: integer(),
  cookMinutes: integer(),
  source: text(),
  imagePath: text(),
  tags: text().array().notNull().default(sql`'{}'::text[]`),
  // Optional per-recipe nutrition (EP-0045 reversal, ADR-0005): calories + the three core
  // macros. numeric (never float) for grams; still no global ingredient nutrition catalog.
  calories: integer(),
  proteinGrams: numeric({ precision: 10, scale: 2 }),
  carbsGrams: numeric({ precision: 10, scale: 2 }),
  fatGrams: numeric({ precision: 10, scale: 2 }),
  createdBy: uuid(),
});

export const recipeIngredients = pgTable(
  'recipe_ingredients',
  {
    ...idColumn,
    ...timestamps,
    recipeId: uuid()
      .notNull()
      .references(() => recipes.id),
    name: text().notNull(),
    quantity: numeric({ precision: 10, scale: 2 }),
    unit: text(),
    note: text(),
    sortOrder: integer().notNull().default(1),
  },
  (t) => [check('recipe_ingredients_sort_chk', sql`${t.sortOrder} >= 1`)],
);

export const recipeSteps = pgTable(
  'recipe_steps',
  {
    ...idColumn,
    ...timestamps,
    recipeId: uuid()
      .notNull()
      .references(() => recipes.id),
    stepNumber: integer().notNull().default(1),
    instruction: text().notNull(),
  },
  (t) => [check('recipe_steps_number_chk', sql`${t.stepNumber} >= 1`)],
);

export type RecipeRow = typeof recipes.$inferSelect;
export type RecipeIngredientRow = typeof recipeIngredients.$inferSelect;
export type RecipeStepRow = typeof recipeSteps.$inferSelect;
