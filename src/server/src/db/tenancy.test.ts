// Integration tests for the tenancy and soft-deletion contract. Runs fully in-process on the
// embedded DB (pglite). Cleans up its own households.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { assertDeletable, hardDeleteLinks, ProtectedRowError, relinkChildren } from './deletion.ts';
import { db } from './index.ts';
import * as schema from './schema/index.ts';
import { forHousehold } from './tenancy.ts';

const { demoWidgets, demoCategories, demoItems, demoLinks } = schema;

const householdA = '00000000-0000-4000-8000-00000000008a';
const householdB = '00000000-0000-4000-8000-00000000008b';

async function cleanup(): Promise<void> {
  for (const hh of [householdA, householdB]) {
    await db.execute(sql`DELETE FROM demo_items WHERE household_id = ${hh}`);
    await db.execute(sql`DELETE FROM demo_categories WHERE household_id = ${hh}`);
    await db.execute(sql`DELETE FROM demo_widgets WHERE household_id = ${hh}`);
    await db.execute(sql`DELETE FROM demo_links WHERE household_id = ${hh}`);
  }
}

beforeAll(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
});

describe('tenancy scoping', () => {
  it('a household cannot read or delete another household’s rows', async () => {
    const repoA = forHousehold(demoWidgets, householdA, db);
    const repoB = forHousehold(demoWidgets, householdB, db);

    const widgetB = await repoB.create({ name: 'B widget' });

    // A cannot retrieve B's row through the scoped helper.
    expect(await repoA.retrieve(widgetB.id)).toBeNull();
    expect(await repoB.retrieve(widgetB.id)).not.toBeNull();

    // listActive returns only the caller's household.
    await repoA.create({ name: 'A widget' });
    const aList = await repoA.listActive();
    expect(aList.every((w) => w.householdId === householdA)).toBe(true);
    expect(aList.some((w) => w.id === widgetB.id)).toBe(false);

    // A cannot soft-delete B's row.
    expect(await repoA.softDelete(widgetB.id)).toBe(false);
    expect(await repoB.retrieve(widgetB.id)).not.toBeNull();
  });
});

describe('soft deletion', () => {
  it('hides a row from scoped reads but retains it', async () => {
    const repoA = forHousehold(demoWidgets, householdA, db);
    const widget = await repoA.create({ name: 'to delete' });

    expect(await repoA.softDelete(widget.id)).toBe(true);
    expect(await repoA.retrieve(widget.id)).toBeNull();

    const raw = await db.select().from(demoWidgets).where(eq(demoWidgets.id, widget.id));
    expect(raw.length).toBe(1);
    expect(raw[0]?.isActive).toBe(false);
  });
});

describe('referential safety', () => {
  it('relinks children to null when a parent category is deleted (children survive)', async () => {
    const categories = forHousehold(demoCategories, householdA, db);
    const items = forHousehold(demoItems, householdA, db);

    const category = await categories.create({ name: 'Cat' });
    const item = await items.create({ name: 'Item', categoryId: category.id });

    const relinked = await relinkChildren(
      demoItems,
      eq(demoItems.categoryId, category.id),
      { categoryId: null },
      db,
    );
    expect(relinked).toBeGreaterThanOrEqual(1);
    await categories.softDelete(category.id);

    const fetched = await items.retrieve(item.id);
    expect(fetched).not.toBeNull(); // child survives
    expect(fetched?.categoryId).toBeNull(); // now "uncategorized"
  });

  it('hard-deletes junction/link rows', async () => {
    const left = '11111111-0000-4000-8000-000000000001';
    const right = '22222222-0000-4000-8000-000000000002';
    await db.insert(demoLinks).values({ householdId: householdA, leftId: left, rightId: right });

    const removed = await hardDeleteLinks(demoLinks, eq(demoLinks.leftId, left), db);
    expect(removed).toBe(1);

    const remaining = await db.select().from(demoLinks).where(eq(demoLinks.leftId, left));
    expect(remaining.length).toBe(0); // physically gone
  });
});

describe('protected rows', () => {
  it('rejects deletion of a protected row (e.g. the household owner)', () => {
    expect(() => assertDeletable(true, 'The household owner cannot be removed.')).toThrow(
      ProtectedRowError,
    );
    expect(() => assertDeletable(false)).not.toThrow();
  });
});
