// Recipe book business logic (EP-0045). Recipe CRUD (soft-delete; still resolvable by id),
// plus ingredient and step sub-resources with dense 1..n ordering rewritten transactionally on
// reorder (mirrors the EP-0021 workflow-step contract). Authoring is gated at the route by
// meals:write; reads require household membership. numeric quantities are kept as strings at the
// DB boundary.

import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { db, withTransaction } from '../../db/index.ts';
import { mealPlanEntries, recipeIngredients, recipeSteps, recipes } from '../../db/schema/index.ts';
import { InvalidError, NotFoundError } from '../../http/errors.ts';

export interface ActorContext {
  userId: string;
  householdId: string;
}

type RecipeRow = typeof recipes.$inferSelect;
type IngredientRow = typeof recipeIngredients.$inferSelect;
type StepRow = typeof recipeSteps.$inferSelect;

const PAGE_SIZE = 50;

function recipeDto(r: RecipeRow) {
  return {
    id: r.id,
    householdId: r.householdId,
    name: r.name,
    description: r.description,
    servings: r.servings,
    prepMinutes: r.prepMinutes,
    cookMinutes: r.cookMinutes,
    source: r.source,
    imagePath: r.imagePath,
    tags: r.tags,
    isActive: r.isActive,
    createdBy: r.createdBy,
  };
}

function ingredientDto(i: IngredientRow) {
  return {
    id: i.id,
    recipeId: i.recipeId,
    name: i.name,
    quantity: i.quantity,
    unit: i.unit,
    note: i.note,
    sortOrder: i.sortOrder,
  };
}

function stepDto(s: StepRow) {
  return { id: s.id, recipeId: s.recipeId, stepNumber: s.stepNumber, instruction: s.instruction };
}

export interface IngredientInput {
  name: string;
  quantity?: number | null;
  unit?: string | null;
  note?: string | null;
}

export interface StepInput {
  instruction: string;
}

export interface CreateRecipeInput {
  name: string;
  description?: string;
  servings?: number;
  prepMinutes?: number;
  cookMinutes?: number;
  source?: string;
  imagePath?: string;
  tags?: string[];
  ingredients?: IngredientInput[];
  steps?: StepInput[];
}

export async function createRecipe(ctx: ActorContext, input: CreateRecipeInput) {
  return withTransaction(async (tx) => {
    const [recipe] = await tx
      .insert(recipes)
      .values({
        householdId: ctx.householdId,
        name: input.name,
        description: input.description ?? null,
        servings: input.servings ?? 1,
        prepMinutes: input.prepMinutes ?? null,
        cookMinutes: input.cookMinutes ?? null,
        source: input.source ?? null,
        imagePath: input.imagePath ?? null,
        tags: input.tags ?? [],
        createdBy: ctx.userId,
      })
      .returning();
    if (input.ingredients?.length) {
      await tx.insert(recipeIngredients).values(
        input.ingredients.map((ing, idx) => ({
          recipeId: recipe!.id,
          name: ing.name,
          quantity: ing.quantity != null ? String(ing.quantity) : null,
          unit: ing.unit ?? null,
          note: ing.note ?? null,
          sortOrder: idx + 1,
        })),
      );
    }
    if (input.steps?.length) {
      await tx.insert(recipeSteps).values(
        input.steps.map((st, idx) => ({
          recipeId: recipe!.id,
          stepNumber: idx + 1,
          instruction: st.instruction,
        })),
      );
    }
    return recipe!.id;
  }).then((id) => getRecipe(ctx, id));
}

export interface ListFilter {
  search?: string;
  tag?: string;
  page?: number;
}

export async function listRecipes(ctx: ActorContext, filter: ListFilter) {
  const conditions = [eq(recipes.householdId, ctx.householdId), eq(recipes.isActive, true)];
  if (filter.search) {
    const like = `%${filter.search}%`;
    const m = or(ilike(recipes.name, like), ilike(recipes.description, like));
    if (m) conditions.push(m);
  }
  if (filter.tag) {
    // tags @> ARRAY[tag] — array contains the tag.
    conditions.push(sql`${recipes.tags} @> ARRAY[${filter.tag}]::text[]`);
  }
  const page = Math.max(1, filter.page ?? 1);
  const rows = await db
    .select()
    .from(recipes)
    .where(and(...conditions))
    .orderBy(asc(recipes.name))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  return rows.map(recipeDto);
}

/** Load a recipe by id within the household. `includeInactive` lets soft-deleted recipes
 *  resolve (for historical meal-plan references). */
