# Recipes Domain (EP-0045)

Tier 8 household recipe book. **Supersedes the EP-0030 MVP exclusion** ("no recipe database …
for MVP") per master-plan §1.2. Clean-slate; no external import (LAN-only, §2.17). Foundation
for recipe-driven meal planning + grocery derivation (EP-0046) and the recipe client (EP-0047).

> **Nutrition (ADR-0005):** optional per-recipe macros were later reintroduced (reversing the
> EP-0045 §4 out-of-scope boundary) — see the `recipes` columns below. This is **not** a global
> ingredient nutrition catalog (still excluded), and there is no per-ingredient nutrition.

## ER diagram

```
households 1───∞ recipes 1───∞ recipe_ingredients   (sort_order 1..n, hard-deleted)
                       └──────∞ recipe_steps         (step_number 1..n, hard-deleted)
```

- **`recipes`** — `name`, `description?`, `servings` (≥1, default 1), `prep_minutes?`,
  `cook_minutes?`, `source?`, `image_path?`, `tags text[]` (default `{}`), `created_by`, and
  optional nutrition (ADR-0005): `calories integer?`, `protein_grams numeric(10,2)?`,
  `carbs_grams numeric(10,2)?`, `fat_grams numeric(10,2)?` (per-recipe totals).
  Soft-deleted (`is_active`/`deleted_at`): hidden from lists but still resolvable by id so
  historical meal-plan references survive.
- **`recipe_ingredients`** — free-text `name`, `quantity numeric(10,2)?`, `unit?` (free text),
  `note?`, `sort_order` (dense 1..n). No global ingredient/nutrition catalog.
- **`recipe_steps`** — `step_number` (dense 1..n), `instruction`.

Ingredients and steps are child detail rows with no standalone meaning, so they are
**hard-deleted**; only the recipe aggregate is soft-deleted.

## Ordering / reorder contract

`sort_order` (ingredients) and `step_number` (steps) are **dense 1..n**. Mirrors the EP-0021
workflow-step contract:

- **Add** appends at `max(order)+1`.
- **Delete** removes the row, then re-densifies the survivors to 1..n in one transaction.
- **Reorder** (`POST …/ingredients/reorder`, `POST …/steps/reorder`) takes the **full ordered
  id list**; it must contain exactly the recipe's current child ids (else 422), and positions
  are rewritten 1..n in a single transaction (avoids reorder races).

## Endpoints (`/api/v1/households/:id/...`)

- `GET /recipes?search=&tag=&page=` — case-insensitive `name`/`description` ILIKE search, `tag`
  array-contains filter, paginated (50/page), name-ordered.
- `POST /recipes` — create (optional inline `ingredients`/`steps`).
- `GET /recipes/:recipeId` — detail (ingredients + ordered steps); resolves soft-deleted recipes.
- `PATCH /recipes/:recipeId`, `DELETE /recipes/:recipeId` (soft-delete).
- Ingredients: `POST/PATCH/DELETE …/ingredients[/:id]`, `POST …/ingredients/reorder`.
- Steps: `POST/PATCH/DELETE …/steps[/:id]`, `POST …/steps/reorder`.

## Access

- **Authoring** (create/update/delete recipe, ingredients, steps): `meals:write`
  (supervising/unsupervised). Recipes "ride with" the meals module.
- **Reads**: household membership — gated by `household:read`, which every member role (including
  `supervised_user`) holds. So a supervised member can browse recipes but not author them.

## Validation

`name` required; `servings ≥ 1`; ingredient `quantity` non-negative when present; step
`instruction` non-empty. Soft-deleting a recipe never breaks a meal-plan entry that references
it — EP-0046 keeps the `meal_name` fallback and sets `recipe_id` NULL on deletion.
