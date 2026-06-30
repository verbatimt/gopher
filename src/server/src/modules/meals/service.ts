// Meal planning + grocery business logic (EP-0030). Weekly plans are unique per household
// per week; entries are one-per-(day, meal-type) slot (assigning replaces). Copy duplicates a
// plan's entries to a new week (409 if the target week already has a plan). Grocery is a
// lightweight per-household checklist, optionally seeded from a plan's meal names.

import { and, asc, eq } from 'drizzle-orm';
import { effectiveRole } from '../../auth/visibility.ts';
import { db, withTransaction } from '../../db/index.ts';
import {
  groceryItems,
  groceryLists,
  mealPlanEntries,
  mealPlans,
  recipeIngredients,
  recipes,
} from '../../db/schema/index.ts';
import { ConflictError, InvalidError, NotFoundError } from '../../http/errors.ts';

export interface ActorContext {
  userId: string;
  householdId: string;
  memberId: string | null;
  roles: string[];
}

/** Validate a meal-entry scope: 'personal' requires a member; 'family' (default) clears it. */
function normalizeScope(
  scope?: string | null,
  memberId?: string | null,
): { scope: string; memberId: string | null } {
  if ((scope ?? 'family') === 'personal') {
    if (!memberId) throw new InvalidError('A personal meal requires a member.');
    return { scope: 'personal', memberId };
  }
  return { scope: 'family', memberId: null };
}

// --- Plans ---

export async function listPlans(ctx: ActorContext, weekStart?: string) {
  const conditions = [eq(mealPlans.householdId, ctx.householdId), eq(mealPlans.isActive, true)];
  if (weekStart) conditions.push(eq(mealPlans.weekStartDate, weekStart));
  return db
    .select()
    .from(mealPlans)
    .where(and(...conditions))
    .orderBy(asc(mealPlans.weekStartDate));
}

async function findPlanForWeek(householdId: string, weekStart: string) {
  const [row] = await db
    .select()
    .from(mealPlans)
    .where(and(eq(mealPlans.householdId, householdId), eq(mealPlans.weekStartDate, weekStart)))
    .limit(1);
  return row ?? null;
}

export async function createPlan(ctx: ActorContext, weekStartDate: string) {
  if (await findPlanForWeek(ctx.householdId, weekStartDate)) {
    throw new ConflictError('A meal plan already exists for that week.');
  }
  const [row] = await db
    .insert(mealPlans)
    .values({ householdId: ctx.householdId, weekStartDate, createdBy: ctx.userId })
    .returning();
  return row!;
}

async function loadPlan(householdId: string, planId: string) {
  const [row] = await db
    .select()
    .from(mealPlans)
    .where(and(eq(mealPlans.id, planId), eq(mealPlans.householdId, householdId)))
    .limit(1);
  return row ?? null;
}

export async function getPlan(ctx: ActorContext, planId: string) {
  const plan = await loadPlan(ctx.householdId, planId);
  if (!plan) throw new NotFoundError('Meal plan not found.');
  const entries = await db
    .select()
    .from(mealPlanEntries)
    .where(eq(mealPlanEntries.mealPlanId, planId))
    .orderBy(asc(mealPlanEntries.dayOfWeek), asc(mealPlanEntries.mealType));
  // Personal meals are private to their member: a non-supervising member (the meals module is
  // open to supervising + unsupervised) sees only family entries and their own personal ones.
  // Supervising/system members see everything.
  const role = effectiveRole(ctx.roles);
  const seesAll = role === 'supervising' || role === 'system';
  const visible = seesAll
    ? entries
    : entries.filter((e) => e.scope === 'family' || e.memberId === ctx.memberId);
  return { plan, entries: visible };
}

// --- Entries ---

export interface EntryInput {
  dayOfWeek: number;
  mealType: string;
  mealName?: string;
  notes?: string;
  recipeId?: string | null;
  servings?: number | null;
  scope?: 'family' | 'personal';
  memberId?: string | null;
}

/** Resolve a recipe in the household (active or not — historical refs resolve); returns its
 *  name so meal_name can default to it. Throws if the recipe is not in the household. */
