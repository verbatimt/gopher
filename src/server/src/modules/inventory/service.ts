// Household inventory business logic (EP-0048). Item CRUD (soft-delete; still resolvable),
// signed-delta adjustments that maintain a running `quantity` transactionally (the EP-0024
// medication-stock pattern generalized), a low-stock → grocery bridge, and filters. numeric is
// kept as strings at the DB boundary. Item management is gated at the route by inventory:write;
// any member may adjust/read (inventory:read).

import { and, asc, desc, eq, ilike, lte, sql } from 'drizzle-orm';
import { db, withTransaction } from '../../db/index.ts';
import {
  groceryItems,
  groceryLists,
  inventoryAdjustments,
  inventoryItems,
} from '../../db/schema/index.ts';
import { InvalidError, NotFoundError } from '../../http/errors.ts';

export interface ActorContext {
  userId: string;
  householdId: string;
  memberId: string | null;
  roles: string[];
}

type ItemRow = typeof inventoryItems.$inferSelect;
type AdjustmentRow = typeof inventoryAdjustments.$inferSelect;

const PAGE_SIZE = 50;

function itemDto(i: ItemRow) {
  return {
    id: i.id,
    householdId: i.householdId,
    name: i.name,
    category: i.category,
    unit: i.unit,
    quantity: i.quantity,
    location: i.location,
    lowThreshold: i.lowThreshold,
    expiresAt: i.expiresAt,
    barcode: i.barcode,
    autoAddToGrocery: i.autoAddToGrocery,
    notes: i.notes,
    imagePath: i.imagePath,
    isActive: i.isActive,
    isLowStock: i.lowThreshold != null && Number(i.quantity) <= Number(i.lowThreshold),
  };
}

function adjustmentDto(a: AdjustmentRow) {
  return {
    id: a.id,
    itemId: a.itemId,
    delta: a.delta,
    reason: a.reason,
    resultingQuantity: a.resultingQuantity,
    adjustedBy: a.adjustedBy,
    note: a.note,
    createdAt: a.createdAt,
  };
}

// --- Grocery bridge (EP-0030 list) ---

async function ensureGroceryList(householdId: string) {
  const [existing] = await db
    .select()
    .from(groceryLists)
    .where(and(eq(groceryLists.householdId, householdId), eq(groceryLists.isActive, true)))
    .limit(1);
  if (existing) return existing;
  const [created] = await db.insert(groceryLists).values({ householdId }).returning();
  return created!;
}

/** Merge a grocery line for an item, idempotent by name (don't spam while already pending). */
async function mergeGroceryLine(householdId: string, item: ItemRow): Promise<boolean> {
  const list = await ensureGroceryList(householdId);
  const [existing] = await db
    .select({ id: groceryItems.id })
    .from(groceryItems)
    .where(
      and(
        eq(groceryItems.groceryListId, list.id),
        eq(groceryItems.isActive, true),
        eq(groceryItems.isChecked, false),
        sql`lower(${groceryItems.name}) = lower(${item.name})`,
      ),
    )
    .limit(1);
  if (existing) return false;
  await db
    .insert(groceryItems)
    .values({ groceryListId: list.id, name: item.name, quantity: item.unit ?? null });
  return true;
}

// --- Items ---

export interface CreateItemInput {
  name: string;
  category?: string | null;
  unit?: string | null;
  quantity?: number;
  location?: string | null;
  lowThreshold?: number | null;
  expiresAt?: string | null;
  barcode?: string | null;
  autoAddToGrocery?: boolean;
  notes?: string | null;
  imagePath?: string | null;
}

export async function createItem(ctx: ActorContext, input: CreateItemInput) {
  const [row] = await db
    .insert(inventoryItems)
    .values({
      householdId: ctx.householdId,
      name: input.name,
      category: input.category ?? null,
      unit: input.unit ?? null,
      quantity: String(input.quantity ?? 0),
      location: input.location ?? null,
      lowThreshold: input.lowThreshold != null ? String(input.lowThreshold) : null,
      expiresAt: input.expiresAt ?? null,
      barcode: input.barcode ?? null,
      autoAddToGrocery: input.autoAddToGrocery ?? true,
      notes: input.notes ?? null,
      imagePath: input.imagePath ?? null,
      createdBy: ctx.memberId,
    })
    .returning();
  return itemDto(row!);
}

export interface ListFilter {
  category?: string;
  location?: string;
  lowStock?: boolean;
  search?: string;
  expiringBefore?: string;
  page?: number;
}

export async function listItems(ctx: ActorContext, filter: ListFilter) {
  const conditions = [
    eq(inventoryItems.householdId, ctx.householdId),
    eq(inventoryItems.isActive, true),
  ];
  if (filter.category) conditions.push(eq(inventoryItems.category, filter.category));
  if (filter.location) conditions.push(eq(inventoryItems.location, filter.location));
  if (filter.search) conditions.push(ilike(inventoryItems.name, `%${filter.search}%`));
  if (filter.expiringBefore) conditions.push(lte(inventoryItems.expiresAt, filter.expiringBefore));
  if (filter.lowStock) {
    conditions.push(
      sql`${inventoryItems.lowThreshold} is not null and ${inventoryItems.quantity} <= ${inventoryItems.lowThreshold}`,
    );
  }
  const page = Math.max(1, filter.page ?? 1);
  const rows = await db
    .select()
    .from(inventoryItems)
    .where(and(...conditions))
    .orderBy(asc(inventoryItems.location), asc(inventoryItems.name))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  return rows.map(itemDto);
}

