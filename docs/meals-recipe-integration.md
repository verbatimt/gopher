# Recipe-Integrated Meal Planning & Grocery Derivation (EP-0046)

A delta on EP-0030 (Meal Planning & Grocery Lists). Links recipes (EP-0045) to meal-plan
entries and upgrades grocery seeding from "meal name only" to **ingredient-derived**, while
keeping the lightweight free-text path intact.

## Schema delta

`meal_plan_entries` gains:
- `recipe_id uuid?` — FK `recipes(id)` **ON DELETE SET NULL**. Never orphans a plan.
- `servings int?` — per-entry servings, for ingredient scaling.

`meal_name` remains `NOT NULL` and is the **display fallback** when no recipe is linked.

## Entry endpoints accept `recipeId` / `servings`

`POST/PATCH /meal-plans/:planId/entries[/:entryId]`:
- Setting `recipeId` links the recipe; if `mealName` is omitted, it **defaults to the recipe
  name** (a snapshot stored on the entry).
- Setting `recipeId: null` clears the link, keeping `mealName`.
- An entry with neither `mealName` nor `recipeId` is rejected (422).

## Referential safety

- **Hard delete** of a recipe → `ON DELETE SET NULL` clears `recipe_id`.
- **Soft delete** (the normal recipe DELETE, which keeps the row) → `deleteRecipe` explicitly
  nulls `recipe_id` on referencing entries in the same transaction, preserving each entry's
  `meal_name` snapshot. Either way, the planner is never left pointing at a hidden recipe.

## Grocery derivation — `POST /grocery/seed-from-plan`

Walks a plan's entries:
- **Recipe-linked entry** → expands its `recipe_ingredients`.
  - **Scaling:** `factor = entry.servings / recipe.servings` when both are present and
    `recipe.servings > 0`; otherwise `factor = 1`. Quantities are multiplied by `factor`.
  - **Aggregation:** group derived ingredients by **case-insensitive `(name, unit)`**, summing
    quantities (rounded to 2 dp). Ingredients with no quantity collapse to a single unchecked
    line.
- **Free-text entry** (no recipe) → seeds the `meal_name` (current EP-0030 behavior), skipping
  an identical pending line.

**Merge (no double-seeding):** each derived line merges into the existing grocery list by
matching an **active, unchecked** item with the same `name` (case-insensitive) **and** the same
unit (parsed from the item's stored `quantity` text, e.g. `"400 g"`). A match increments the
quantity in place; otherwise a new line is inserted. Differing units produce **separate lines**
(no unit conversion in MVP). Returns `{ added, merged }`.

The original `POST /grocery/seed` (meal-name-only) is retained for backward compatibility.

## Nutrition roll-up (ADR-0005, client-side)

The meal planner shows a per-day macro strip (calories + protein/carbs/fat) computed **entirely
on the client** (`client/lib/models/nutrition.dart` → `dailyTotals`) from the week's
recipe-linked entries and the already-loaded recipe list — **no server endpoint**. Each entry
contributes its recipe's nutrition scaled by the same `entry.servings / recipe.servings` factor
used for grocery derivation (factor `1` when servings are absent). Entries with no recipe link,
an unknown recipe, or a recipe without nutrition contribute nothing. Household-scoped; there is
no per-member breakdown. Per-recipe nutrition columns are defined in `docs/recipes-domain.md`.

## Invariants preserved (EP-0030)

Unique `(household_id, week_start_date)`; one meal per `(plan, day, meal_type)` slot
(replace-on-conflict); `day_of_week 0..6`. `meals:write` guards entry writes + both seed
routes; reads require `meals:read`.
