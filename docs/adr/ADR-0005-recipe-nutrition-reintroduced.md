# ADR-0005 — Per-recipe nutrition reintroduced (reverses the EP-0045 out-of-scope boundary)

- **Status:** Accepted
- **Date:** 2026-06-30
- **Context:** Two reported gaps: there was no way to enter nutrition on a recipe, and no
  nutrition tracking visible anywhere. Nutrition was a **hard out-of-scope boundary** in
  EP-0045 §4 ("Nutrition/calorie analysis and a global ingredient nutrition database"),
  echoed by EP-0046 ("Nutrition aggregation"), EP-0030, and EP-0043. This ADR records the
  decision to partially reverse that boundary and the chosen, deliberately small, shape.

## Context

EP-0045 shipped a clean-slate household recipe book (`recipes` + `recipe_ingredients` +
`recipe_steps`) with **no nutrition catalog and free-text ingredients**, and explicitly
excluded nutrition to avoid scope creep toward an external nutrition database (LAN-only,
master plan §2.17). EP-0046 added recipe-linked meal-plan entries (`recipe_id`, `servings`)
and a grocery roll-up (`POST /grocery/seed-from-plan`) that scales ingredients by
`entry.servings / recipe.servings`, but left "Nutrition aggregation" out of scope.

The recipes domain itself was a *reversal* of EP-0030's "no recipe database for MVP"
(`.planning/execution-plan.md` §1.2). **Nutrition was never reversed** — so reintroducing it
is a new, stakeholder-confirmed scope decision, not an alignment.

## Decision

Stakeholder-confirmed scope (kept intentionally minimal):

1. **Per-recipe macro columns, not a catalog.** Add four nullable columns to `recipes`:
   `calories integer`, `protein_grams numeric(10,2)`, `carbs_grams numeric(10,2)`,
   `fat_grams numeric(10,2)`. This is an **additive, forward-only `ALTER TABLE ADD COLUMN`
   migration** (`0021_white_reavers.sql`) — non-destructive. **No** `recipe_nutrition` table,
   **no per-ingredient nutrition**, and **no global ingredient nutrition database** (the
   EP-0045 catalog exclusion still holds).

2. **Author with `meals:write`, read with `household:read`.** Nutrition rides the existing
   recipe authoring/visibility model: the four fields are added to `createRecipeBody` /
   `updateRecipeBody` (optional, non-negative, nullable so a PATCH can clear a value) and to
   the recipe DTO. Grams are kept as strings at the DB boundary (numeric convention).

3. **Tracking is a client-side meal-plan roll-up, household-scoped.** The meal planner shows a
   per-day macro strip computed entirely on the client from already-loaded recipes (`models/
   nutrition.dart`: `dailyTotals`), scaling each recipe-linked entry by
   `entry.servings / recipe.servings` (mirroring the EP-0046 grocery factor). Entries with no
   recipe link, an unknown recipe, or a recipe without nutrition contribute nothing. **No new
   server endpoint**, and **no per-member breakdown** (meal plans have no member scope).

## Consequences

- Nutrition can be entered on a recipe (form + detail display) and a basic daily nutrition
  summary is viewable from the meal planner.
- The migration is additive and reversible-by-omission; the only destructive step (a future
  `DROP COLUMN`) is not taken.
- Server and client share the contract `calories` / `proteinGrams` / `carbsGrams` /
  `fatGrams` (grams as numeric strings, parsed on the client).
- Out of scope (unchanged): per-ingredient nutrition, a global ingredient nutrition database,
  external nutrition import/scraping, a server-side rollup endpoint, and per-member tracking.
- No new external dependency; LAN-only and clean-slate constraints hold.