async function recipeName(householdId: string, recipeId: string): Promise<string> {
  const [row] = await db
    .select({ name: recipes.name })
    .from(recipes)
    .where(and(eq(recipes.id, recipeId), eq(recipes.householdId, householdId)))
    .limit(1);
  if (!row) throw new NotFoundError('Recipe not found.');
  return row.name;
}

/** Assign a meal to a (day, meal-type) slot — replaces any existing entry in that slot. When a
 *  recipeId is set, meal_name defaults to the recipe name if omitted (EP-0046). */
export async function upsertEntry(ctx: ActorContext, planId: string, input: EntryInput) {
  const plan = await loadPlan(ctx.householdId, planId);
  if (!plan) throw new NotFoundError('Meal plan not found.');

  let name = input.mealName;
  if (input.recipeId) {
    const rn = await recipeName(ctx.householdId, input.recipeId);
    name = name ?? rn;
  }
  if (!name) throw new InvalidError('A meal name or recipe is required.');

  const { scope, memberId } = normalizeScope(input.scope, input.memberId);

  const [row] = await db
    .insert(mealPlanEntries)
    .values({
      mealPlanId: planId,
      dayOfWeek: input.dayOfWeek,
      mealType: input.mealType,
      mealName: name,
      notes: input.notes ?? null,
      recipeId: input.recipeId ?? null,
      servings: input.servings ?? null,
      scope,
      memberId,
    })
    .onConflictDoUpdate({
      target: [mealPlanEntries.mealPlanId, mealPlanEntries.dayOfWeek, mealPlanEntries.mealType],
      set: {
        mealName: name,
        notes: input.notes ?? null,
        recipeId: input.recipeId ?? null,
        servings: input.servings ?? null,
        scope,
        memberId,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row!;
}

export async function updateEntry(
  ctx: ActorContext,
  planId: string,
  entryId: string,
  patch: {
    mealName?: string;
    notes?: string;
    recipeId?: string | null;
    servings?: number | null;
    scope?: 'family' | 'personal';
    memberId?: string | null;
  },
) {
  const plan = await loadPlan(ctx.householdId, planId);
  if (!plan) throw new NotFoundError('Meal plan not found.');

  const updates: Partial<typeof mealPlanEntries.$inferInsert> = { updatedAt: new Date() };
  if (patch.notes !== undefined) updates.notes = patch.notes;
  if (patch.servings !== undefined) updates.servings = patch.servings;
  if (patch.recipeId !== undefined) {
    updates.recipeId = patch.recipeId;
    // Linking a recipe defaults the name to the recipe's when none is supplied.
    if (patch.recipeId && patch.mealName === undefined) {
      updates.mealName = await recipeName(ctx.householdId, patch.recipeId);
    }
  }
  if (patch.mealName !== undefined) updates.mealName = patch.mealName;
  if (patch.scope !== undefined || patch.memberId !== undefined) {
    const [current] = await db
      .select()
      .from(mealPlanEntries)
      .where(and(eq(mealPlanEntries.id, entryId), eq(mealPlanEntries.mealPlanId, planId)))
      .limit(1);
    if (!current) throw new NotFoundError('Meal entry not found.');
    const norm = normalizeScope(
      patch.scope ?? current.scope,
      patch.memberId !== undefined ? patch.memberId : current.memberId,
    );
    updates.scope = norm.scope;
    updates.memberId = norm.memberId;
  }

  const [row] = await db
    .update(mealPlanEntries)
    .set(updates)
    .where(and(eq(mealPlanEntries.id, entryId), eq(mealPlanEntries.mealPlanId, planId)))
    .returning();
  if (!row) throw new NotFoundError('Meal entry not found.');
  return row;
}

export async function deleteEntry(ctx: ActorContext, planId: string, entryId: string) {
  const plan = await loadPlan(ctx.householdId, planId);
  if (!plan) throw new NotFoundError('Meal plan not found.');
  await db
    .delete(mealPlanEntries)
    .where(and(eq(mealPlanEntries.id, entryId), eq(mealPlanEntries.mealPlanId, planId)));
  return { deleted: true };
}

/** Copy a plan's entries to a new week (409 if the target week already has a plan). */
export async function copyPlan(ctx: ActorContext, sourcePlanId: string, targetWeekStart: string) {
  const source = await loadPlan(ctx.householdId, sourcePlanId);
  if (!source) throw new NotFoundError('Meal plan not found.');
  if (await findPlanForWeek(ctx.householdId, targetWeekStart)) {
    throw new ConflictError('A meal plan already exists for that week.');
  }
  const entries = await db
    .select()
    .from(mealPlanEntries)
    .where(eq(mealPlanEntries.mealPlanId, sourcePlanId));

  return withTransaction(async (tx) => {
    const [target] = await tx
      .insert(mealPlans)
      .values({
        householdId: ctx.householdId,
        weekStartDate: targetWeekStart,
        createdBy: ctx.userId,
      })
      .returning();
    if (entries.length > 0) {
      await tx.insert(mealPlanEntries).values(
        entries.map((e) => ({
          mealPlanId: target!.id,
          dayOfWeek: e.dayOfWeek,
          mealType: e.mealType,
          mealName: e.mealName,
          notes: e.notes,
          recipeId: e.recipeId,
          servings: e.servings,
          scope: e.scope,
          memberId: e.memberId,
        })),
      );
    }
    return target!;
  });
}

// --- Grocery list (one default list per household) ---

async function ensureList(householdId: string) {
  const [existing] = await db
    .select()
    .from(groceryLists)
    .where(and(eq(groceryLists.householdId, householdId), eq(groceryLists.isActive, true)))
    .limit(1);
  if (existing) return existing;
  const [created] = await db.insert(groceryLists).values({ householdId }).returning();
  return created!;
}

export async function getGroceryList(ctx: ActorContext) {
  const list = await ensureList(ctx.householdId);
  const items = await db
    .select()
    .from(groceryItems)
    .where(and(eq(groceryItems.groceryListId, list.id), eq(groceryItems.isActive, true)))
    .orderBy(asc(groceryItems.createdAt));
  return { list, items };
}

export async function addGroceryItem(
  ctx: ActorContext,
  input: { name: string; quantity?: string },
) {
  const list = await ensureList(ctx.householdId);
  const [row] = await db
    .insert(groceryItems)
    .values({ groceryListId: list.id, name: input.name, quantity: input.quantity ?? null })
    .returning();
  return row!;
}

async function loadItem(householdId: string, itemId: string) {
  const list = await ensureList(householdId);
  const [row] = await db
    .select()
    .from(groceryItems)
    .where(and(eq(groceryItems.id, itemId), eq(groceryItems.groceryListId, list.id)))
    .limit(1);
  return row ?? null;
}

export async function updateGroceryItem(
  ctx: ActorContext,
  itemId: string,
  patch: { name?: string; quantity?: string; isChecked?: boolean },
) {
  if (!(await loadItem(ctx.householdId, itemId)))
    throw new NotFoundError('Grocery item not found.');
  const [row] = await db
    .update(groceryItems)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(groceryItems.id, itemId))
    .returning();
  return row!;
}

export async function deleteGroceryItem(ctx: ActorContext, itemId: string) {
  if (!(await loadItem(ctx.householdId, itemId)))
    throw new NotFoundError('Grocery item not found.');
  await db
    .update(groceryItems)
    .set({ isActive: false, deletedAt: new Date() })
    .where(eq(groceryItems.id, itemId));
  return { deleted: true };
}

/** Seed grocery items from a plan's entry meal names (no ingredient parsing). */
export async function seedGroceryFromPlan(ctx: ActorContext, planId: string) {
  const plan = await loadPlan(ctx.householdId, planId);
  if (!plan) throw new NotFoundError('Meal plan not found.');
  const entries = await db
    .select()
    .from(mealPlanEntries)
    .where(eq(mealPlanEntries.mealPlanId, planId));
  const list = await ensureList(ctx.householdId);
  if (entries.length === 0) return { added: 0 };
  await db
    .insert(groceryItems)
    .values(entries.map((e) => ({ groceryListId: list.id, name: e.mealName })));
  return { added: entries.length };
}

// --- Ingredient-derived grocery (EP-0046) ---

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Trim a number to a compact string (no trailing .0). */
function numLabel(n: number): string {
  return n === Math.round(n) ? String(Math.round(n)) : String(round2(n));
}

/** Format an aggregated quantity + unit into the grocery `quantity` text (e.g. "400 g"). */
function formatQty(num: number | null, unit: string): string | null {
  if (num === null) return null;
  return unit ? `${numLabel(num)} ${unit}` : numLabel(num);
}

/** Parse a grocery `quantity` text back into a numeric amount + unit (for merge). */
function parseQty(raw: string | null): { num: number | null; unit: string } {
  if (!raw) return { num: null, unit: '' };
  const m = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(.*)$/.exec(raw);
  if (!m) return { num: null, unit: raw.trim().toLowerCase() };
  return { num: Number(m[1]), unit: (m[2] ?? '').trim() };
}

interface AggLine {
  name: string;
  unit: string;
  num: number | null;
  hasQty: boolean;
}

/**
 * Derive grocery items from a plan's recipe-linked entries (EP-0046). Expands each linked
 * recipe's ingredients, scales by `entry.servings / recipe.servings` when both are known,
 * aggregates by case-insensitive `(name, unit)`, and merges into the existing grocery list
 * (incrementing a matching pending line rather than duplicating). Free-text entries (no
 * recipe) fall back to seeding the `meal_name`.
 */
export async function seedGroceryFromPlanIngredients(ctx: ActorContext, planId: string) {
  const plan = await loadPlan(ctx.householdId, planId);
  if (!plan) throw new NotFoundError('Meal plan not found.');
  const entries = await db
    .select()
    .from(mealPlanEntries)
    .where(eq(mealPlanEntries.mealPlanId, planId));

  const agg = new Map<string, AggLine>();
  const freeText: string[] = [];

  for (const entry of entries) {
    if (!entry.recipeId) {
      freeText.push(entry.mealName);
      continue;
    }
    const [recipe] = await db
      .select({ servings: recipes.servings })
      .from(recipes)
      .where(eq(recipes.id, entry.recipeId))
      .limit(1);
    const recipeServings = recipe?.servings ?? null;
    const factor =
      entry.servings && recipeServings && recipeServings > 0 ? entry.servings / recipeServings : 1;
    const ings = await db
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, entry.recipeId));
    for (const ing of ings) {
      const unit = (ing.unit ?? '').trim();
      const key = `${ing.name.trim().toLowerCase()}|${unit.toLowerCase()}`;
      const qty = ing.quantity != null ? Number(ing.quantity) * factor : null;
      const existing = agg.get(key);
      if (existing) {
        if (qty != null) {
          existing.num = (existing.num ?? 0) + qty;
          existing.hasQty = true;
        }
      } else {
        agg.set(key, { name: ing.name.trim(), unit, num: qty, hasQty: qty != null });
      }
    }
  }

  const list = await ensureList(ctx.householdId);
  const pending = await db
    .select()
    .from(groceryItems)
    .where(
      and(
        eq(groceryItems.groceryListId, list.id),
        eq(groceryItems.isActive, true),
        eq(groceryItems.isChecked, false),
      ),
    );

  let added = 0;
  let merged = 0;

  for (const line of agg.values()) {
    const qtyNum = line.hasQty ? round2(line.num ?? 0) : null;
    // Find a pending line with the same name (ci) AND the same unit (parsed from its quantity).
    const match = pending.find((p) => {
      if (p.name.trim().toLowerCase() !== line.name.toLowerCase()) return false;
      return parseQty(p.quantity).unit.toLowerCase() === line.unit.toLowerCase();
    });
    if (match) {
      const prev = parseQty(match.quantity);
      const total = qtyNum != null || prev.num != null ? (prev.num ?? 0) + (qtyNum ?? 0) : null;
      await db
        .update(groceryItems)
        .set({ quantity: formatQty(total, line.unit), updatedAt: new Date() })
        .where(eq(groceryItems.id, match.id));
      merged++;
    } else {
      const [row] = await db
        .insert(groceryItems)
        .values({ groceryListId: list.id, name: line.name, quantity: formatQty(qtyNum, line.unit) })
        .returning();
      pending.push(row!);
      added++;
    }
  }

  // Free-text meals (no recipe) seed by name, skipping an identical pending line.
  for (const name of freeText) {
    const exists = pending.some((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (exists) continue;
    const [row] = await db
      .insert(groceryItems)
      .values({ groceryListId: list.id, name })
      .returning();
    pending.push(row!);
    added++;
  }

  return { added, merged };
}