async function loadItem(
  householdId: string,
  itemId: string,
  includeInactive = false,
): Promise<ItemRow> {
  const conditions = [eq(inventoryItems.id, itemId), eq(inventoryItems.householdId, householdId)];
  if (!includeInactive) conditions.push(eq(inventoryItems.isActive, true));
  const [row] = await db
    .select()
    .from(inventoryItems)
    .where(and(...conditions))
    .limit(1);
  if (!row) throw new NotFoundError('Inventory item not found.');
  return row;
}

export async function getItem(ctx: ActorContext, itemId: string) {
  return itemDto(await loadItem(ctx.householdId, itemId, true));
}

export interface UpdateItemInput {
  name?: string;
  category?: string | null;
  unit?: string | null;
  location?: string | null;
  lowThreshold?: number | null;
  expiresAt?: string | null;
  barcode?: string | null;
  autoAddToGrocery?: boolean;
  notes?: string | null;
  imagePath?: string | null;
}

export async function updateItem(ctx: ActorContext, itemId: string, patch: UpdateItemInput) {
  await loadItem(ctx.householdId, itemId);
  const updates: Partial<typeof inventoryItems.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.category !== undefined) updates.category = patch.category;
  if (patch.unit !== undefined) updates.unit = patch.unit;
  if (patch.location !== undefined) updates.location = patch.location;
  if (patch.lowThreshold !== undefined)
    updates.lowThreshold = patch.lowThreshold != null ? String(patch.lowThreshold) : null;
  if (patch.expiresAt !== undefined) updates.expiresAt = patch.expiresAt;
  if (patch.barcode !== undefined) updates.barcode = patch.barcode;
  if (patch.autoAddToGrocery !== undefined) updates.autoAddToGrocery = patch.autoAddToGrocery;
  if (patch.notes !== undefined) updates.notes = patch.notes;
  if (patch.imagePath !== undefined) updates.imagePath = patch.imagePath;
  const [row] = await db
    .update(inventoryItems)
    .set(updates)
    .where(eq(inventoryItems.id, itemId))
    .returning();
  return itemDto(row!);
}

export async function deleteItem(ctx: ActorContext, itemId: string) {
  await loadItem(ctx.householdId, itemId);
  await db
    .update(inventoryItems)
    .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(inventoryItems.id, itemId));
  return { deleted: true };
}

// --- Adjustments ---

export interface AdjustInput {
  delta: number;
  reason: 'restock' | 'consume' | 'correction' | 'expired';
  note?: string | null;
}

/**
 * Apply a signed delta to an item's quantity atomically: row-lock the item, compute the new
 * total, reject a result below zero, persist the running total + an append-only adjustment row.
 * Crossing to ≤ low_threshold with auto_add_to_grocery merges a grocery line.
 */
export async function adjust(ctx: ActorContext, itemId: string, input: AdjustInput) {
  // Verify the item exists in the household before the locked update.
  await loadItem(ctx.householdId, itemId);

  const outcome = await withTransaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, itemId))
      .for('update')
      .limit(1);
    const before = Number(item!.quantity);
    const after = before + input.delta;
    if (after < 0) {
      throw new InvalidError('Cannot consume more than the quantity on hand.');
    }
    const [updated] = await tx
      .update(inventoryItems)
      .set({ quantity: String(after), updatedAt: new Date() })
      .where(eq(inventoryItems.id, itemId))
      .returning();
    const [adjustment] = await tx
      .insert(inventoryAdjustments)
      .values({
        itemId,
        delta: String(input.delta),
        reason: input.reason,
        resultingQuantity: String(after),
        adjustedBy: ctx.memberId,
        note: input.note ?? null,
      })
      .returning();

    const threshold = updated!.lowThreshold != null ? Number(updated!.lowThreshold) : null;
    const crossedLow = threshold != null && before > threshold && after <= threshold;
    return { updated: updated!, adjustment: adjustment!, crossedLow };
  });

  let groceryAdded = false;
  if (outcome.crossedLow && outcome.updated.autoAddToGrocery) {
    groceryAdded = await mergeGroceryLine(ctx.householdId, outcome.updated);
  }
  return {
    item: itemDto(outcome.updated),
    adjustment: adjustmentDto(outcome.adjustment),
    groceryAdded,
  };
}

export async function listAdjustments(ctx: ActorContext, itemId: string, page: number) {
  await loadItem(ctx.householdId, itemId, true);
  const rows = await db
    .select()
    .from(inventoryAdjustments)
    .where(eq(inventoryAdjustments.itemId, itemId))
    .orderBy(desc(inventoryAdjustments.createdAt))
    .limit(PAGE_SIZE)
    .offset((Math.max(1, page) - 1) * PAGE_SIZE);
  return rows.map(adjustmentDto);
}

export async function lowStock(ctx: ActorContext) {
  const rows = await db
    .select()
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.householdId, ctx.householdId),
        eq(inventoryItems.isActive, true),
        sql`${inventoryItems.lowThreshold} is not null and ${inventoryItems.quantity} <= ${inventoryItems.lowThreshold}`,
      ),
    )
    .orderBy(asc(inventoryItems.name));
  return rows.map(itemDto);
}

/** Manually add/merge a grocery line for an item (idempotent by name). */
export async function addToGrocery(ctx: ActorContext, itemId: string) {
  const item = await loadItem(ctx.householdId, itemId);
  const added = await mergeGroceryLine(ctx.householdId, item);
  return { added };
}