async function loadRecipe(
  householdId: string,
  recipeId: string,
  includeInactive = false,
): Promise<RecipeRow> {
  const conditions = [eq(recipes.id, recipeId), eq(recipes.householdId, householdId)];
  if (!includeInactive) conditions.push(eq(recipes.isActive, true));
  const [row] = await db
    .select()
    .from(recipes)
    .where(and(...conditions))
    .limit(1);
  if (!row) throw new NotFoundError('Recipe not found.');
  return row;
}

export async function getRecipe(ctx: ActorContext, recipeId: string) {
  const recipe = await loadRecipe(ctx.householdId, recipeId, true);
  const ingredients = await db
    .select()
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, recipeId))
    .orderBy(asc(recipeIngredients.sortOrder));
  const steps = await db
    .select()
    .from(recipeSteps)
    .where(eq(recipeSteps.recipeId, recipeId))
    .orderBy(asc(recipeSteps.stepNumber));
  return {
    recipe: recipeDto(recipe),
    ingredients: ingredients.map(ingredientDto),
    steps: steps.map(stepDto),
  };
}

export interface UpdateRecipeInput {
  name?: string;
  description?: string | null;
  servings?: number;
  prepMinutes?: number | null;
  cookMinutes?: number | null;
  source?: string | null;
  imagePath?: string | null;
  tags?: string[];
}

export async function updateRecipe(ctx: ActorContext, recipeId: string, patch: UpdateRecipeInput) {
  await loadRecipe(ctx.householdId, recipeId);
  const updates: Partial<typeof recipes.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.servings !== undefined) updates.servings = patch.servings;
  if (patch.prepMinutes !== undefined) updates.prepMinutes = patch.prepMinutes;
  if (patch.cookMinutes !== undefined) updates.cookMinutes = patch.cookMinutes;
  if (patch.source !== undefined) updates.source = patch.source;
  if (patch.imagePath !== undefined) updates.imagePath = patch.imagePath;
  if (patch.tags !== undefined) updates.tags = patch.tags;
  await db.update(recipes).set(updates).where(eq(recipes.id, recipeId));
  return getRecipe(ctx, recipeId);
}

export async function deleteRecipe(ctx: ActorContext, recipeId: string) {
  await loadRecipe(ctx.householdId, recipeId);
  return withTransaction(async (tx) => {
    await tx
      .update(recipes)
      .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(recipes.id, recipeId));
    // EP-0046 referential safety: soft-delete (the row remains, so the FK ON DELETE SET NULL
    // does not fire) — clear the link from any meal-plan entry, preserving its meal_name snapshot.
    await tx
      .update(mealPlanEntries)
      .set({ recipeId: null, updatedAt: new Date() })
      .where(eq(mealPlanEntries.recipeId, recipeId));
    return { deleted: true };
  });
}

// --- Ingredients ---

async function nextIngredientOrder(recipeId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${recipeIngredients.sortOrder}), 0)` })
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, recipeId));
  return (row?.max ?? 0) + 1;
}

export async function addIngredient(ctx: ActorContext, recipeId: string, input: IngredientInput) {
  await loadRecipe(ctx.householdId, recipeId);
  const [row] = await db
    .insert(recipeIngredients)
    .values({
      recipeId,
      name: input.name,
      quantity: input.quantity != null ? String(input.quantity) : null,
      unit: input.unit ?? null,
      note: input.note ?? null,
      sortOrder: await nextIngredientOrder(recipeId),
    })
    .returning();
  return ingredientDto(row!);
}

export interface UpdateIngredientInput {
  name?: string;
  quantity?: number | null;
  unit?: string | null;
  note?: string | null;
}

async function loadIngredient(recipeId: string, ingredientId: string): Promise<IngredientRow> {
  const [row] = await db
    .select()
    .from(recipeIngredients)
    .where(and(eq(recipeIngredients.id, ingredientId), eq(recipeIngredients.recipeId, recipeId)))
    .limit(1);
  if (!row) throw new NotFoundError('Ingredient not found.');
  return row;
}

export async function updateIngredient(
  ctx: ActorContext,
  recipeId: string,
  ingredientId: string,
  patch: UpdateIngredientInput,
) {
  await loadRecipe(ctx.householdId, recipeId);
  await loadIngredient(recipeId, ingredientId);
  const updates: Partial<typeof recipeIngredients.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.quantity !== undefined)
    updates.quantity = patch.quantity != null ? String(patch.quantity) : null;
  if (patch.unit !== undefined) updates.unit = patch.unit;
  if (patch.note !== undefined) updates.note = patch.note;
  const [row] = await db
    .update(recipeIngredients)
    .set(updates)
    .where(eq(recipeIngredients.id, ingredientId))
    .returning();
  return ingredientDto(row!);
}

/** Hard-delete an ingredient, then re-densify the remaining order to 1..n. */
export async function deleteIngredient(ctx: ActorContext, recipeId: string, ingredientId: string) {
  await loadRecipe(ctx.householdId, recipeId);
  await loadIngredient(recipeId, ingredientId);
  return withTransaction(async (tx) => {
    await tx.delete(recipeIngredients).where(eq(recipeIngredients.id, ingredientId));
    const remaining = await tx
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, recipeId))
      .orderBy(asc(recipeIngredients.sortOrder));
    for (let i = 0; i < remaining.length; i++) {
      await tx
        .update(recipeIngredients)
        .set({ sortOrder: i + 1 })
        .where(eq(recipeIngredients.id, remaining[i]!.id));
    }
    return { deleted: true };
  });
}

/** Rewrite ingredient order to match the given id list (dense 1..n) in one transaction. */
export async function reorderIngredients(ctx: ActorContext, recipeId: string, order: string[]) {
  await loadRecipe(ctx.householdId, recipeId);
  const existing = await db
    .select({ id: recipeIngredients.id })
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, recipeId));
  const ids = new Set(existing.map((r) => r.id));
  if (order.length !== ids.size || !order.every((id) => ids.has(id))) {
    throw new InvalidError('Reorder list must contain exactly the recipe ingredient ids.');
  }
  await withTransaction(async (tx) => {
    for (let i = 0; i < order.length; i++) {
      await tx
        .update(recipeIngredients)
        .set({ sortOrder: i + 1, updatedAt: new Date() })
        .where(eq(recipeIngredients.id, order[i]!));
    }
  });
  return getRecipe(ctx, recipeId);
}

// --- Steps ---

async function nextStepNumber(recipeId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${recipeSteps.stepNumber}), 0)` })
    .from(recipeSteps)
    .where(eq(recipeSteps.recipeId, recipeId));
  return (row?.max ?? 0) + 1;
}

