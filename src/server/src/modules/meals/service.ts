// Meal planning + grocery business logic (EP-0030). Weekly plans are unique per household
// per week; entries are one-per-(day, meal-type) slot (assigning replaces). Copy duplicates a
// plan's entries to a new week (409 if the target week already has a plan). Grocery is a
// lightweight per-household checklist, optionally seeded from a plan's meal names.

import { and, asc, eq } from 'drizzle-orm';
import { db, withTransaction } from '../../db/index.ts';
import { groceryItems, groceryLists, mealPlanEntries, mealPlans } from '../../db/schema/index.ts';
import { ConflictError, NotFoundError } from '../../http/errors.ts';

export interface ActorContext {
  userId: string;
  householdId: string;
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
  return { plan, entries };
}

// --- Entries ---

export interface EntryInput {
  dayOfWeek: number;
  mealType: string;
  mealName: string;
  notes?: string;
}

/** Assign a meal to a (day, meal-type) slot — replaces any existing entry in that slot. */
export async function upsertEntry(ctx: ActorContext, planId: string, input: EntryInput) {
  const plan = await loadPlan(ctx.householdId, planId);
  if (!plan) throw new NotFoundError('Meal plan not found.');
  const [row] = await db
    .insert(mealPlanEntries)
    .values({
      mealPlanId: planId,
      dayOfWeek: input.dayOfWeek,
      mealType: input.mealType,
      mealName: input.mealName,
      notes: input.notes ?? null,
    })
    .onConflictDoUpdate({
      target: [mealPlanEntries.mealPlanId, mealPlanEntries.dayOfWeek, mealPlanEntries.mealType],
      set: { mealName: input.mealName, notes: input.notes ?? null, updatedAt: new Date() },
    })
    .returning();
  return row!;
}

export async function updateEntry(
  ctx: ActorContext,
  planId: string,
  entryId: string,
  patch: { mealName?: string; notes?: string },
) {
  const plan = await loadPlan(ctx.householdId, planId);
  if (!plan) throw new NotFoundError('Meal plan not found.');
  const [row] = await db
    .update(mealPlanEntries)
    .set({ ...patch, updatedAt: new Date() })
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