export async function addStep(ctx: ActorContext, recipeId: string, input: StepInput) {
  await loadRecipe(ctx.householdId, recipeId);
  const [row] = await db
    .insert(recipeSteps)
    .values({
      recipeId,
      stepNumber: await nextStepNumber(recipeId),
      instruction: input.instruction,
    })
    .returning();
  return stepDto(row!);
}

async function loadStep(recipeId: string, stepId: string): Promise<StepRow> {
  const [row] = await db
    .select()
    .from(recipeSteps)
    .where(and(eq(recipeSteps.id, stepId), eq(recipeSteps.recipeId, recipeId)))
    .limit(1);
  if (!row) throw new NotFoundError('Step not found.');
  return row;
}

export async function updateStep(
  ctx: ActorContext,
  recipeId: string,
  stepId: string,
  patch: { instruction?: string },
) {
  await loadRecipe(ctx.householdId, recipeId);
  await loadStep(recipeId, stepId);
  const [row] = await db
    .update(recipeSteps)
    .set({
      ...(patch.instruction !== undefined ? { instruction: patch.instruction } : {}),
      updatedAt: new Date(),
    })
    .where(eq(recipeSteps.id, stepId))
    .returning();
  return stepDto(row!);
}

export async function deleteStep(ctx: ActorContext, recipeId: string, stepId: string) {
  await loadRecipe(ctx.householdId, recipeId);
  await loadStep(recipeId, stepId);
  return withTransaction(async (tx) => {
    await tx.delete(recipeSteps).where(eq(recipeSteps.id, stepId));
    const remaining = await tx
      .select()
      .from(recipeSteps)
      .where(eq(recipeSteps.recipeId, recipeId))
      .orderBy(asc(recipeSteps.stepNumber));
    for (let i = 0; i < remaining.length; i++) {
      await tx
        .update(recipeSteps)
        .set({ stepNumber: i + 1 })
        .where(eq(recipeSteps.id, remaining[i]!.id));
    }
    return { deleted: true };
  });
}

export async function reorderSteps(ctx: ActorContext, recipeId: string, order: string[]) {
  await loadRecipe(ctx.householdId, recipeId);
  const existing = await db
    .select({ id: recipeSteps.id })
    .from(recipeSteps)
    .where(eq(recipeSteps.recipeId, recipeId));
  const ids = new Set(existing.map((r) => r.id));
  if (order.length !== ids.size || !order.every((id) => ids.has(id))) {
    throw new InvalidError('Reorder list must contain exactly the recipe step ids.');
  }
  await withTransaction(async (tx) => {
    for (let i = 0; i < order.length; i++) {
      await tx
        .update(recipeSteps)
        .set({ stepNumber: i + 1, updatedAt: new Date() })
        .where(eq(recipeSteps.id, order[i]!));
    }
  });
  return getRecipe(ctx, recipeId);
}
